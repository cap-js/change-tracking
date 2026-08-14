const utils = require('../utils/change-tracking.js');
const { _toSQL, entityKeyExpr } = require('./sql-expressions.js');

function _javaEntityKey(keys, ref) {
  if (keys.length <= 1) return `${ref}.getString("${keys[0]}")`;
  return keys
    .map((k) => {
      const v = `${ref}.getString("${k}")`;
      return `String.valueOf(${v} == null ? 0 : ${v}.length()) + "," + ${v}`;
    })
    .join(' + ";" + ');
}

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
                    parentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'update', ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, parentId);
                        stmt.setString(2, ${grandParentCompositionInfo ? 'parentChangelogId' : 'null'});
                        stmt.setString(3, "${compositionFieldName}");
                        stmt.setString(4, "${parentEntityName}");
                        stmt.setString(5, parentEntityKey);
                        stmt.setString(6, objectID);
                        stmt.setLong(7, transactionId);
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
function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, objectIDs = null) {
  // extract keys for entity (entity.keys is undefined)
  let keys = utils.extractKeys(entity.keys);
  const entityKeyExp = _javaEntityKey(keys, ref);

  // Prefer objectIDs computed by the caller (with mergedAnnotations); fall back to entity-only lookup.
  const effectiveObjectIDs = objectIDs ?? utils.getObjectIDs(entity, model);
  const objectIDBlock = _generateObjectIDCalculation(effectiveObjectIDs, entity, ref, model);

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
      const selectColumns = entityKeyExpr(parentKeys);
      const selectSQL = `SELECT ${selectColumns} FROM ${utils.transformName(compositionParentInfo.parentEntityName)} WHERE ${whereClause}`;
      const bindings = childKeys.map((ck) => `${ref}.getString("${ck}")`);

      // Fallback lookup: locate the existing composition changelog entry for
      // this parent/attribute in the current transaction. This is needed when
      // the parent has already nulled its FK (e.g. during a deep delete where
      // the parent UPDATE runs before the child DELETE).
      const parentEntityName = compositionParentInfo.parentEntityName;
      const compositionFieldName = compositionParentInfo.compositionFieldName;

      parentKeyBlock = `String parentEntityKey = null;
        try (PreparedStatement stmtPK = conn.prepareStatement("${selectSQL.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPK.setString(${i + 1}, ${b});`).join('\n            ')}
            try (ResultSet rsPK = stmtPK.executeQuery()) {
                if (rsPK.next()) {
                    parentEntityKey = rsPK.getString(1);
                }
            }
        }
        if (parentEntityKey == null) {
            String fallbackSQL = "SELECT ENTITYKEY FROM sap_changelog_Changes WHERE ENTITY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = TRANSACTION_ID() LIMIT 1";
            try (PreparedStatement stmtFB = conn.prepareStatement(fallbackSQL)) {
                stmtFB.setString(1, "${parentEntityName}");
                stmtFB.setString(2, "${compositionFieldName}");
                try (ResultSet rsFB = stmtFB.executeQuery()) {
                    if (rsFB.next()) {
                        parentEntityKey = rsFB.getString(1);
                    }
                }
            } catch (SQLException e) { /* ignore */ }
        }`;
    } else {
      // Standard composition of many: child has FK to parent
      const parentKeyExp = _javaEntityKey(parentKeyBinding, ref);
      parentKeyBlock = `String parentEntityKey = ${parentKeyExp};`;
    }

    // Compute parent objectID (the display name of the composition parent entity)
    const parentObjectIDCalcBlock = _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity, model, parentKeyBinding);
    parentObjectIDBlock = parentObjectIDCalcBlock;

    if (grandParentCompositionInfo && !parentKeyBinding.type) {
      const { grandParentKeyBinding } = grandParentCompositionInfo;
      const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
      const parentKeys = utils.extractKeys(parentEntity.keys);

      // Build SQL to look up grandparent key from parent entity
      const grandParentKeyLookupSQL = entityKeyExpr(grandParentKeyBinding);
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
  // When no `@changelog` objectID annotation is set on the entity, fall back to
  // the entityKey (already computed as a Java local above). This mirrors the
  // SQLite / HANA / Postgres implementations which return `entityKey` via
  // `buildObjectIDExpr(...) ?? entityKey`.
  if (!objectIDs || objectIDs.length === 0) {
    return `String objectID = entityKey;`;
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
        acc[k] = { val: '?', literal: 'sql' };
        return acc;
      }, {});

      // Use the pre-parsed expression (from `@changelog : (xpr)` syntax) if
      // present, otherwise treat `oid.name` as a plain column/path reference.
      // Passing `undefined` to `.columns()` would expand to `SELECT *`, which
      // produces H2's `ROW(...)` literal when the result is CAST to VARCHAR.
      const column = oid.expression
        ? utils.buildExpressionColumn(oid.expression)
        : oid.name;
      const query = SELECT.one.from(entity.name).columns(column).where(where);
      const sql = `(${_toSQL(query, model)})`;

      parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

      // Add bindings for the WHERE clause of this sub-select
      keys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
    }
  }

  // Combine parts into one query that returns a single string
  // H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
  const unionSql = parts.join(' UNION ALL ');
  const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;  // Return Java Code Block
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
        } catch (SQLException e) {
            /* Fall back to entityKey when the objectID lookup fails */
        }`;
}

/**
 * Generates Java code to compute the composition parent's objectID (display name).
 * This is used when a child entity has a tracked composition parent — the parent's
 * changelog entry needs a meaningful objectID rather than just the key.
 */
function _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, refRow, childEntity, model, parentKeyBinding = null) {
  // Check for composition of one scenario — the parent composition entry should
  // use the CHILD's objectID (already computed as `objectID` local) rather than
  // the parent entity's own objectID.
  const binding = childEntity ? utils.getCompositionParentBinding(childEntity, rootEntity) : null;
  const isCompositionOfOne = binding && binding.type === 'compositionOfOne';

  if (isCompositionOfOne) {
    return `String parentObjectID = objectID;`;
  }

  if (!rootObjectIDs || rootObjectIDs.length === 0) {
    // fallback to parent's key when no objectID on the parent
    return `String parentObjectID = parentEntityKey;`;
  }

  // Build SQL Query for the parent's ObjectID string
  const parts = [];
  const bindings = [];

  const rootKeys = utils.extractKeys(rootEntity.keys);

  for (const oid of rootObjectIDs) {
    // For composition parents, the field lives on the parent entity — the child row
    // does NOT expose it. Always use a subselect against the parent entity for lookup,
    // even when `oid.included` is true.
    const where = rootKeys.reduce((acc, k) => {
      acc[k] = { val: '?', literal: 'sql' };
      return acc;
    }, {});

    // Use expression column when the objectID is expression-based (@changelog: (expr))
    // Falling back to `oid.name` for path-based entries.
    const column = oid.expression
      ? utils.buildExpressionColumn(oid.expression)
      : oid.name;
    const query = SELECT.one.from(rootEntity.name).columns(column).where(where);
    const sql = `(${_toSQL(query, model)})`;

    parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

    // Add bindings for the WHERE clause of this sub-select
    if (Array.isArray(parentKeyBinding) && parentKeyBinding.length > 0) {
      // Composition-of-many: use the FK columns on the child row pointing to parent's primary key
      parentKeyBinding.forEach((fk) => bindings.push(`${refRow}.getString("${fk}")`));
    } else {
      // Fallback: use root keys' names directly (only correct when child row has same-named columns)
      rootKeys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
    }
  }

  // Combine parts into one query that returns a single string
  // H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
  const unionSql = parts.join(' UNION ALL ');
  const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

  // Return Java Code Block. Wrap the calculation in a try/catch so any SQL error
  // (invalid subselect, missing element, etc.) degrades gracefully to the
  // parent's key rather than aborting the enclosing INSERT/UPDATE/DELETE.
  return `
        String parentObjectID = parentEntityKey;
        try (PreparedStatement stmtPOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsPOID = stmtPOID.executeQuery()) {
                if (rsPOID.next()) {
                    String res = rsPOID.getString(1);
                    if (res != null) parentObjectID = res;
                }
            }
        } catch (SQLException e) {
            /* Fall back to parentEntityKey when the parent objectID lookup fails */
        }`;
}

module.exports = {
  _generateGrandParentHelper,
  _generateParentIdHelper,
  _generateKeyCalculationJava
};
