const utils = require('../utils/change-tracking.js');
const { toSQL, compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many
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

	// Clone to avoid mutation
	const oids = rootObjectIDs.map((o) => ({ ...o }));
	for (const oid of oids) {
		const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		oid.selectSQL = toSQL(q, model);
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
	const parentKeyExpr = compositeKeyExpr(parentKeys.map((pk) => `(SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`));

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) => `(SELECT ${oid.name} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
		rootObjectIDExpr = oidSelects.length > 1 ? oidSelects.join(" || ', ' || ") : oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

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

	let insertSQL;

	if (grandParentCompositionInfo) {
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = ${rowRef}.${parentKeyBinding[i]}`).join(' AND ');

		// Build the grandparent key expression from the parent record
		const grandParentKeyExpr = compositeKeyExpr(grandParentKeyBinding.map((k) => `(SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`));

		// Build expression for grandparent lookup (for linking parent entry to it)
		// Must filter by createdAt to get entry from current transaction
		const grandParentLookupExpr = `(SELECT ID FROM sap_changelog_Changes
			WHERE entity = '${grandParentEntityName}'
			AND entityKey = ${grandParentKeyExpr}
			AND attribute = '${grandParentCompositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND createdBy = session_context('$user.id')
			AND createdAt = session_context('$now')
			ORDER BY createdAt DESC LIMIT 1)`;

		// First insert grandparent entry if not exists
		const grandParentInsertSQL = `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'${grandParentCompositionFieldName}',
				'${grandParentEntityName}',
				${grandParentKeyExpr},
				${grandParentKeyExpr},
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				'update',
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = '${grandParentEntityName}'
				AND entityKey = ${grandParentKeyExpr}
				AND attribute = '${grandParentCompositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND createdBy = session_context('$user.id')
				AND createdAt = session_context('$now')
			);`;

		// Then insert parent entry linking to grandparent
		const parentInsertSQL = `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				${grandParentLookupExpr},
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				'${modification}',
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

		insertSQL = `${grandParentInsertSQL}\n        ${parentInsertSQL}`;
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
