const utils = require('../utils/change-tracking.js');
const { toSQL, entityKeyExpr, quote } = require('./sql-expressions.js');

/**
 * Builds a subquery to look up a changelog entry ID used for parent_ID linking in composition hierarchies
 */
function buildChangelogLookupExpr(entityName, keyExpr, compositionFieldName) {
	return `(SELECT ID FROM sap_changelog_Changes
		WHERE entity = '${entityName}'
		AND entityKey = ${keyExpr}
		AND attribute = '${compositionFieldName}'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1)`;
}

/**
 * Builds an INSERT statement for a composition changelog entry.
 * @param {object} params
 * @param {string} params.parentIDExpr - SQL expression for parent_ID (NULL or subquery)
 * @param {string} params.compositionFieldName - The composition element name (attribute)
 * @param {string} params.entityName - The parent entity name
 * @param {string} params.keyExpr - SQL expression for the entity key
 * @param {string} params.objectIDExpr - SQL expression for objectID
 * @param {string} [params.existsClause] - Optional extra WHERE EXISTS clause (for composition-of-one)
 */
function buildCompositionChangelogInsert({ parentIDExpr, compositionFieldName, entityName, keyExpr, objectIDExpr, existsClause }) {
	const existsCondition = existsClause ? `WHERE ${existsClause}
		AND NOT EXISTS (` : `WHERE NOT EXISTS (`;

	return `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			${parentIDExpr},
			'${compositionFieldName}',
			'${entityName}',
			${keyExpr},
			${objectIDExpr},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		${existsCondition}
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${entityName}'
			AND entityKey = ${keyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);`;
}

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
	const keyValues = keyValueExprs ?? binding.map((k) => `${refRow}.${quote(k)}`);
	const rootEntityKeyExpr = entityKeyExpr(keyValues);

	if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

	// REVISIT
	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== keyValues.length) return rootEntityKeyExpr;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: keyValues[i], literal: 'sql' };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		if (oid.expression) {
			const exprColumn = utils.buildExpressionColumn(oid.expression);
			const q = SELECT.one.from(rootEntity.name).columns(exprColumn).where(where);
			parts.push(toSQL(q, model));
		} else {
			const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
			parts.push(toSQL(q, model));
		}
	}

	// Single objectID field: simple COALESCE, no GROUP_CONCAT needed
	if (parts.length === 1) {
		return `COALESCE((${parts[0]}), ${rootEntityKeyExpr})`;
	}

	// Multiple objectID fields: use GROUP_CONCAT, fall back to entityKey when ALL are NULL
	const unions = parts.map((part) => `SELECT (${part}) AS value`).join('\nUNION ALL\n');
	const concatExpr = `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;

	const nullChecks = parts.map((p) => `(${p}) IS NULL`).join(' AND ');
	return `(CASE WHEN ${nullChecks} THEN ${rootEntityKeyExpr} ELSE ${concatExpr} END)`;
}

function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, rowRef, model, childObjectIDExpr = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;
	const parentFKFields = childKeys.map((k) => quote(`${compositionName}_${k}`));
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);

	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = ${rowRef}.${quote(childKeys[i])}`).join(' AND ');
	// Build the parent key expression via subquery (reverse lookup)
	const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${quote(pk)} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
	const parentKeyExpr = entityKeyExpr(parentKeySubqueries);
	// Use child's objectID expression for the composition entry
	// Falls back to parent's own objectID if child objectID is not available
	const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

	const insertSQL = buildCompositionChangelogInsert({
		parentIDExpr: 'NULL',
		compositionFieldName,
		entityName: parentEntityName,
		keyExpr: parentKeyExpr,
		objectIDExpr,
		existsClause: `EXISTS (
			SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
		)`
	});

	const parentLookupExpr = buildChangelogLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName);

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, rowRef, model, ancestorCompositionChain = [], childObjectID = null, buildFieldObjectIDFn = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, rowRef, model, childObjectID);
	}

	// Composition of many: resolve the objectID for the composition field
	let compositionFieldObjectIDExpr = null;
	if (buildFieldObjectIDFn) {
		const parentEntity = model.definitions[parentEntityName];
		compositionFieldObjectIDExpr = buildFieldObjectIDFn(
			compositionParentInfo.compositionFieldChangelog,
			parentEntityName,
			parentEntity,
			parentKeyBinding
		);
	}

	const parentKeyExpr = entityKeyExpr(parentKeyBinding.map((k) => `${rowRef}.${quote(k)}`));

	// Resolve objectID for the composition entry:
	// 1. compositionFieldObjectIDExpr: @changelog on the composition field (parent elements only, for composition-of-many)
	// 2. buildCompOfManyRootObjectIDSelect: parent entity-level @changelog / entity keys (fallback)
	const rootEntity = model.definitions[parentEntityName];
	const immediateParentObjectIDExpr = compositionFieldObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef, model);

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
		const ancestorKeyValues = [parentKeyBinding.map((k) => `${rowRef}.${quote(k)}`)]; // level 0

		// Level 0: find Level1Sample record using trigger row FK
		const childEntity0 = model.definitions[levels[0].entityName];
		const childKeys0 = utils.extractKeys(childEntity0.keys);
		childWhereClauses.push(childKeys0.map((pk, j) => `${quote(pk)} = ${rowRef}.${quote(levels[0].keyBinding[j])}`).join(' AND '));

		for (let i = 1; i < levels.length; i++) {
			const childLevel = levels[i - 1];
			const ancestorLevel = levels[i];

			// WHERE clause to find the child level's record: use the previous level's WHERE to navigate up
			const prevWhere = childWhereClauses[i - 1];

			// The ancestor key is found by using preWhere
			// SELECT ancestorLevel.keyBinding FROM childLevel.table WHERE prevWhere
			const whereForAncestor = ancestorLevel.keyBinding.map((fk) => `(SELECT ${quote(fk)} FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`);

			const ancestorEntity = model.definitions[ancestorLevel.entityName];
			const ancestorKeys = utils.extractKeys(ancestorEntity.keys);
			const thisWhere = ancestorKeys.map((pk, j) => `${quote(pk)} = ${whereForAncestor[j]}`).join(' AND ');
			childWhereClauses.push(thisWhere);

			ancestorKeyValues.push(whereForAncestor);
			keyExprs.push(entityKeyExpr(whereForAncestor));
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
				parentIDExpr = buildChangelogLookupExpr(parentLevel.entityName, parentLevelKeyExpr, parentLevel.compositionFieldName);
			}

			// objectID: use child entity's objectID
			// levels[0] (immediate parent): use childObjectIDExpr (the trigger entity's objectID)
			// levels[N] (N >= 1): use the child entity's (levels[N-1]) objectIDs resolved via subquery
			let objectIDExpr;
			if (isImmediateParent) {
				objectIDExpr = immediateParentObjectIDExpr;
			} else {
				// For ancestor levels, resolve the child entity's objectID via subquery
				// level.childObjectIDs contains the objectIDs of this level's composition target (levels[i-1])
				// level.childEntityName is the entity name of the child
				const childEntityDef = model.definitions[level.childEntityName];
				if (childEntityDef && level.childObjectIDs && level.childObjectIDs.length > 0) {
					// The child entity's keys are at ancestorKeyValues[i-1]
					const childKeyValues = ancestorKeyValues[i - 1];
					objectIDExpr = buildCompOfManyRootObjectIDSelect(childEntityDef, level.childObjectIDs, null, null, model, childKeyValues);
				} else {
					// Fallback: use the child entity's key expression
					objectIDExpr = keyExprs[i - 1];
				}
			}

			insertStatements.push(buildCompositionChangelogInsert({
				parentIDExpr,
				compositionFieldName: level.compositionFieldName,
				entityName: level.entityName,
				keyExpr: levelKeyExpr,
				objectIDExpr
			}));
		}

		insertSQL = insertStatements.join('\n        ');
	} else {
		insertSQL = buildCompositionChangelogInsert({
			parentIDExpr: 'NULL',
			compositionFieldName,
			entityName: parentEntityName,
			keyExpr: parentKeyExpr,
			objectIDExpr: immediateParentObjectIDExpr
		});
	}

	// SELECT SQL to get the parent_ID for child entries
	const parentLookupExpr = buildChangelogLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName);

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

module.exports = {
	buildCompOfManyRootObjectIDSelect,
	buildCompositionOfOneParentContext,
	buildCompositionParentContext
};
