const utils = require('../utils/change-tracking.js');
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, compositeKeyExpr, buildObjectIDAssignment, buildInsertBlock, extractTrackedDbColumns } = require('./sql-expressions.js');
const { buildCompositionParentBlock } = require('./composition.js');

/**
 * Generates the PL/pgSQL function body for the main change tracking trigger
 */
function buildFunctionBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = compositeKeyExpr(keys.map((k) => `rec.${k}`));

	const objectIDAssignment = buildObjectIDAssignment(objectIDs, entity, keys, 'rec', 'object_id', model);

	const hasCompositionParent = compositionParentInfo !== null;
	const createBlock = columns.length > 0 ? buildInsertBlock(columns, 'create', entity, model, hasCompositionParent) : '';
	const updateBlock = columns.length > 0 ? buildInsertBlock(columns, 'update', entity, model, hasCompositionParent) : '';
	const deleteBlock = columns.length > 0 ? buildInsertBlock(columns, 'delete', entity, model, hasCompositionParent) : '';

	// Build composition parent blocks if needed
	const createParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'create', model, grandParentCompositionInfo) : '';
	const updateParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'update', model, grandParentCompositionInfo) : '';
	const deleteParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'delete', model, grandParentCompositionInfo) : '';

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

            entity_key := ${entityKeyExpr};
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

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
	if (!shouldGenerateTriggers) return triggers;

	const tableName = entity.name.replace(/\./g, '_').toLowerCase();
	const triggerName = `${tableName}_tr_change`;
	const functionName = `${tableName}_func_change`;

	const funcBody = buildFunctionBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo);

	// Include comp_parent_id, comp_parent_modification and comp_grandparent_id variable declarations if needed
	const parentIdDecl = compositionParentInfo ? 'comp_parent_id UUID := NULL;' : '';
	const parentModificationDecl = compositionParentInfo?.parentKeyBinding?.type === 'compositionOfOne' ? 'comp_parent_modification TEXT;' : '';
	const grandparentIdDecl = grandParentCompositionInfo ? 'comp_grandparent_id UUID := NULL;' : '';

	const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := '${entity.name}';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        ${parentIdDecl}
        ${parentModificationDecl}
        ${grandparentIdDecl}
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
