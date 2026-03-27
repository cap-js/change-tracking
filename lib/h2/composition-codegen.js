const utils = require('../utils/change-tracking.js');
const { _toSQL } = require('./sql-expressions.js');

/**
 * Generates the ensureGrandParentCompositionEntry helper method.
 * Grandparent entries always use 'update' modification since they represent changes to an existing parent's composition.
 */
function _generateGrandParentHelper(grandParentEntityName, grandParentCompositionFieldName) {
	return `
            private String ensureGrandParentCompositionEntry(Connection conn, String grandParentKey, String grandParentObjectID) throws SQLException {
                String grandParentId = null;
                long transactionId = getTransactionId(conn);
                
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${grandParentEntityName}");
                    stmt.setString(2, grandParentKey);
                    stmt.setString(3, "${grandParentCompositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            grandParentId = rs.getString(1);
                        }
                    }
                }
                
                if (grandParentId == null) {
                    grandParentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'update', ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, grandParentId);
                        stmt.setString(2, "${grandParentCompositionFieldName}");
                        stmt.setString(3, "${grandParentEntityName}");
                        stmt.setString(4, grandParentKey);
                        stmt.setString(5, grandParentObjectID);
                        stmt.setLong(6, transactionId);
                        stmt.executeUpdate();
                    }
                }
                
                return grandParentId;
            }
`;
}

/**
 * Generates the ensureCompositionParentEntry + getTransactionId helper methods.
 */
function _generateParentIdHelper(parentEntityName, compositionFieldName, grandParentCompositionInfo) {
	return `
            private String ensureCompositionParentEntry(Connection conn, String parentEntityKey, String objectID, String modification${grandParentCompositionInfo ? ', String parentChangelogId' : ''}) throws SQLException {
                String parentId = null;
                long transactionId = getTransactionId(conn);
                
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${parentEntityName}");
                    stmt.setString(2, parentEntityKey);
                    stmt.setString(3, "${compositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            parentId = rs.getString(1);
                        }
                    }
                }
                
                if (parentId == null) {
                    ${
											grandParentCompositionInfo
												? ''
												: `
                    String effectiveModification = modification;
                    if ("create".equals(modification)) {
                        String parentCreatedCheckSQL = "SELECT COUNT(*) FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND MODIFICATION = 'create' AND TRANSACTIONID = ?";
                        try (PreparedStatement checkStmt = conn.prepareStatement(parentCreatedCheckSQL)) {
                            checkStmt.setString(1, "${parentEntityName}");
                            checkStmt.setString(2, parentEntityKey);
                            checkStmt.setLong(3, transactionId);
                            try (ResultSet rs = checkStmt.executeQuery()) {
                                if (rs.next() && rs.getInt(1) == 0) {
                                    effectiveModification = "update";
                                }
                            }
                        }
                    }
                    modification = effectiveModification;`
										}
                    parentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', ?, ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, parentId);
                        stmt.setString(2, ${grandParentCompositionInfo ? 'parentChangelogId' : 'null'});
                        stmt.setString(3, "${compositionFieldName}");
                        stmt.setString(4, "${parentEntityName}");
                        stmt.setString(5, parentEntityKey);
                        stmt.setString(6, objectID);
                        stmt.setString(7, modification);
                        stmt.setLong(8, transactionId);
                        stmt.executeUpdate();
                    }
                }
                
                return parentId;
            }

            private long getTransactionId(Connection conn) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT TRANSACTION_ID()")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            return rs.getLong(1);
                        }
                    }
                }
                return 0;
            }
`;
}

/**
 * Generates Java code block for computing entity keys, objectID, parent keys,
 * parent objectID, and grandparent changelog lookup.
 */
function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
	// extract keys for entity (entity.keys is undefined)
	let keys = utils.extractKeys(entity.keys);
	const entityKeyExp = keys.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');

	const objectIDs = utils.getObjectIDs(entity, model);
	const objectIDBlock = _generateObjectIDCalculation(objectIDs, entity, ref, model);

	// Add parent key calculation for composition parent linking
	let parentKeyBlock = '';
	let parentObjectIDBlock = '';
	let parentChangelogLookupBlock = '';
	if (compositionParentInfo) {
		const { parentKeyBinding } = compositionParentInfo;

		// Handle composition of one (parent has FK to child - need reverse lookup)
		if (parentKeyBinding.type === 'compositionOfOne') {
			const { compositionName, childKeys } = parentKeyBinding;
			const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
			const parentKeys = utils.extractKeys(parentEntity.keys);

			// Build FK field names and WHERE clause for reverse lookup
			const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
			const whereClause = parentFKFields.map((fk) => `${fk} = ?`).join(' AND ');
			const selectColumns = parentKeys.join(" || '||' || ");
			const selectSQL = `SELECT ${selectColumns} FROM ${utils.transformName(compositionParentInfo.parentEntityName)} WHERE ${whereClause}`;
			const bindings = childKeys.map((ck) => `${ref}.getString("${ck}")`);

			parentKeyBlock = `String parentEntityKey = null;
        try (PreparedStatement stmtPK = conn.prepareStatement("${selectSQL.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPK.setString(${i + 1}, ${b});`).join('\n            ')}
            try (ResultSet rsPK = stmtPK.executeQuery()) {
                if (rsPK.next()) {
                    parentEntityKey = rsPK.getString(1);
                }
            }
        }`;
		} else {
			// Standard composition of many: child has FK to parent
			const parentKeyExp = parentKeyBinding.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');
			parentKeyBlock = `String parentEntityKey = ${parentKeyExp};`;
		}

		// Compute parent objectID (the display name of the composition parent entity)
		const parentObjectIDCalcBlock = _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity, model);
		parentObjectIDBlock = parentObjectIDCalcBlock;

		if (grandParentCompositionInfo && !parentKeyBinding.type) {
			const { grandParentKeyBinding } = grandParentCompositionInfo;
			const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
			const parentKeys = utils.extractKeys(parentEntity.keys);

			// Build SQL to look up grandparent key from parent entity
			const grandParentKeyLookupSQL = grandParentKeyBinding.map((k) => k).join(" || '||' || ");
			const parentTableName = utils.transformName(compositionParentInfo.parentEntityName);
			const parentWhereClause = parentKeys.map((pk) => `${pk} = ?`).join(' AND ');

			parentChangelogLookupBlock = `
        String parentChangelogId = null;
        String grandParentKeySQL = "SELECT ${grandParentKeyLookupSQL} FROM ${parentTableName} WHERE ${parentWhereClause}";
        String grandParentKey = null;
        try (PreparedStatement gpKeyStmt = conn.prepareStatement(grandParentKeySQL)) {
            ${parentKeyBinding.map((k, i) => `gpKeyStmt.setString(${i + 1}, ${ref}.getString("${k}"));`).join('\n')}
            try (ResultSet gpKeyRs = gpKeyStmt.executeQuery()) {
                if (gpKeyRs.next()) {
                    grandParentKey = gpKeyRs.getString(1);
                }
            }
        }
        if (grandParentKey != null) {
            parentChangelogId = ensureGrandParentCompositionEntry(conn, grandParentKey, parentObjectID);
        }`;
		}
	}

	return `
        String entityName = "${entity.name}";
        String entityKey = ${entityKeyExp};
        ${objectIDBlock}
        ${parentKeyBlock}
        ${parentObjectIDBlock}
        ${parentChangelogLookupBlock}
    `;
}

function _generateObjectIDCalculation(objectIDs, entity, refRow, model) {
	// fallback to entity name (will be translated via i18nKeys in ChangeView)
	if (!objectIDs || objectIDs.length === 0) {
		return `String objectID = "${entity.name}";`;
	}

	// Build SQL Query for the ObjectID string
	const parts = [];
	const bindings = [];
	const keys = utils.extractKeys(entity.keys);

	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`SELECT COALESCE(CAST(? AS VARCHAR), '<empty>') AS val`);
			bindings.push(`${refRow}.getString("${oid.name}")`);
		} else {
			// Sub-select needed (Lookup)
			const where = keys.reduce((acc, k) => {
				acc[k] = { ref: ['?'], param: true };
				return acc;
			}, {});

			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			const sql = `(${_toSQL(query, model)})`;

			parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

			// Add bindings for the WHERE clause of this sub-select
			keys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
		}
	}

	// Combine parts into one query that returns a single string
	// H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
	const unionSql = parts.join(' UNION ALL ');
	const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

	// Return Java Code Block
	return `
        String objectID = entityKey;
        try (PreparedStatement stmtOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsOID = stmtOID.executeQuery()) {
                if (rsOID.next()) {
                    String res = rsOID.getString(1);
                    if (res != null) objectID = res;
                }
            }
        }`;
}

/**
 * Generates Java code to compute the composition parent's objectID (display name).
 * This is used when a child entity has a tracked composition parent — the parent's
 * changelog entry needs a meaningful objectID rather than just the key.
 */
function _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, refRow, childEntity, model) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		const rootEntityName = rootEntity ? rootEntity.name : '';
		return `String parentObjectID = "${rootEntityName}";`;
	}

	// Build SQL Query for the parent's ObjectID string
	const parts = [];
	const bindings = [];

	// Check for composition of one scenario
	const binding = childEntity ? utils.getRootBinding(childEntity, rootEntity) : null;
	const isCompositionOfOne = binding && binding.type === 'compositionOfOne';

	for (const oid of rootObjectIDs) {
		if (oid.included && !isCompositionOfOne) {
			parts.push(`SELECT CAST(? AS VARCHAR) AS val`);
			bindings.push(`${refRow}.getString("${oid.name}")`);
		} else {
			// Sub-select needed (Lookup)
			let where;
			if (isCompositionOfOne) {
				// For composition of one, use the backlink pattern
				where = binding.childKeys.reduce((acc, ck) => {
					acc[`${binding.compositionName}_${ck}`] = { ref: ['?'], param: true };
					return acc;
				}, {});
			} else {
				const rootKeys = utils.extractKeys(rootEntity.keys);
				where = rootKeys.reduce((acc, k) => {
					acc[k] = { ref: ['?'], param: true };
					return acc;
				}, {});
			}

			const targetEntity = isCompositionOfOne ? binding.rootEntityName : rootEntity.name;
			const query = SELECT.one.from(targetEntity).columns(oid.name).where(where);
			const sql = `(${_toSQL(query, model)})`;

			parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

			// Add bindings for the WHERE clause of this sub-select
			if (isCompositionOfOne) {
				binding.childKeys.forEach((ck) => bindings.push(`${refRow}.getString("${ck}")`));
			} else {
				const rootKeys = utils.extractKeys(rootEntity.keys);
				rootKeys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
			}
		}
	}

	// Combine parts into one query that returns a single string
	// H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
	const unionSql = parts.join(' UNION ALL ');
	const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

	// Return Java Code Block
	return `
        String parentObjectID = entityKey;
        try (PreparedStatement stmtPOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsPOID = stmtPOID.executeQuery()) {
                if (rsPOID.next()) {
                    String res = rsPOID.getString(1);
                    if (res != null) parentObjectID = res;
                }
            }
        }`;
}

module.exports = {
	_generateGrandParentHelper,
	_generateParentIdHelper,
	_generateKeyCalculationJava
};
