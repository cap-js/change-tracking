const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr, buildGrandParentObjectIDExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model) {
	const rootEntityKeyExpr = compositeKeyExpr(binding.map((k) => `:${refRow}.${k}`));

	if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return rootEntityKeyExpr;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `:${refRow}.${binding[i]}` };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query, model)})), '')`);
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
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = :${rowRef}.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeyExpr = compositeKeyExpr(parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`));

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) => `(SELECT ${oid.name} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
		rootObjectIDExpr = oidSelects.length > 1 ? oidSelects.join(" || ', ' || ") : oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

	// Add parent_modification to declares for dynamic determination
	const declares = 'DECLARE parent_id NVARCHAR(36); DECLARE parent_modification NVARCHAR(10);';

	// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
	// Note: For composition of one, we check if a composition entry already exists for this transaction
	// to avoid duplicates when both parent UPDATE and child DELETE triggers fire
	const insertSQL = `
		SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO parent_modification
			FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND modification = 'create'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				parent_id,
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				parent_modification,
				CURRENT_UPDATE_TRANSACTION()
			FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY
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
			);`;

	return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
}

function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model, grandParentCompositionInfo = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, model);
	}

	const parentKeyExpr = compositeKeyExpr(parentKeyBinding.map((k) => `:${rowRef}.${k}`));

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef, model);

	let declares, insertSQL;

	if (grandParentCompositionInfo) {
		// When we have grandparent info, we need to:
		// 1. Create grandparent entry (Order.orderItems) for current transaction if not exists
		// 2. Create parent entry (OrderItem.notes) linking to the grandparent entry
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build grandparent key expression by looking up from parent entity
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = :${rowRef}.${parentKeyBinding[i]}`).join(' AND ');
		const grandParentKeyExpr = compositeKeyExpr(grandParentKeyBinding.map((k) => `(SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`));

		// Build grandparent objectID expression
		const grandParentEntity = model.definitions[grandParentEntityName];
		const grandParentObjectIDs = utils.getObjectIDs(grandParentEntity, model);
		const grandParentObjectIDExpr = grandParentObjectIDs?.length > 0 ? buildGrandParentObjectIDExpr(grandParentObjectIDs, grandParentEntity, parentEntityName, parentKeyBinding, grandParentKeyBinding, rowRef, model) : grandParentKeyExpr;

		// Add grandparent_id to declares
		declares = 'DECLARE parent_id NVARCHAR(36);\n\tDECLARE grandparent_id NVARCHAR(36);';

		insertSQL = `SELECT MAX(ID) INTO grandparent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${grandParentEntityName}'
			AND entityKey = ${grandParentKeyExpr}
			AND attribute = '${grandParentCompositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF grandparent_id IS NULL THEN
			grandparent_id := SYSUUID;
			INSERT INTO SAP_CHANGELOG_CHANGES
				(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES (
					grandparent_id,
					NULL,
					'${grandParentCompositionFieldName}',
					'${grandParentEntityName}',
					${grandParentKeyExpr},
					${grandParentObjectIDExpr},
					CURRENT_TIMESTAMP,
					SESSION_CONTEXT('APPLICATIONUSER'),
					'cds.Composition',
					'update',
					CURRENT_UPDATE_TRANSACTION()
				);
		END IF;
		
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (
				parent_id,
				grandparent_id,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				'${modification}',
				CURRENT_UPDATE_TRANSACTION()
			);`;
	} else {
		// Add parent_modification to declares for dynamic determination
		declares = 'DECLARE parent_id NVARCHAR(36);\n\tDECLARE parent_modification NVARCHAR(10);';

		// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
		// This handles both deep insert (parent created in same tx) and independent insert (parent already existed)
		insertSQL = `
		SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO parent_modification
			FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND modification = 'create'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (
				parent_id,
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				parent_modification,
				CURRENT_UPDATE_TRANSACTION()
			);`;
	}

	return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
}

function buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName) {
	return `SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();`;
}

function buildParentLookupOrCreateSQL(compositionParentContext) {
	const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
	return `${buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName)}
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;`;
}

function buildCompositionOnlyBody(entityName, compositionParentContext, prefixSQL = '') {
	const { getSkipCheckCondition } = require('./sql-expressions.js');
	const { declares } = compositionParentContext;
	const prefix = prefixSQL ? `\n\t\t${prefixSQL}` : '';
	return `${declares}
	IF ${getSkipCheckCondition(entityName)} THEN${prefix}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
	END IF;`;
}

module.exports = {
	buildCompOfManyRootObjectIDSelect,
	buildCompositionOfOneParentContext,
	buildCompositionParentContext,
	buildParentLookupSQL,
	buildParentLookupOrCreateSQL,
	buildCompositionOnlyBody
};
