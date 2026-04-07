const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, getElementSkipCondition, compositeKeyExpr, getValueExpr, getWhereCondition, getLabelExpr, buildObjectIDExpr } = require('./sql-expressions.js');
const { buildCompositionParentContext, buildParentLookupOrCreateSQL, buildCompositionOnlyBody } = require('./composition.js');

/**
 * Returns the FROM clause for statement-level trigger sub-SELECTs.
 * - For 'create': FROM :new_tab nt
 * - For 'delete': FROM :old_tab ot
 * - For 'update': FROM :new_tab nt INNER JOIN :old_tab ot ON nt.key1 = ot.key1 [AND nt.key2 = ot.key2 ...]
 */
function getFromClause(entity, modification) {
	const keys = utils.extractKeys(entity.keys);
	if (modification === 'create') {
		return 'FROM :new_tab nt';
	}
	if (modification === 'delete') {
		return 'FROM :old_tab ot';
	}
	// update: join new and old tables on keys
	const joinCondition = keys.map((k) => `nt.${k} = ot.${k}`).join(' AND ');
	return `FROM :new_tab nt INNER JOIN :old_tab ot ON ${joinCondition}`;
}

function buildTriggerContext(entity, objectIDs, rowRef, model) {
	const keys = utils.extractKeys(entity.keys);
	return {
		entityKeyExpr: compositeKeyExpr(keys.map((k) => `${rowRef}.${k}`)),
		objectIDExpr: buildObjectIDExpr(objectIDs, entity, rowRef, model),
		parentLookupExpr: null
	};
}

function buildInsertSQL(entity, columns, modification, ctx, model) {
	const fromClause = getFromClause(entity, modification);

	// Generate single UNION ALL query for all changed columns
	// Each sub-SELECT produces all columns needed for the INSERT, including per-row entity key and objectID
	const unionQuery = columns
		.map((col) => {
			const whereCondition = getWhereCondition(col, modification);
			const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
			let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

			// For composition-of-one columns, add deduplication check to prevent duplicate entries
			// when child trigger has already created a composition entry for this transaction
			if (col.type === 'cds.Composition' && ctx.entityKeyExpr) {
				fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${entity.name}'
			AND entityKey = ${ctx.entityKeyExpr}
			AND attribute = '${col.name}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		)`;
			}

			const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'ot');
			const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'nt');
			const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'ot', model, entity.name);
			const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'nt', model, entity.name);

			const dataType = col.altExpression ? 'cds.String' : col.type;

			return `SELECT SYSUUID AS ID, ${ctx.parentLookupExpr} AS parent_ID, '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${entity.name}' AS entity, ${ctx.entityKeyExpr} AS entityKey, ${ctx.objectIDExpr} AS objectID, CURRENT_TIMESTAMP AS createdAt, SESSION_CONTEXT('APPLICATIONUSER') AS createdBy, '${dataType}' AS valueDataType, '${modification}' AS modification, CURRENT_UPDATE_TRANSACTION() AS transactionID ${fromClause} WHERE ${fullWhere}`;
		})
		.join('\nUNION ALL\n');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		${unionQuery};`;
}

function wrapInSkipCheck(entityName, insertSQL, compositionParentContext = null) {
	if (compositionParentContext) {
		const { declares } = compositionParentContext;
		const declareBlock = declares ? `${declares}\n\t` : '';
		return `${declareBlock}IF ${getSkipCheckCondition(entityName)} THEN
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
	}
	return `IF ${getSkipCheckCondition(entityName)} THEN
		${insertSQL}
	END IF;`;
}

function generateCreateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'nt', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'nt', model, grandParentCompositionInfo) : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx, model);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

	return {
		name: entity.name + '_CT_CREATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_CREATE AFTER INSERT
ON ${utils.transformName(entity.name)}
REFERENCING NEW TABLE new_tab
FOR EACH STATEMENT
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function generateUpdateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'nt', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'nt', model, grandParentCompositionInfo) : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx, model);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap((c) => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) return c.foreignKeys.map((k) => `${c.name}_${k.replaceAll(/\./g, '_')}`);
		if (c.on) return c.on.map((m) => m.foreignKeyField);
		return [];
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return {
		name: entity.name + '_CT_UPDATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_UPDATE AFTER UPDATE ${ofClause}
ON ${utils.transformName(entity.name)}
REFERENCING NEW TABLE new_tab, OLD TABLE old_tab
FOR EACH STATEMENT
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'ot', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'ot', model, grandParentCompositionInfo) : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
ON ${utils.transformName(entity.name)}
REFERENCING OLD TABLE old_tab
FOR EACH STATEMENT
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function generateDeleteTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const ctx = buildTriggerContext(entity, objectIDs, 'ot', model);

	const deleteSQL = `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey IN (SELECT ${compositeKeyExpr(keys.map((k) => `ot.${k}`))} FROM :old_tab ot);`;

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'ot', model, grandParentCompositionInfo) : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Special wrapping for delete - need variable declared if using composition
	let body;
	if (columns.length === 0 && compositionParentContext) {
		// Composition-only case: only insert composition parent entry, no child column inserts
		body = buildCompositionOnlyBody(entity.name, compositionParentContext, deleteSQL);
	} else if (compositionParentContext) {
		// Mixed case: both composition parent entry and child column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		const { declares } = compositionParentContext;
		const declareBlock = declares ? `${declares}\n\t` : '';
		body = `${declareBlock}IF ${getSkipCheckCondition(entity.name)} THEN
		${deleteSQL}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
	} else {
		// No composition: standard delete with column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		body = wrapInSkipCheck(entity.name, `${deleteSQL}\n\t\t${insertSQL}`);
	}

	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
ON ${utils.transformName(entity.name)}
REFERENCING OLD TABLE old_tab
FOR EACH STATEMENT
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function generateHANATriggers(csn, entity, rootEntity = null, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);

	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	const keys = utils.extractKeys(entity.keys);
	if (keys.length === 0 && trackedColumns.length > 0) return triggers;

	// Check if this entity is a composition target with @changelog on the composition field
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

	// Skip if no tracked columns and not a composition target with tracked composition
	if (trackedColumns.length === 0 && !compositionParentInfo) return triggers;

	// Generate triggers - either for tracked columns or for composition-only tracking
	if (!config?.disableCreateTracking) {
		triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo));
	}
	if (!config?.disableUpdateTracking) {
		triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo));
	}
	if (!config?.disableDeleteTracking) {
		const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
		triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo));
	}

	return triggers;
}

module.exports = { generateHANATriggers };
