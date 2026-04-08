const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many.
 * @param {object} rootEntity - The entity to look up objectIDs from
 * @param {Array} rootObjectIDs - The @changelog objectID definitions
 * @param {Array} binding - FK column names on the child entity (e.g., ['parent_ID'])
 * @param {string} refRow - Trigger row reference (e.g., 'new' or 'old')
 * @param {object} model - The CDS model
 * @param {Array} [keyValueExprs] - Optional pre-built key value expressions (e.g., subquery strings).
 *   When provided, used instead of computing `${refRow}.${binding[i]}` for each key.
 *   Uses `literal: 'sql'` to prevent CQN from quoting subquery expressions as string literals.
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

	// Clone to avoid mutation
	const oids = rootObjectIDs.map((o) => ({ ...o }));
	for (const oid of oids) {
		if (oid.expression) {
			// Expression-based ObjectID: use expression as column
			const exprColumn = utils.buildExpressionColumn(oid.expression);
			const q = SELECT.one.from(rootEntity.name).columns(exprColumn).where(where);
			oid.selectSQL = toSQL(q, model);
		} else {
			const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
			oid.selectSQL = toSQL(q, model);
		}
	}

	const unions = oids.map((oid) => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n');
	return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;
}

function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = ${rowRef}.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
	const parentKeyExpr = compositeKeyExpr(parentKeySubqueries);

	// Build rootObjectID expression for the parent entity
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

	const modificationExpr = `CASE WHEN EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND modification = 'create'
			AND createdBy = session_context('$user.id')
			AND createdAt = session_context('$now')
		) THEN 'create' ELSE 'update' END`;

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'${compositionFieldName}',
			'${parentEntityName}',
			${parentKeyExpr},
			${rootObjectIDExpr},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			${modificationExpr},
			session_context('$now')
		WHERE EXISTS (
			SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
		)
		AND NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND createdBy = session_context('$user.id')
			AND createdAt = session_context('$now')
		);`;

	// SELECT SQL to get the parent_ID for child entries
	const parentLookupExpr = `(SELECT ID FROM sap_changelog_Changes
		WHERE entity = '${parentEntityName}'
		AND entityKey = ${parentKeyExpr}
		AND attribute = '${compositionFieldName}'
		AND valueDataType = 'cds.Composition'
		AND createdBy = session_context('$user.id')
		ORDER BY createdAt DESC LIMIT 1)`;

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model, ancestorCompositionChain = []) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model);
	}

	const parentKeyExpr = compositeKeyExpr(parentKeyBinding.map((k) => `${rowRef}.${k}`));

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef, model);

	let insertSQL;

	if (ancestorCompositionChain.length > 0) {
		// Build the full chain of ancestor levels.
		// levels[0] = immediate parent (compositionParentInfo)
		// levels[1] = grandparent (ancestorCompositionChain[0])
		// levels[2] = great-grandparent (ancestorCompositionChain[1])

		const levels = [{ entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding }, ...ancestorCompositionChain];

		// Build key expressions for each level.
		const keyExprs = [parentKeyExpr]; // level 0

		// For each level, we also need to know the WHERE clause to find the child record
		// childWhereClause[i] = WHERE clause on level[i]'s table to find the record for this trigger row
		const childWhereClauses = [];
		// ancestorKeyValues[i] = array of raw SQL expressions that resolve each key of level[i]'s entity
		// Used for both keyExprs and objectID resolution via buildCompOfManyRootObjectIDSelect
		const ancestorKeyValues = [parentKeyBinding.map((k) => `${rowRef}.${k}`)]; // level 0

		// Level 0: find Level1Sample record using trigger row FK
		const childEntity0 = model.definitions[levels[0].entityName];
		const childKeys0 = utils.extractKeys(childEntity0.keys);
		childWhereClauses.push(childKeys0.map((pk, j) => `${pk} = ${rowRef}.${levels[0].keyBinding[j]}`).join(' AND '));

		for (let i = 1; i < levels.length; i++) {
			const childLevel = levels[i - 1];
			const ancestorLevel = levels[i];

			// WHERE clause to find the child level's record: use the previous level's WHERE to navigate up
			const prevWhere = childWhereClauses[i - 1];

			// The ancestor key is found by using preWhere
			// SELECT ancestorLevel.keyBinding FROM childLevel.table WHERE prevWhere
			const whereForAncestor = ancestorLevel.keyBinding.map((fk) => `(SELECT ${fk} FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`);

			const ancestorEntity = model.definitions[ancestorLevel.entityName];
			const ancestorKeys = utils.extractKeys(ancestorEntity.keys);
			const thisWhere = ancestorKeys.map((pk, j) => `${pk} = ${whereForAncestor[j]}`).join(' AND ');
			childWhereClauses.push(thisWhere);

			ancestorKeyValues.push(whereForAncestor);
			keyExprs.push(compositeKeyExpr(whereForAncestor));
		}

		// Generate INSERT statements from outermost ancestor down to the immediate parent
		const insertStatements = [];

		for (let i = levels.length - 1; i >= 0; i--) {
			const level = levels[i];
			const levelKeyExpr = keyExprs[i];
			const isOutermost = i === levels.length - 1;
			const isImmediateParent = i === 0;

			// parent_ID: NULL for outermost, lookup for inner levels
			let parentIDExpr;
			if (isOutermost) {
				parentIDExpr = 'NULL';
			} else {
				const parentLevel = levels[i + 1];
				const parentLevelKeyExpr = keyExprs[i + 1];
				parentIDExpr = `(SELECT ID FROM sap_changelog_Changes
				WHERE entity = '${parentLevel.entityName}'
				AND entityKey = ${parentLevelKeyExpr}
				AND attribute = '${parentLevel.compositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND createdBy = session_context('$user.id')
				AND createdAt = session_context('$now')
				ORDER BY createdAt DESC LIMIT 1)`;
			}

			// Immediate parent use the actual modification type, ancestors use 'update' (they are just being touched, not created/deleted)
			const modExpr = isImmediateParent ? `'${modification}'` : "'update'";

			// objectID: resolve from the entity's @changelog annotation via buildCompOfManyRootObjectIDSelect
			let objectIDExpr;
			if (isImmediateParent) {
				objectIDExpr = rootObjectIDExpr;
			} else {
				const ancestorEntity = model.definitions[level.entityName];
				objectIDExpr = buildCompOfManyRootObjectIDSelect(ancestorEntity, level.objectIDs, null, null, model, ancestorKeyValues[i]);
			}

			insertStatements.push(`INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				${parentIDExpr},
				'${level.compositionFieldName}',
				'${level.entityName}',
				${levelKeyExpr},
				${objectIDExpr},
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				${modExpr},
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = '${level.entityName}'
				AND entityKey = ${levelKeyExpr}
				AND attribute = '${level.compositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND createdBy = session_context('$user.id')
				AND createdAt = session_context('$now')
			);`);
		}

		insertSQL = insertStatements.join('\n        ');
	} else {
		const modificationExpr = `CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = '${parentEntityName}'
				AND entityKey = ${parentKeyExpr}
				AND modification = 'create'
				AND createdBy = session_context('$user.id')
				AND createdAt = session_context('$now')
			) THEN 'create' ELSE 'update' END`;

		insertSQL = `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				${modificationExpr},
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = '${parentEntityName}'
				AND entityKey = ${parentKeyExpr}
				AND attribute = '${compositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND createdBy = session_context('$user.id')
				AND createdAt = session_context('$now')
			);`;
	}

	// SELECT SQL to get the parent_ID for child entries
	const parentLookupExpr = `(SELECT ID FROM sap_changelog_Changes
		WHERE entity = '${parentEntityName}'
		AND entityKey = ${parentKeyExpr}
		AND attribute = '${compositionFieldName}'
		AND valueDataType = 'cds.Composition'
		AND createdBy = session_context('$user.id')
		ORDER BY createdAt DESC LIMIT 1)`;

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

module.exports = {
	buildCompOfManyRootObjectIDSelect,
	buildCompositionOfOneParentContext,
	buildCompositionParentContext
};
