const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { getCompositionParentInfo, getAncestorCompositionChain, resolveCompositionObjectIDs, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, getElementSkipCondition, entityKeyExpr, getValueExpr, getWhereCondition, getLabelExpr, buildObjectIDExpr, toSQL, quote } = require('./sql-expressions.js');
const { buildCompositionParentContext, buildParentLookupOrCreateSQL, buildCompositionOnlyBody, buildCompOfManyRootObjectIDSelect } = require('./composition.js');

/**
 * Builds an objectID SQL expression from a parsed composition field @changelog.
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntityName, parentEntity, parentKeyBinding, rowRef, model) {
	const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, rowRef, quote);
	if (!parsed) return null;

	if (parsed.type === 'expression') {
		// HANA: use SELECT.from (not SELECT.one) to avoid TOP 1 in correlated subqueries
		const query = SELECT.from(parsed.parentEntityName).columns(parsed.exprColumn).where(parsed.where);
		return `TO_NVARCHAR((${toSQL(query, model)}))`;
	}

	return buildCompOfManyRootObjectIDSelect(parentEntity, parsed.objectIDs, parentKeyBinding, rowRef, model);
}

/**
 * Returns the FROM clause for statement-level trigger sub-SELECTs.
 * - For 'create': FROM :new_tab newTable
 * - For 'delete': FROM :old_tab oldTable
 * - For 'update': FROM :new_tab newTable INNER JOIN :old_tab oldTable ON newTable.key1 = oldTable.key1 [AND ...]
 */
function getFromClause(entity, modification) {
	const keys = utils.extractKeys(entity.keys);
	if (modification === 'create') {
		return 'FROM :new_tab newTable';
	}
	if (modification === 'delete') {
		return 'FROM :old_tab oldTable';
	}
	// update: join new and old tables on keys
	const joinCondition = keys.map((k) => `newTable.${k} = oldTable.${k}`).join(' AND ');
	return `FROM :new_tab newTable INNER JOIN :old_tab oldTable ON ${joinCondition}`;
}

function buildTriggerContext(entity, objectIDs, rowRef, model) {
	const keys = utils.extractKeys(entity.keys);
	return {
		entityKeyExpr: entityKeyExpr(keys.map((k) => `${rowRef}.${k}`)),
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

			const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'oldTable');
			const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'newTable');
			const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'oldTable', model, entity.name);
			const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'newTable', model, entity.name);

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

function generateCreateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		buildObjectIDExpr(objectIDs, entity, 'newTable', model),
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentName, parentEntity, keyBinding, 'newTable', model),
		model
	);
	const ctx = buildTriggerContext(entity, objectIDs, 'newTable', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'newTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
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

function generateUpdateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		buildObjectIDExpr(objectIDs, entity, 'newTable', model),
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentName, parentEntity, keyBinding, 'newTable', model),
		model
	);
	const ctx = buildTriggerContext(entity, objectIDs, 'newTable', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'newTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
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
		if (!c.target) return [quote(c.name)];
		if (c.foreignKeys) return c.foreignKeys.map((k) => quote(`${c.name}_${k.replaceAll(/\./g, '_')}`));
		if (c.on) return c.on.map((m) => quote(m.foreignKeyField));
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

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		buildObjectIDExpr(objectIDs, entity, 'oldTable', model),
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentName, parentEntity, keyBinding, 'oldTable', model),
		model
	);
	const ctx = buildTriggerContext(entity, objectIDs, 'oldTable', model);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'oldTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
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

function generateDeleteTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const keys = utils.extractKeys(entity.keys);
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		buildObjectIDExpr(objectIDs, entity, 'oldTable', model),
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentName, parentEntity, keyBinding, 'oldTable', model),
		model
	);
	const ctx = buildTriggerContext(entity, objectIDs, 'oldTable', model);

	const deleteSQL = `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey IN (SELECT ${entityKeyExpr(keys.map((k) => `oldTable.${k}`))} FROM :old_tab oldTable);`;

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'oldTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
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

	// Resolve full ancestor composition chain for deep linking
	const { ancestorChain } = grandParentContext;
	const ancestorCompositionChain = getAncestorCompositionChain(rootEntity, ancestorChain ?? [], csn);

	// Skip if no tracked columns and not a composition target with tracked composition
	if (trackedColumns.length === 0 && !compositionParentInfo) return triggers;

	// Generate triggers - either for tracked columns or for composition-only tracking
	if (!config?.disableCreateTracking) {
		triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, ancestorCompositionChain));
	}
	if (!config?.disableUpdateTracking) {
		triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, ancestorCompositionChain));
	}
	if (!config?.disableDeleteTracking) {
		const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
		triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootObjectIDs, csn, compositionParentInfo, ancestorCompositionChain));
	}

	return triggers;
}

module.exports = { generateHANATriggers };
