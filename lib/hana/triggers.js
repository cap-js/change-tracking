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
		entityKeyExpr: entityKeyExpr(keys.map((k) => `x.${k}`)),
		objectIDExpr: buildObjectIDExpr(objectIDs, entity, 'x', model),
		parentLookupExpr: null
	};
}

/**
 * Collects the set of column names that the outer SELECT needs from the inner
 * UNION ALL subquery (aliased as 'x'). These columns must be projected through
 * every inner SELECT branch so the outer SELECT can reference them as x.<col>.
 *
 * Includes: entity keys, parent FK columns (for composition children),
 * included objectID fields, and column refs from expression-based objectIDs.
 */
function collectOuterSelectColumns(entity, objectIDs, parentFKColumns) {
	const cols = new Set();
	// 1. Entity keys — always needed for entityKeyExpr and objectIDExpr fallback
	const keys = utils.extractKeys(entity.keys);
	for (const k of keys) cols.add(k);
	// 2. Parent FK columns — needed for parentLookupExpr (composition children only)
	if (parentFKColumns) {
		for (const fk of parentFKColumns) cols.add(fk);
	}
	// 3. objectID field references
	if (objectIDs) {
		for (const oid of objectIDs) {
			if (oid.included) {
				// Directly referenced as x.<field> in the outer SELECT
				cols.add(oid.name);
			} else if (oid.expression) {
				// Extract column refs from expression xpr tree
				const exprRefs = extractExpressionColumnRefs(oid.expression, entity);
				for (const r of exprRefs) cols.add(r);
			}
			// Non-included, non-expression: uses subquery with entity keys (already added above)
		}
	}
	return [...cols];
}
/**
 * Extracts direct column references from a CDS expression (xpr array).
 * For single-segment refs like { ref: ['name'] }, returns 'name'.
 * For multi-segment refs like { ref: ['customer', 'name'] } (association paths),
 * returns the FK column names on the entity (e.g., 'customer_ID').
 */
function extractExpressionColumnRefs(xpr, entity) {
	const refs = new Set();
	if (!xpr) return refs;
	for (const token of xpr) {
		if (token && token.ref) {
			if (token.ref.length === 1) {
				refs.add(token.ref[0]);
			} else {
				// Association path — need FK columns for the association
				const assocName = token.ref[0];
				const assocElement = entity?.elements?.[assocName];
				if (assocElement?.keys) {
					for (const k of assocElement.keys) {
						refs.add(`${assocName}_${k.ref.join('_')}`);
					}
				} else if (assocElement?.on) {
					for (let i = 0; i < assocElement.on.length; i += 4) {
						const fkRef = assocElement.on[i + 2];
						if (fkRef?.ref) {
							refs.add(fkRef.ref[fkRef.ref.length - 1]);
						}
					}
				}
			}
		}
	}
	return refs;
}

function buildInsertSQL(entity, columns, modification, ctx, model, outerColumns) {
	const fromClause = getFromClause(entity, modification);
	const rowRef = modification === 'delete' ? 'oldTable' : 'newTable';

	// Build the passthrough column expressions for the inner SELECTs
	// These are projected unchanged so the outer SELECT can reference them as x.<col>
	const passthroughSelect = outerColumns.map((c) => `${rowRef}.${quote(c)}`).join(', ');

	// Generate inner UNION ALL query for all changed columns
	const unionQuery = columns.filter(c => c.type !== 'cds.Composition')
		.map((col) => {
			const whereCondition = getWhereCondition(col, modification);
			const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
			let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

			const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'oldTable');
			const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'newTable');
			const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'oldTable', model, entity.name);
			const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'newTable', model, entity.name);

			const dataType = col.altExpression ? 'cds.String' : col.type;

			return `SELECT
				${passthroughSelect},
				'${col.name}' AS attribute,
				${oldVal} AS valueChangedFrom,
				${newVal} AS valueChangedTo,
				${oldLabel} AS valueChangedFromLabel,
				${newLabel} AS valueChangedToLabel,
				'${dataType}' AS valueDataType
			${fromClause} WHERE ${fullWhere}`;
		})
		.join('\nUNION ALL\n');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				SYSUUID AS ID,
				${ctx.parentLookupExpr ?? 'NULL'} AS parent_ID,
				x.attribute,
				x.valueChangedFrom,
				x.valueChangedTo,
				x.valueChangedFromLabel,
				x.valueChangedToLabel,
				'${entity.name}' AS entity,
				${ctx.entityKeyExpr} AS entityKey,
				${ctx.objectIDExpr} AS objectID,
				CURRENT_TIMESTAMP AS createdAt,
				SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
				x.valueDataType,
				'${modification}' AS modification,
				CURRENT_UPDATE_TRANSACTION() AS transactionID
			FROM (
				${unionQuery}
			) x;`;
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
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'newTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr, 'x') : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Compute columns needed in inner SELECTs for the outer SELECT to reference via x.*
	const parentFKColumns = compositionParentInfo?.parentKeyBinding;
	const outerColumns = collectOuterSelectColumns(entity, objectIDs, Array.isArray(parentFKColumns) ? parentFKColumns : null);

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx, model, outerColumns);
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
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'newTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr, 'x') : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Compute columns needed in inner SELECTs for the outer SELECT to reference via x.*
	const parentFKColumns = compositionParentInfo?.parentKeyBinding;
	const outerColumns = collectOuterSelectColumns(entity, objectIDs, Array.isArray(parentFKColumns) ? parentFKColumns : null);

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx, model, outerColumns);
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
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'oldTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr, 'x') : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Compute columns needed in inner SELECTs for the outer SELECT to reference via x.*
	const parentFKColumns = compositionParentInfo?.parentKeyBinding;
	const outerColumns = collectOuterSelectColumns(entity, objectIDs, Array.isArray(parentFKColumns) ? parentFKColumns : null);

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model, outerColumns);
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
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'oldTable', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr, 'x') : null;
	if (compositionParentContext) ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;

	// Compute columns needed in inner SELECTs for the outer SELECT to reference via x.*
	const parentFKColumns = compositionParentInfo?.parentKeyBinding;
	const outerColumns = collectOuterSelectColumns(entity, objectIDs, Array.isArray(parentFKColumns) ? parentFKColumns : null);

	// Special wrapping for delete - need variable declared if using composition
	let body;
	if (columns.length === 0 && compositionParentContext) {
		// Composition-only case: only insert composition parent entry, no child column inserts
		body = buildCompositionOnlyBody(entity.name, compositionParentContext, deleteSQL);
	} else if (compositionParentContext) {
		// Mixed case: both composition parent entry and child column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model, outerColumns);
		const { declares } = compositionParentContext;
		const declareBlock = declares ? `${declares}\n\t` : '';
		body = `${declareBlock}IF ${getSkipCheckCondition(entity.name)} THEN
		${deleteSQL}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
	} else {
		// No composition: standard delete with column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model, outerColumns);
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
