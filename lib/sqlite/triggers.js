const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getAncestorCompositionChain, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
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

/**
 * Generates a single SQLite trigger (CREATE, UPDATE, or DELETE) for an entity.
 */
function generateTrigger(entity, columns, objectIDs, rootObjectIDs, model, modification, compositionParentInfo, ancestorCompositionChain) {
	const refRow = modification === 'delete' ? 'old' : 'new';
	const ctx = buildTriggerContext(entity, objectIDs, refRow, model);

	let compositionParentContext = null;
	if (compositionParentInfo) {
		compositionParentContext = buildCompositionParentContext(
			compositionParentInfo, rootObjectIDs, modification, refRow, model,
			ancestorCompositionChain, ctx.objectID,
			(changelog, parentName, parentEntity, keyBinding) =>
				buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, refRow, model)
		);
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Build trigger body parts
	const bodyParts = [];

	// Delete trigger (non-preserve mode): prepend DELETE FROM statement
	if (modification === 'delete' && !config?.preserveDeletes) {
		bodyParts.push(`DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${ctx.entityKey};`);
	}

	// Composition parent INSERT (if applicable)
	if (compositionParentContext) {
		bodyParts.push(compositionParentContext.insertSQL);
	}

	// Column changes INSERT (if there are tracked columns)
	if (columns.length > 0) {
		bodyParts.push(buildInsertSQL(entity, columns, modification, ctx, model));
	}

	const bodySQL = bodyParts.join('\n        ');

	// Build event clause
	let eventClause;
	if (modification === 'create') {
		eventClause = 'AFTER INSERT';
	} else if (modification === 'update') {
		const ofColumns = columns.flatMap((c) => {
			if (!c.target) return [quote(c.name)];
			if (c.foreignKeys) return c.foreignKeys.map((k) => quote(`${c.name}_${k}`));
			if (c.on) return c.on.map((m) => quote(`${c.name}_${m.foreignKeyField}`));
			return [];
		});
		const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';
		eventClause = `AFTER UPDATE ${ofClause}`;
	} else {
		eventClause = 'AFTER DELETE';
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_${modification} ${eventClause}
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
		const modifications = [];
		if (!config?.disableCreateTracking) modifications.push('create');
		if (!config?.disableUpdateTracking) modifications.push('update');
		if (!config?.disableDeleteTracking) modifications.push('delete');

		for (const modification of modifications) {
			triggers.push(generateTrigger(entity, trackedColumns, objectIDs, rootObjectIDs, csn, modification, compositionParentInfo, ancestorCompositionChain));
		}
	}

	return triggers.length === 1 ? triggers[0] : triggers.length > 0 ? triggers : null;
}

module.exports = { generateSQLiteTrigger };
