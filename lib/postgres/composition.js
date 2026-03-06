const utils = require('../utils/change-tracking.js');
const { getModel, toSQL, compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) return `'${rootEntity.name}'`;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return `'${rootEntity.name}'`;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
	}

	const concatLogic = `CONCAT_WS(', ', ${parts.join(', ')})`;
	const rootEntityKeyExpr = compositeKeyExpr(binding.map((k) => `${refRow}.${k}`));

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs) {
	const model = getModel();
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = rec.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeyExpr = compositeKeyExpr(parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`));

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) => `(SELECT ${oid.name}::TEXT FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
		rootObjectIDExpr = oidSelects.length > 1 ? `CONCAT_WS(', ', ${oidSelects.join(', ')})` : oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

	// Build the composition parent block with dynamic modification determination
	return `SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO comp_parent_modification
                FROM sap_changelog_changes
                WHERE entity = '${parentEntityName}'
                AND entitykey = ${parentKeyExpr}
                AND modification = 'create'
                AND transactionid = transaction_id;
            
            IF EXISTS (SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}) THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND attribute = '${compositionFieldName}'
                    AND valuedatatype = 'cds.Composition'
                    AND transactionid = transaction_id;
                IF comp_parent_id IS NULL THEN
                    comp_parent_id := gen_random_uuid();
                    INSERT INTO sap_changelog_changes
                        (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                        VALUES (
                            comp_parent_id,
                            NULL,
                            '${compositionFieldName}',
                            '${parentEntityName}',
                            ${parentKeyExpr},
                            ${rootObjectIDExpr},
                            now(),
                            user_id,
                            'cds.Composition',
                            comp_parent_modification,
                            transaction_id
                        );
                END IF;
            END IF;`;
}

function buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, modification, grandParentCompositionInfo = null) {
	const model = getModel();
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs);
	}

	const parentKeyExpr = compositeKeyExpr(parentKeyBinding.map((k) => `rec.${k}`));

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, 'rec');

	let grandparentBlock = '';
	let grandparentLookupExpr = 'NULL';

	if (grandParentCompositionInfo) {
		// When we have grandparent info, we need to:
		// 1. Create grandparent entry (Order.orderItems) for current transaction if not exists
		// 2. Create parent entry (OrderItem.notes) linking to the grandparent entry
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build WHERE clause to find the parent entity record
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = rec.${parentKeyBinding[i]}`).join(' AND ');

		// Build the grandparent key expression from the parent record
		const grandParentKeyExpr = compositeKeyExpr(grandParentKeyBinding.map((k) => `(SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`));

		// Create grandparent entry if not exists in this transaction
		grandparentBlock = `-- First ensure grandparent entry exists for this transaction
            SELECT id INTO comp_grandparent_id FROM sap_changelog_changes WHERE entity = '${grandParentEntityName}'
                AND entitykey = ${grandParentKeyExpr}
                AND attribute = '${grandParentCompositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_grandparent_id IS NULL THEN
                comp_grandparent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_grandparent_id,
                        NULL,
                        '${grandParentCompositionFieldName}',
                        '${grandParentEntityName}',
                        ${grandParentKeyExpr},
                        ${grandParentKeyExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;`;

		grandparentLookupExpr = 'comp_grandparent_id';
	}

	// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
	// This handles both deep insert (parent created in same tx) and independent insert (parent already existed)
	const modificationExpr = grandParentCompositionInfo
		? `'${modification}'` // When grandparent exists, use provided modification
		: `CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END`;

	// PL/pgSQL block that checks for existing parent entry and creates one if needed
	return `${grandparentBlock}
            SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                AND entitykey = ${parentKeyExpr}
                AND attribute = '${compositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        ${grandparentLookupExpr},
                        '${compositionFieldName}',
                        '${parentEntityName}',
                        ${parentKeyExpr},
                        ${rootObjectIDExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        ${modificationExpr},
                        transaction_id
                    );
            END IF;`;
}

module.exports = {
	buildCompOfManyRootObjectIDSelect,
	buildCompositionOfOneParentBlock,
	buildCompositionParentBlock
};
