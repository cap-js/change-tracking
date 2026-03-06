const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { setModel, getSkipCheckCondition, buildTriggerContext, buildInsertSQL } = require('./sql-expressions.js');
const { buildCompositionParentContext } = require('./composition.js');

function generateCreateTrigger(entity, columns, objectIDs, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new', grandParentCompositionInfo) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'new', compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'create', ctx);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateUpdateTrigger(entity, columns, objectIDs, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new', grandParentCompositionInfo) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'new', compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'update', ctx);
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

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', grandParentCompositionInfo) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'old', compositionParentInfo);

	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'delete', ctx);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTrigger(entity, columns, objectIDs, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', grandParentCompositionInfo) : null;
	const ctx = buildTriggerContext(entity, objectIDs, 'old', compositionParentInfo);

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
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		bodySQL = `${deleteSQL}\n        ${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
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
	setModel(csn);
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;

	if (shouldGenerateTriggers) {
		if (!config?.disableCreateTracking) {
			triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
		}
		if (!config?.disableUpdateTracking) {
			triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
		}
		if (!config?.disableDeleteTracking) {
			const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
			triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
		}
	}

	return triggers.length === 1 ? triggers[0] : triggers.length > 0 ? triggers : null;
}

module.exports = { generateSQLiteTrigger };
