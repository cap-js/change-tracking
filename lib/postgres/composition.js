const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
	const keyValues = keyValueExprs ?? binding.map((k) => `${refRow}.${k}`);
	const rootEntityKeyExpr = compositeKeyExpr(keyValues);

	if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== keyValues.length) return rootEntityKeyExpr;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = keyValueExprs ? { val: keyValues[i], literal: 'sql' } : { val: keyValues[i] };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		if (oid.expression) {
			const exprColumn = utils.buildExpressionColumn(oid.expression);
			const query = SELECT.one.from(rootEntity.name).columns(exprColumn).where(where);
			// Leave NULL as-is so CONCAT_WS skips unresolved expressions
			parts.push(`(${toSQL(query, model)})::TEXT`);
		} else {
			const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
			// Leave NULL as-is so CONCAT_WS skips unresolved association paths
			parts.push(`(${toSQL(query, model)})::TEXT`);
		}
	}

	const concatLogic = `CONCAT_WS(', ', ${parts.join(', ')})`;

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs, model, childObjectIDExpr = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = rec.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
	const parentKeyExpr = compositeKeyExpr(parentKeySubqueries);

	// Use child's objectID expression for the composition entry — shows which child was affected
	// Falls back to parent's own objectID if child objectID is not available
	const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

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
                            ${objectIDExpr},
                            now(),
                            user_id,
                            'cds.Composition',
                            comp_parent_modification,
                            transaction_id
                        );
                END IF;
            END IF;`;
}

function buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, modification, model, ancestorCompositionChain = [], childObjectIDExpr = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs, model, childObjectIDExpr);
	}

	const parentKeyExpr = compositeKeyExpr(parentKeyBinding.map((k) => `rec.${k}`));

	// Use child's objectID expression for the composition entry — shows which child was affected
	// Falls back to parent's own objectID if child objectID is not available
	const rootEntity = model.definitions[parentEntityName];
	const immediateParentObjectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, 'rec', model);

	if (ancestorCompositionChain.length > 0) {
		// Build the full chain of ancestor levels.
		// levels[0] = immediate parent, levels[1] = grandparent, levels[2] = great-grandparent, etc.
		const levels = [{ entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding }, ...ancestorCompositionChain];

		// Build key expressions for each level.
		const keyExprs = [parentKeyExpr]; // level 0
		const ancestorKeyValues = [parentKeyBinding.map((k) => `rec.${k}`)]; // level 0

		const childWhereClauses = [];
		const childEntity0 = model.definitions[levels[0].entityName];
		const childKeys0 = utils.extractKeys(childEntity0.keys);
		childWhereClauses.push(childKeys0.map((pk, j) => `${pk} = rec.${levels[0].keyBinding[j]}`).join(' AND '));

		for (let i = 1; i < levels.length; i++) {
			const childLevel = levels[i - 1];
			const ancestorLevel = levels[i];
			const prevWhere = childWhereClauses[i - 1];

			const whereForAncestor = ancestorLevel.keyBinding.map((fk) => `(SELECT ${fk} FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`);

			const ancestorEntity = model.definitions[ancestorLevel.entityName];
			const ancestorKeys = utils.extractKeys(ancestorEntity.keys);
			const thisWhere = ancestorKeys.map((pk, j) => `${pk} = ${whereForAncestor[j]}`).join(' AND ');
			childWhereClauses.push(thisWhere);

			ancestorKeyValues.push(whereForAncestor);
			keyExprs.push(compositeKeyExpr(whereForAncestor));
		}

		// Generate PL/pgSQL blocks from outermost ancestor down to the immediate parent.
		// Each level uses a variable (comp_ancestor_N_id for ancestors, comp_parent_id for immediate parent)
		// to hold its changelog entry ID.
		const blocks = [];

		for (let i = levels.length - 1; i >= 0; i--) {
			const level = levels[i];
			const levelKeyExpr = keyExprs[i];
			const isOutermost = i === levels.length - 1;
			const isImmediateParent = i === 0;

			// Variable name for this level's changelog entry ID
			const varName = isImmediateParent ? 'comp_parent_id' : `comp_ancestor_${i - 1}_id`;

			// parent_id: NULL for outermost, variable from the level above for inner levels
			let parentVarExpr;
			if (isOutermost) {
				parentVarExpr = 'NULL';
			} else {
				const parentIndex = i + 1;
				parentVarExpr = parentIndex === levels.length - 1 && parentIndex !== 0 ? `comp_ancestor_${parentIndex - 1}_id` : `comp_ancestor_${parentIndex - 1}_id`;
			}
			// Simplify: outermost = NULL, immediate parent references ancestor_0, ancestor_0 references ancestor_1, etc.
			if (!isOutermost) {
				const parentLevelIndex = i + 1;
				parentVarExpr = parentLevelIndex === 0 ? 'comp_parent_id' : `comp_ancestor_${parentLevelIndex - 1}_id`;
			}

			const modExpr = isImmediateParent ? `'${modification}'` : "'update'";

			// objectID: use child entity's objectID — shows which child was affected
			let objectIDExpr;
			if (isImmediateParent) {
				objectIDExpr = immediateParentObjectIDExpr;
			} else {
				// For ancestor levels, resolve the child entity's objectID via subquery
				const childEntityDef = model.definitions[level.childEntityName];
				if (childEntityDef && level.childObjectIDs && level.childObjectIDs.length > 0) {
					const childKeyValues = ancestorKeyValues[i - 1];
					objectIDExpr = buildCompOfManyRootObjectIDSelect(childEntityDef, level.childObjectIDs, null, null, model, childKeyValues);
				} else {
					objectIDExpr = keyExprs[i - 1];
				}
			}

			blocks.push(`SELECT id INTO ${varName} FROM sap_changelog_changes WHERE entity = '${level.entityName}'
                AND entitykey = ${levelKeyExpr}
                AND attribute = '${level.compositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF ${varName} IS NULL THEN
                ${varName} := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        ${varName},
                        ${parentVarExpr},
                        '${level.compositionFieldName}',
                        '${level.entityName}',
                        ${levelKeyExpr},
                        ${objectIDExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        ${modExpr},
                        transaction_id
                    );
            END IF;`);
		}
		return blocks.join('\n            ');
	}

	// No ancestors — single parent level
	const modificationExpr = `CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END`;

	return `SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
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
                        ${immediateParentObjectIDExpr},
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
