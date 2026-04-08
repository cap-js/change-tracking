const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many.
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
	const keyValues = keyValueExprs ?? binding.map((k) => `${refRow}.${k}`);
	const rootEntityKeyExpr = compositeKeyExpr(keyValues);

	if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== keyValues.length) return rootEntityKeyExpr;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = keyValueExprs
			? { val: keyValues[i], literal: 'sql' }
			: { val: keyValues[i] };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		if (oid.expression) {
			const exprColumn = utils.buildExpressionColumn(oid.expression);
			const query = SELECT.from(rootEntity.name).columns(exprColumn).where(where);
			parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query, model)})), '')`);
		} else {
			const query = SELECT.from(rootEntity.name).columns(oid.name).where(where);
			parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query, model)})), '')`);
		}
	}

	const concatLogic = parts.join(" || ', ' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

/**
 * Builds context for composition of one parent changelog entry.
 * In composition of one, the parent entity has FK to the child (e.g., BookStores.registry_ID -> BookStoreRegistry.ID)
 * So we need to do a reverse lookup: find the parent record that has FK pointing to this child.
 */
function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	// Build the FK field names on the parent that point to this child
	// For composition of one, CAP generates <compositionName>_<childKey> fields
	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);

	// Build WHERE clause to find the parent entity that has this child
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = ${rowRef}.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
	const parentKeyExpr = compositeKeyExpr(parentKeySubqueries);

	// Build rootObjectID expression for the parent entity (reuse buildCompOfManyRootObjectIDSelect with subquery key values)
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

	// Build the FROM clause referencing the transition table
	const transitionTable = modification === 'delete' ? ':old_tab' : ':new_tab';
	const transitionAlias = modification === 'delete' ? 'ot' : 'nt';

	// Bulk-insert parent entries for all affected rows.
	// SYSUUID must be outside the DISTINCT subquery since it generates unique values per row,
	// which would defeat deduplication. The inner SELECT DISTINCT deduplicates by parent key,
	// then the outer SELECT adds unique IDs per distinct row.
	const insertSQL = `
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT SYSUUID, sub.* FROM (
				SELECT DISTINCT
					NULL AS parent_ID,
					'${compositionFieldName}' AS attribute,
					'${parentEntityName}' AS entity,
					${parentKeyExpr} AS entityKey,
					${rootObjectIDExpr} AS objectID,
					CURRENT_TIMESTAMP AS createdAt,
					SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
					'cds.Composition' AS valueDataType,
					CASE WHEN EXISTS (
						SELECT 1 FROM SAP_CHANGELOG_CHANGES
						WHERE entity = '${parentEntityName}'
						AND entityKey = ${parentKeyExpr}
						AND modification = 'create'
						AND transactionID = CURRENT_UPDATE_TRANSACTION()
					) THEN 'create' ELSE 'update' END AS modification,
					CURRENT_UPDATE_TRANSACTION() AS transactionID
				FROM ${transitionTable} ${transitionAlias}
				WHERE EXISTS (
					SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
				)
				AND NOT EXISTS (
					SELECT 1 FROM SAP_CHANGELOG_CHANGES
					WHERE entity = '${parentEntityName}'
					AND entityKey = ${parentKeyExpr}
					AND attribute = '${compositionFieldName}'
					AND valueDataType = 'cds.Composition'
					AND transactionID = CURRENT_UPDATE_TRANSACTION()
				)
			) sub;`;

	// Parent lookup expression: correlated subquery to find the parent changelog entry ID
	const parentLookupExpr = `(SELECT MAX(ID) FROM SAP_CHANGELOG_CHANGES WHERE entity = '${parentEntityName}' AND entityKey = ${parentKeyExpr} AND attribute = '${compositionFieldName}' AND valueDataType = 'cds.Composition' AND transactionID = CURRENT_UPDATE_TRANSACTION())`;

	return { declares: '', insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
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

	// Build the FROM clause referencing the transition table
	const transitionTable = modification === 'delete' ? ':old_tab' : ':new_tab';
	const transitionAlias = modification === 'delete' ? 'ot' : 'nt';

	let insertSQL;

	if (ancestorCompositionChain.length > 0) {
		// Build the full chain of ancestor levels.
		// levels[0] = immediate parent (compositionParentInfo)
		// levels[1] = grandparent (ancestorCompositionChain[0])
		// levels[2] = great-grandparent (ancestorCompositionChain[1])
		const levels = [
			{ entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding },
			...ancestorCompositionChain
		];

		// Build key expressions for each level.
		const keyExprs = [parentKeyExpr]; // level 0
		const ancestorKeyValues = [parentKeyBinding.map((k) => `${rowRef}.${k}`)]; // level 0

		// childWhereClauses[i] = WHERE clause on level[i]'s table to find the record for this trigger row
		const childWhereClauses = [];
		const childEntity0 = model.definitions[levels[0].entityName];
		const childKeys0 = utils.extractKeys(childEntity0.keys);
		childWhereClauses.push(childKeys0.map((pk, j) => `${pk} = ${rowRef}.${levels[0].keyBinding[j]}`).join(' AND '));

		for (let i = 1; i < levels.length; i++) {
			const childLevel = levels[i - 1];
			const ancestorLevel = levels[i];
			const prevWhere = childWhereClauses[i - 1];

			const whereForAncestor = ancestorLevel.keyBinding.map((fk) =>
				`(SELECT ${fk} FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`
			);

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
				parentIDExpr = `(SELECT MAX(ID) FROM SAP_CHANGELOG_CHANGES
					WHERE entity = '${parentLevel.entityName}'
					AND entityKey = ${parentLevelKeyExpr}
					AND attribute = '${parentLevel.compositionFieldName}'
					AND valueDataType = 'cds.Composition'
					AND transactionID = CURRENT_UPDATE_TRANSACTION())`;
			}

			const modExpr = isImmediateParent ? `'${modification}'` : "'update'";

			// objectID: resolve from the entity's @changelog annotation via buildCompOfManyRootObjectIDSelect
			let objectIDExpr;
			if (isImmediateParent) {
				objectIDExpr = rootObjectIDExpr;
			} else {
				const ancestorEntity = model.definitions[level.entityName];
				objectIDExpr = buildCompOfManyRootObjectIDSelect(ancestorEntity, level.objectIDs, null, null, model, ancestorKeyValues[i]);
			}

			insertStatements.push(`INSERT INTO SAP_CHANGELOG_CHANGES
				(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
				SELECT SYSUUID, sub.* FROM (
					SELECT DISTINCT
						${parentIDExpr} AS parent_ID,
						'${level.compositionFieldName}' AS attribute,
						'${level.entityName}' AS entity,
						${levelKeyExpr} AS entityKey,
						${objectIDExpr} AS objectID,
						CURRENT_TIMESTAMP AS createdAt,
						SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
						'cds.Composition' AS valueDataType,
						${modExpr} AS modification,
						CURRENT_UPDATE_TRANSACTION() AS transactionID
					FROM ${transitionTable} ${transitionAlias}
					WHERE NOT EXISTS (
						SELECT 1 FROM SAP_CHANGELOG_CHANGES
						WHERE entity = '${level.entityName}'
						AND entityKey = ${levelKeyExpr}
						AND attribute = '${level.compositionFieldName}'
						AND valueDataType = 'cds.Composition'
						AND transactionID = CURRENT_UPDATE_TRANSACTION()
					)
				) sub;`);
		}

		insertSQL = insertStatements.join('\n\t\t');
	} else {
		// Bulk-insert parent entries for all affected rows.
		// SYSUUID is outside the DISTINCT subquery to allow proper deduplication.
		insertSQL = `
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT SYSUUID, sub.* FROM (
				SELECT DISTINCT
					NULL AS parent_ID,
					'${compositionFieldName}' AS attribute,
					'${parentEntityName}' AS entity,
					${parentKeyExpr} AS entityKey,
					${rootObjectIDExpr} AS objectID,
					CURRENT_TIMESTAMP AS createdAt,
					SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
					'cds.Composition' AS valueDataType,
					CASE WHEN EXISTS (
						SELECT 1 FROM SAP_CHANGELOG_CHANGES
						WHERE entity = '${parentEntityName}'
						AND entityKey = ${parentKeyExpr}
						AND modification = 'create'
						AND transactionID = CURRENT_UPDATE_TRANSACTION()
					) THEN 'create' ELSE 'update' END AS modification,
					CURRENT_UPDATE_TRANSACTION() AS transactionID
				FROM ${transitionTable} ${transitionAlias}
				WHERE NOT EXISTS (
					SELECT 1 FROM SAP_CHANGELOG_CHANGES
					WHERE entity = '${parentEntityName}'
					AND entityKey = ${parentKeyExpr}
					AND attribute = '${compositionFieldName}'
					AND valueDataType = 'cds.Composition'
					AND transactionID = CURRENT_UPDATE_TRANSACTION()
				)
			) sub;`;
	}

	// Parent lookup expression: correlated subquery to find the parent changelog entry ID per row
	const parentLookupExpr = `(SELECT MAX(ID) FROM SAP_CHANGELOG_CHANGES WHERE entity = '${parentEntityName}' AND entityKey = ${parentKeyExpr} AND attribute = '${compositionFieldName}' AND valueDataType = 'cds.Composition' AND transactionID = CURRENT_UPDATE_TRANSACTION())`;

	return { declares: '', insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

/**
 * Builds parent lookup/create SQL.
 * The insertSQL contains set-based INSERT ... SELECT statements
 * that handle bulk creation of parent entries.
 */
function buildParentLookupOrCreateSQL(compositionParentContext) {
	const { insertSQL: compInsertSQL } = compositionParentContext;
	return compInsertSQL;
}

function buildCompositionOnlyBody(entityName, compositionParentContext, prefixSQL = '') {
	const { getSkipCheckCondition } = require('./sql-expressions.js');
	const { declares } = compositionParentContext;
	const declareBlock = declares ? `${declares}\n\t` : '';
	const prefix = prefixSQL ? `\n\t\t${prefixSQL}` : '';
	return `${declareBlock}IF ${getSkipCheckCondition(entityName)} THEN${prefix}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
	END IF;`;
}

module.exports = {
	buildCompOfManyRootObjectIDSelect,
	buildCompositionOfOneParentContext,
	buildCompositionParentContext,
	buildParentLookupOrCreateSQL,
	buildCompositionOnlyBody
};
