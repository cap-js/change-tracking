const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr, buildGrandParentObjectIDExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many.
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model) {
	const rootEntityKeyExpr = compositeKeyExpr(binding.map((k) => `${refRow}.${k}`));

	if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return rootEntityKeyExpr;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
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
	const parentKeyExpr = compositeKeyExpr(parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`));

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) => {
			if (oid.expression) {
				const exprColumn = utils.buildExpressionColumn(oid.expression);
				const where = {};
				for (let i = 0; i < parentFKFields.length; i++) {
					where[parentFKFields[i]] = { val: `${rowRef}.${childKeys[i]}` };
				}
				const q = SELECT.from(parentEntityName).columns(exprColumn).where(where);
				return `(${toSQL(q, model)})`;
			}
			return `(SELECT ${oid.name} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`;
		});
		rootObjectIDExpr = oidSelects.length > 1 ? oidSelects.join(" || ', ' || ") : oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

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

function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model, grandParentCompositionInfo = null) {
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

	let declares, insertSQL;

	if (grandParentCompositionInfo) {
		// When we have grandparent info, we need to:
		// 1. Create grandparent entry (Order.orderItems) for current transaction if not exists
		// 2. Create parent entry (OrderItem.notes) linking to the grandparent entry
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build grandparent key expression by looking up from parent entity
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = ${rowRef}.${parentKeyBinding[i]}`).join(' AND ');
		const grandParentKeyExpr = compositeKeyExpr(grandParentKeyBinding.map((k) => `(SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`));

		// Build grandparent objectID expression
		const grandParentEntity = model.definitions[grandParentEntityName];
		const grandParentObjectIDs = utils.getObjectIDs(grandParentEntity, model);
		const grandParentObjectIDExpr = grandParentObjectIDs?.length > 0 ? buildGrandParentObjectIDExpr(grandParentObjectIDs, grandParentEntity, parentEntityName, parentKeyBinding, grandParentKeyBinding, rowRef, model) : grandParentKeyExpr;

		declares = '';

		// Step 1: Bulk-insert distinct grandparent entries that don't exist yet
		// Step 2: Bulk-insert distinct parent entries linking to grandparent entries
		// SYSUUID is outside the DISTINCT subquery to allow proper deduplication
		insertSQL = `INSERT INTO SAP_CHANGELOG_CHANGES
				(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
				SELECT SYSUUID, sub.* FROM (
					SELECT DISTINCT
						NULL AS parent_ID,
						'${grandParentCompositionFieldName}' AS attribute,
						'${grandParentEntityName}' AS entity,
						${grandParentKeyExpr} AS entityKey,
						${grandParentObjectIDExpr} AS objectID,
						CURRENT_TIMESTAMP AS createdAt,
						SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
						'cds.Composition' AS valueDataType,
						'update' AS modification,
						CURRENT_UPDATE_TRANSACTION() AS transactionID
					FROM ${transitionTable} ${transitionAlias}
					WHERE NOT EXISTS (
						SELECT 1 FROM SAP_CHANGELOG_CHANGES
						WHERE entity = '${grandParentEntityName}'
						AND entityKey = ${grandParentKeyExpr}
						AND attribute = '${grandParentCompositionFieldName}'
						AND valueDataType = 'cds.Composition'
						AND transactionID = CURRENT_UPDATE_TRANSACTION()
					)
				) sub;
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT SYSUUID, sub.* FROM (
				SELECT DISTINCT
					(SELECT MAX(ID) FROM SAP_CHANGELOG_CHANGES WHERE entity = '${grandParentEntityName}' AND entityKey = ${grandParentKeyExpr} AND attribute = '${grandParentCompositionFieldName}' AND valueDataType = 'cds.Composition' AND transactionID = CURRENT_UPDATE_TRANSACTION()) AS parent_ID,
					'${compositionFieldName}' AS attribute,
					'${parentEntityName}' AS entity,
					${parentKeyExpr} AS entityKey,
					${rootObjectIDExpr} AS objectID,
					CURRENT_TIMESTAMP AS createdAt,
					SESSION_CONTEXT('APPLICATIONUSER') AS createdBy,
					'cds.Composition' AS valueDataType,
					'${modification}' AS modification,
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
	} else {
		declares = '';

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

	return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
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
