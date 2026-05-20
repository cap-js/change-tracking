const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getAncestorCompositionChain, resolveCompositionObjectIDs, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, buildObjectIDSelect: buildObjectIdSqlExpr, buildTriggerContext, buildInsertSQL, toSQL, quote } = require('./sql-expressions.js');
const { buildCompositionParentContext } = require('./composition.js');

/**
 * Builds an objectID SQL expression from a parsed composition field @changelog.
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, model) {
	const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, quote);
	if (!parsed) return null;

	if (parsed.type === 'expression') {
		const query = SELECT.one.from(parentEntity.name).columns(parsed.exprColumn).where(parsed.where);
		return `(${toSQL(query, model)})`;
	}

	const parentKeys = utils.extractKeys(parentEntity.keys);
	return buildObjectIdSqlExpr(parsed.objectIDs, parentEntity, parentKeys, refRow, model);
}

function generateCreateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const defaultChildObjectIDExpr = buildObjectIdSqlExpr(objectIDs, entity, 'new', model);
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		defaultChildObjectIDExpr,
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, 'new', model),
		model
	);

	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'new', model, compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx, model);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'create', ctx, model);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateUpdateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const defaultChildObjectIDExpr = buildObjectIdSqlExpr(objectIDs, entity, 'new', model);
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		defaultChildObjectIDExpr,
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, 'new', model),
		model
	);

	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'new', model, compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx, model);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'update', ctx, model);
	}

	// Build OF clause for targeted update trigger
	const ofColumns = [
		...new Set(
			columns.flatMap((c) => {
				if (!c.target) return [quote(c.name)];
				if (c.foreignKeys) return c.foreignKeys.map((k) => quote(`${c.name}_${k}`));
				if (c.on) return c.on.map((m) => quote(m.foreignKeyField));
				return [];
			})
		)
	];
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const defaultChildObjectIDExpr = buildObjectIdSqlExpr(objectIDs, entity, 'old', model);
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		defaultChildObjectIDExpr,
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, 'old', model),
		model
	);

	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'old', model, compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const defaultChildObjectIDExpr = buildObjectIdSqlExpr(objectIDs, entity, 'old', model);
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		defaultChildObjectIDExpr,
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, 'old', model),
		model
	);

	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'old', model, compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	const deleteSQL = `DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${ctx.entityKey};`;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = `${deleteSQL}\n        ${compositionParentContext.insertSQL}`;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		bodySQL = `${deleteSQL}\n        ${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx, model);
		bodySQL = `${deleteSQL}\n        ${insertSQL}`;
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateSQLiteTrigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Resolve full ancestor composition chain for deep linking
	const { ancestorChain } = grandParentContext;
	const ancestorCompositionChain = getAncestorCompositionChain(rootEntity, ancestorChain ?? [], csn);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;

	if (shouldGenerateTriggers) {
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
	}

	return triggers.length === 1 ? triggers[0] : triggers.length > 0 ? triggers : null;
}

module.exports = { generateSQLiteTrigger };
