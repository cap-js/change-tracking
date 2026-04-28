const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const { getCompositionParentInfo, getAncestorCompositionChain, resolveCompositionObjectIDs, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, entityKeyExpr, buildObjectIDAssignment, buildInsertBlock, extractTrackedDbColumns, quote } = require('./sql-expressions.js');
const { buildCompositionParentBlock, buildCompOfManyRootObjectIDSelect } = require('./composition.js');
const config = cds.env.requires['change-tracking'];

/**
 * Builds an objectID SQL expression from a parsed composition field @changelog.
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntity, parentKeyBinding, model) {
	const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, 'rec', quote);
	if (!parsed) return null;

	if (parsed.type === 'expression') {
		const { toSQL } = require('./sql-expressions.js');
		const query = SELECT.one.from(parentEntity.name).columns(parsed.exprColumn).where(parsed.where);
		return `(${toSQL(query, model)})::TEXT`;
	}

	return buildCompOfManyRootObjectIDSelect(parentEntity, parsed.objectIDs, parentKeyBinding, 'rec', model);
}

/**
 * Generates the PL/pgSQL function body for the main change tracking trigger
 */
function buildFunctionBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, ancestorCompositionChain = []) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = entityKeyExpr(keys.map((k) => `rec.${quote(k)}`));

	const objectIDAssignment = buildObjectIDAssignment(objectIDs, entity, keys, 'rec', 'object_id', model);

	const hasCompositionParent = compositionParentInfo !== null;
	const createBlock = columns.length > 0 ? buildInsertBlock(columns, 'create', entity, model, hasCompositionParent) : '';
	const updateBlock = columns.length > 0 ? buildInsertBlock(columns, 'update', entity, model, hasCompositionParent) : '';
	const deleteBlock = columns.length > 0 ? buildInsertBlock(columns, 'delete', entity, model, hasCompositionParent) : '';

	// Build composition parent blocks if needed
	// For composition-of-one: pass child's object_id variable as the objectID for composition entries
	// For composition-of-many: don't use child's objectID; use field-level @changelog or parent's objectID
	const { childObjectIDExpr, compositionFieldObjectIDExpr } = resolveCompositionObjectIDs(
		compositionParentInfo,
		'object_id',
		(changelog, parentName, parentEntity, keyBinding) => buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, model),
		model
	);

	const createParentBlock =
		compositionParentInfo && !config?.disableCreateTracking ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'create', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : '';
	const updateParentBlock =
		compositionParentInfo && !config?.disableUpdateTracking ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'update', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : '';
	const deleteParentBlock =
		compositionParentInfo && !config?.disableDeleteTracking ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'delete', model, ancestorCompositionChain, childObjectIDExpr, compositionFieldObjectIDExpr) : '';

	return `
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT ${getSkipCheckCondition(entity.name)} THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := ${entityKey};
            ${objectIDAssignment}

            IF (TG_OP = 'INSERT') THEN
                ${createParentBlock}
                ${createBlock}
            ELSIF (TG_OP = 'UPDATE') THEN
                ${updateParentBlock}
                ${updateBlock}
            ELSIF (TG_OP = 'DELETE') THEN
                ${deleteParentBlock}
                ${deleteBlock}
            END IF;
        END;`;
}

function generatePostgresTriggers(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
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
	if (!shouldGenerateTriggers) return triggers;

	const tableName = entity.name.replace(/\./g, '_').toLowerCase();
	const triggerName = `${tableName}_tr_change`;
	const functionName = `${tableName}_func_change`;

	const funcBody = buildFunctionBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, ancestorCompositionChain);

	// Include variable declarations for composition parent and ancestor IDs
	const parentIdDecl = compositionParentInfo ? 'comp_parent_id UUID := NULL;' : '';
	const parentModificationDecl = compositionParentInfo?.parentKeyBinding?.type === 'compositionOfOne' ? 'comp_parent_modification TEXT;' : '';
	const ancestorIdDecls = ancestorCompositionChain.map((_, i) => `comp_ancestor_${i}_id UUID := NULL;`).join('\n        ');

	const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := '${entity.name}';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        ${parentIdDecl}
        ${parentModificationDecl}
        ${ancestorIdDecls}
    BEGIN
        ${funcBody}
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;`;

	triggers.push(createFunction);

	const trackedDbColumns = extractTrackedDbColumns(trackedColumns);
	const updateOfClause = trackedDbColumns.length > 0 ? `UPDATE OF ${trackedDbColumns.join(', ')}` : 'UPDATE';
	const createTrigger = `CREATE OR REPLACE TRIGGER ${triggerName}
    AFTER INSERT OR ${updateOfClause} OR DELETE ON "${tableName}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `;

	triggers.push(createTrigger);

	return triggers;
}

module.exports = { generatePostgresTriggers };
