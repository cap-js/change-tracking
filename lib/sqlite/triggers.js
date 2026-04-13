const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getAncestorCompositionChain } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, buildObjectIDSelect, buildTriggerContext, buildInsertSQL, compositeKeyExpr } = require('./sql-expressions.js');
const { buildCompositionParentContext } = require('./composition.js');

function generateCreateTrigger(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	// Build the child entity's objectID expression for use in the composition parent entry
	const childKeys = utils.extractKeys(entity.keys);
	const childObjectIDExpr = buildObjectIDSelect(objectIDs, entity.name, childKeys, 'new', model) ?? compositeKeyExpr(childKeys.map((k) => `new.${k}`));
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new', model, ancestorCompositionChain, childObjectIDExpr) : null;
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
	// Build the child entity's objectID expression for use in the composition parent entry
	const childKeys = utils.extractKeys(entity.keys);
	const childObjectIDExpr = buildObjectIDSelect(objectIDs, entity.name, childKeys, 'new', model) ?? compositeKeyExpr(childKeys.map((k) => `new.${k}`));
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new', model, ancestorCompositionChain, childObjectIDExpr) : null;
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
	const ofColumns = columns.flatMap((c) => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) return c.foreignKeys.map((k) => `${c.name}_${k}`);
		if (c.on) return c.on.map((m) => `${c.name}_${m.foreignKeyField}`);
		return [];
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	// Build the child entity's objectID expression for use in the composition parent entry
	const childKeys = utils.extractKeys(entity.keys);
	const childObjectIDExpr = buildObjectIDSelect(objectIDs, entity.name, childKeys, 'old', model) ?? compositeKeyExpr(childKeys.map((k) => `old.${k}`));
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', model, ancestorCompositionChain, childObjectIDExpr) : null;
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
	// Build the child entity's objectID expression for use in the composition parent entry
	const childKeys = utils.extractKeys(entity.keys);
	const childObjectIDExpr = buildObjectIDSelect(objectIDs, entity.name, childKeys, 'old', model) ?? compositeKeyExpr(childKeys.map((k) => `old.${k}`));
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', model, ancestorCompositionChain, childObjectIDExpr) : null;
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
