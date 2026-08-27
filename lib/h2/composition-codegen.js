const utils = require('../utils/change-tracking.js');
const { _toSQL, entityKeyExpr, _escapeForJavaStringLiteral } = require('./sql-expressions.js');
const { getAncestorCompositionChain } = require('../utils/composition-helpers.js');

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
 * Sanitize a CDS entity name into a valid Java identifier fragment.
 */
function _sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Generates a helper method that inserts (or looks up) a composition changelog
 * entry for one ancestor level. Each level gets its own helper because the
 * (entity, attribute) pair is baked into the SQL statements.
 */
function _generateAncestorHelper(level) {
  const methodName = _ancestorHelperName(level);
  return `
            private String ${methodName}(Connection conn, String entityKey, String objectID, String parentChangelogId) throws SQLException {
                String id = null;
                long transactionId = getTransactionId(conn);
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${level.entityName}");
                    stmt.setString(2, entityKey);
                    stmt.setString(3, "${level.compositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            id = rs.getString(1);
                        }
                    }
                }
                if (id == null) {
                    id = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'update', ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, id);
                        stmt.setString(2, parentChangelogId);
                        stmt.setString(3, "${level.compositionFieldName}");
                        stmt.setString(4, "${level.entityName}");
                        stmt.setString(5, entityKey);
                        stmt.setString(6, objectID);
                        stmt.setLong(7, transactionId);
                        stmt.executeUpdate();
                    }
                }
                return id;
            }
`;
}

function _ancestorHelperName(level) {
  return `ensureAncestor_${_sanitizeName(level.entityName)}_${_sanitizeName(level.compositionFieldName)}`;
}

/**
 * Legacy alias kept for backwards compatibility — real work is done via
 * _generateAncestorHelper for each level in the ancestor chain.
 */
function _generateGrandParentHelper(grandParentEntityName, grandParentCompositionFieldName) {
  return _generateAncestorHelper({ entityName: grandParentEntityName, compositionFieldName: grandParentCompositionFieldName });
}

/**
 * Generates the ensureCompositionParentEntry helper method.
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
`;
}

/**
 * Given an entity's compositionParentInfo + optional ancestorChain, returns an
 * ordered `levels` array — immediate parent at [0], next ancestor at [1], etc.
 */
function _resolveAncestorLevels(entity, rootEntity, compositionParentInfo, ancestorChain, model) {
  if (!compositionParentInfo) return [];
  const { parentKeyBinding, compositionFieldName } = compositionParentInfo;
  if (parentKeyBinding?.type === 'compositionOfOne') return [];

  const levels = [
    {
      entityName: compositionParentInfo.parentEntityName,
      compositionFieldName,
      keyBinding: parentKeyBinding,
      childEntityName: entity.name,
      childObjectIDs: utils.getObjectIDs(entity, model),
      objectIDs: utils.getObjectIDs(rootEntity, model)
    }
  ];

  if (ancestorChain && ancestorChain.length > 0) {
    const chain = getAncestorCompositionChain(rootEntity, ancestorChain, model);
    levels.push(...chain);
  }

  return levels;
}

/**
 * Build SQL that resolves an ancestor's objectID from the CHILD entity's own
 * @changelog list (the composition entry represents "which child was
 * affected"). Returns the SQL string plus how many `?` bindings it needs.
 * Bindings are always the child entity's key values (single key assumed).
 */
function _buildAncestorObjectIDSQL(level, model) {
  const childEntity = model.definitions[level.childEntityName];
  if (!childEntity) return null;
  const childObjectIDs = level.childObjectIDs;
  if (!childObjectIDs || childObjectIDs.length === 0) return null;

  const childKeys = utils.extractKeys(childEntity.keys);
  const where = childKeys.reduce((acc, k) => {
    acc[k] = { val: '?', literal: 'sql' };
    return acc;
  }, {});

  const parts = [];
  for (const oid of childObjectIDs) {
    const column = oid.expression ? utils.buildExpressionColumn(oid.expression) : oid.name;
    const query = SELECT.one.from(childEntity.name).columns(column).where(where);
    const sql = `(${_toSQL(query, model)})`;
    parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
  }
  const unionSql = parts.join(' UNION ALL ');
  return { sql: `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`, bindingsPerRow: childKeys.length, totalBindings: parts.length * childKeys.length };
}

/**
 * Generates the Java block that resolves the FULL ancestor chain (any depth)
 * and creates the corresponding composition changelog entries, chained via
 * `parent_ID`. Declares `String parentChangelogId` — set to the innermost
 * ancestor's changelog ID (the one that becomes the immediate parent's
 * composition entry's parent_ID). Returns '' when there's no ancestor.
 */
function _generateAncestorChainSetup(entity, rootEntity, ref, compositionParentInfo, ancestorChain, hasGrandParent, model) {
  const levels = _resolveAncestorLevels(entity, rootEntity, compositionParentInfo, ancestorChain, model);
  if (levels.length < 2) return hasGrandParent ? 'String parentChangelogId = null;' : '';

  // Emit key + objectID resolution AND helper calls level by level (innermost
  // ancestor first). Each level's key is derived from the level BELOW it by
  // reverse-navigating through the child's FK.
  const pieces = [];
  let previousKeyVar = 'parentEntityKey'; // key of the immediate parent (level[0])
  let previousChildLevel = levels[0]; // level whose entity holds the FK to the next ancestor
  const idVars = [];

  for (let i = 1; i < levels.length; i++) {
    const level = levels[i];
    const suffix = `${i}_${_sanitizeName(level.entityName)}`;
    const keyVar = `ancestorKey_${suffix}`;
    const objectIDVar = `ancestorObjectID_${suffix}`;
    const idVar = `ancestorId_${suffix}`;

    // Reverse lookup: from previousChildLevel's table, select `keyBinding[0]`
    // where PK = previousKeyVar (single-key assumption).
    const childEntity = model.definitions[previousChildLevel.entityName];
    const childKeys = utils.extractKeys(childEntity.keys);
    const childTable = utils.transformName(previousChildLevel.entityName);
    const selectColumns = level.keyBinding.join(', ');
    const whereClause = childKeys.map((pk) => `${pk} = ?`).join(' AND ');
    const keyLookupSQL = `SELECT ${selectColumns} FROM ${childTable} WHERE ${whereClause}`;

    // Bindings: previousKeyVar (only for single-key)
    const bindStmts = childKeys.map((_, idx) => `stmtKey.setString(${idx + 1}, ${previousKeyVar});`).join('\n            ');

    pieces.push(`
        String ${keyVar} = null;
        if (${previousKeyVar} != null) {
            try (PreparedStatement stmtKey = conn.prepareStatement("${_escapeForJavaStringLiteral(keyLookupSQL)}")) {
                ${bindStmts}
                try (ResultSet rsKey = stmtKey.executeQuery()) {
                    if (rsKey.next()) {
                        ${keyVar} = rsKey.getString(1);
                    }
                }
            } catch (SQLException e) { /* ignore */ }
        }`);

    // objectID for this ancestor entry — use the CHILD entity's objectID (= previousChildLevel's entity).
    // The objectID is looked up by the previousKeyVar (child's PK).
    const oidInfo = _buildAncestorObjectIDSQL(level, model);
    if (oidInfo) {
      const bindOIDStmts = [];
      let paramIdx = 1;
      // For each part, we bind childKeys.length parameters (all equal previousKeyVar in single-key case).
      const partCount = oidInfo.totalBindings / oidInfo.bindingsPerRow;
      for (let p = 0; p < partCount; p++) {
        for (let k = 0; k < oidInfo.bindingsPerRow; k++) {
          bindOIDStmts.push(`stmtOID.setString(${paramIdx++}, ${previousKeyVar});`);
        }
      }
      pieces.push(`
        String ${objectIDVar} = ${previousKeyVar};
        if (${previousKeyVar} != null) {
            try (PreparedStatement stmtOID = conn.prepareStatement("${_escapeForJavaStringLiteral(oidInfo.sql)}")) {
                ${bindOIDStmts.join('\n                ')}
                try (ResultSet rsOID = stmtOID.executeQuery()) {
                    if (rsOID.next()) {
                        String res = rsOID.getString(1);
                        if (res != null) ${objectIDVar} = res;
                    }
                }
            } catch (SQLException e) { /* ignore */ }
        }`);
    } else {
      pieces.push(`String ${objectIDVar} = ${previousKeyVar};`);
    }

    idVars.push({ level, keyVar, objectIDVar, idVar });
    previousKeyVar = keyVar;
    previousChildLevel = level;
  }

  // Now emit helper calls from OUTERMOST (last) to INNERMOST (index 0 of idVars),
  // chaining `parent_ID` through the returned IDs. The outermost helper gets
  // `null` as parent_ID.
  let previousIdRef = 'null';
  for (let i = idVars.length - 1; i >= 0; i--) {
    const { level, keyVar, objectIDVar, idVar } = idVars[i];
    pieces.push(`
        String ${idVar} = null;
        if (${keyVar} != null) {
            ${idVar} = ${_ancestorHelperName(level)}(conn, ${keyVar}, ${objectIDVar}, ${previousIdRef});
        }`);
    previousIdRef = idVar;
  }

  // The innermost ancestor's ID (idVars[0].idVar) is what the immediate parent
  // uses as its own parent_ID.
  pieces.push(`String parentChangelogId = ${idVars[0].idVar};`);
  return pieces.join('\n');
}

/**
 * Generates Java code block for computing entity keys, objectID, parent keys,
 * parent objectID, and grandparent changelog lookup.
 */
function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, objectIDs = null, ancestorChain = null) {
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
      //
      // The `TRANSACTION_ID()` inlined into the fallback SQL below is intentionally
      // equivalent to the `getTransactionId(conn)` helper used elsewhere in this
      // trigger — both evaluate to H2's session-scoped `TRANSACTION_ID()` built-in.
      // Kept inline so the fallback remains a single self-contained SELECT.
      const parentEntityName = compositionParentInfo.parentEntityName;
      const compositionFieldName = compositionParentInfo.compositionFieldName;

      parentKeyBlock = `String parentEntityKey = null;
        try (PreparedStatement stmtPK = conn.prepareStatement("${_escapeForJavaStringLiteral(selectSQL)}")) {
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
    const parentObjectIDCalcBlock = _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity, model, parentKeyBinding, compositionParentInfo?.compositionFieldChangelog);
    parentObjectIDBlock = parentObjectIDCalcBlock;

    // Emit ancestor-chain walk-up (grandparent, great-grandparent, ...). This
    // declares `String parentChangelogId` when at least one ancestor exists.
    parentChangelogLookupBlock = _generateAncestorChainSetup(entity, rootEntity, ref, compositionParentInfo, ancestorChain, !!grandParentCompositionInfo, model);
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
  const nullCheckParts = [];
  const bindings = [];
  const keys = utils.extractKeys(entity.keys);

  for (const oid of objectIDs) {
    if (oid.included) {
      parts.push(`SELECT COALESCE(CAST(? AS VARCHAR), '<empty>') AS val`);
      nullCheckParts.push(`? IS NULL`);
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
      const column = oid.expression ? utils.buildExpressionColumn(oid.expression) : oid.name;
      const query = SELECT.one.from(entity.name).columns(column).where(where);
      const sql = `(${_toSQL(query, model)})`;

      parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
      nullCheckParts.push(`${sql} IS NULL`);

      // Add bindings for the WHERE clause of this sub-select
      keys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
    }
  }

  // Wrap the GROUP_CONCAT in a CASE that returns NULL when ALL objectID fields
  // are NULL, so the Java caller falls back to entityKey (matches SQLite/HANA
  // behavior; see `buildObjectIDExpr` in lib/sqlite/sql-expressions.js which
  // uses the same all-null guard).
  //
  // The SQL below needs each binding twice: once for the null-check clause and
  // once for the GROUP_CONCAT branch. We double up the bindings array to match.
  const unionSql = parts.join(' UNION ALL ');
  const allNullCondition = nullCheckParts.join(' AND ');
  const finalSql = `SELECT CASE WHEN ${allNullCondition} THEN NULL ELSE (SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp) END`;
  // Bindings: the null-check placeholders come first (matching nullCheckParts
  // order), then the GROUP_CONCAT placeholders (matching parts order). Both
  // sequences carry the same values in the same order — duplicating the array
  // preserves the semantic (row value at index i is bound to both the null
  // check and the union branch for the i-th objectID).
  const allBindings = [...bindings, ...bindings];
  return `
        String objectID = entityKey;
        try (PreparedStatement stmtOID = conn.prepareStatement("${_escapeForJavaStringLiteral(finalSql)}")) {
            ${allBindings.map((b, i) => `stmtOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
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
function _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, refRow, childEntity, model, parentKeyBinding = null, compositionFieldChangelog = null) {
  // Check for composition of one scenario — the parent composition entry should
  // use the CHILD's objectID (already computed as `objectID` local) rather than
  // the parent entity's own objectID.
  const binding = childEntity ? utils.getCompositionParentBinding(childEntity, rootEntity) : null;
  const isCompositionOfOne = binding && binding.type === 'compositionOfOne';

  if (isCompositionOfOne) {
    return `String parentObjectID = objectID;`;
  }

  // Composition-of-many with a field-level `@changelog` on the composition
  // element takes precedence over the parent entity's own objectID definition.
  // Support both expression-based (@changelog: (expr)) and path-based
  // (@changelog: [field1, field2]) annotations.
  let effectiveObjectIDs = rootObjectIDs;
  let expressionObjectID = null;
  if (compositionFieldChangelog && Array.isArray(parentKeyBinding) && parentKeyBinding.length > 0) {
    const parsed = _parseCompositionFieldChangelog(compositionFieldChangelog, rootEntity, parentKeyBinding);
    if (parsed?.type === 'expression') {
      expressionObjectID = parsed;
    } else if (parsed?.type === 'paths' && parsed.objectIDs.length > 0) {
      effectiveObjectIDs = parsed.objectIDs;
    }
  }

  if (!expressionObjectID && (!effectiveObjectIDs || effectiveObjectIDs.length === 0)) {
    // fallback to parent's key when no objectID on the parent
    return `String parentObjectID = parentEntityKey;`;
  }

  // Build SQL Query for the parent's ObjectID string
  const parts = [];
  const bindings = [];

  const rootKeys = utils.extractKeys(rootEntity.keys);

  if (expressionObjectID) {
    const query = SELECT.one.from(rootEntity.name).columns(expressionObjectID.exprColumn).where(expressionObjectID.where);
    const sql = `(${_toSQL(query, model)})`;
    parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
    parentKeyBinding.forEach((fk) => bindings.push(`${refRow}.getString("${fk}")`));
  } else {
    for (const oid of effectiveObjectIDs) {
      const where = rootKeys.reduce((acc, k) => {
        acc[k] = { val: '?', literal: 'sql' };
        return acc;
      }, {});

      // Use expression column when the objectID is expression-based (@changelog: (expr))
      // Falling back to `oid.name` for path-based entries.
      const column = oid.expression ? utils.buildExpressionColumn(oid.expression) : oid.name;
      const query = SELECT.one.from(rootEntity.name).columns(column).where(where);
      const sql = `(${_toSQL(query, model)})`;

      parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

      if (Array.isArray(parentKeyBinding) && parentKeyBinding.length > 0) {
        parentKeyBinding.forEach((fk) => bindings.push(`${refRow}.getString("${fk}")`));
      } else {
        rootKeys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
      }
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
        try (PreparedStatement stmtPOID = conn.prepareStatement("${_escapeForJavaStringLiteral(finalSql)}")) {
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

/**
 * Parses a composition-field @changelog annotation into a structure that is
 * consumable by the H2 SQL builder. Mirrors the SQLite helper but returns
 * `where` clauses using CQN `{ val: '?', literal: 'sql' }` placeholders so the
 * generated SQL is compatible with the Java prepared-statement bindings.
 */
function _parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding) {
  if (!compositionFieldChangelog || compositionFieldChangelog.length === 0) return null;

  // Expression-based: @changelog: ('literal ' || elementName)
  const expressionEntry = compositionFieldChangelog.find((e) => e && typeof e === 'object' && e.xpr);
  if (expressionEntry) {
    const parentKeys = utils.extractKeys(parentEntity.keys);
    if (parentKeys.length !== parentKeyBinding.length) return null;
    const where = {};
    for (const k of parentKeys) {
      where[k] = { val: '?', literal: 'sql' };
    }
    const exprColumn = utils.buildExpressionColumn(expressionEntry.xpr);
    return { type: 'expression', exprColumn, where };
  }

  // Path-based: @changelog: [f1, f2]
  const objectIDs = [];
  for (const entry of compositionFieldChangelog) {
    const field = entry['='];
    if (!field) continue;
    const element = parentEntity.elements?.[field];
    const included = !!element && !element['@Core.Computed'];
    objectIDs.push({ name: field, included });
  }
  if (objectIDs.length === 0) return null;
  return { type: 'paths', objectIDs };
}

/**
 * Emit one helper method per ancestor level (index 0 = immediate parent's own
 * grandparent, index N = outermost ancestor). Every level gets a distinct
 * `ensureAncestor_<entity>_<field>` helper because the (entity, attribute)
 * pair is baked in as string literals.
 */
function _generateAncestorHelpers(levels) {
  return levels.map((l) => _generateAncestorHelper(l)).join('\n');
}

module.exports = {
  _generateGrandParentHelper,
  _generateParentIdHelper,
  _generateKeyCalculationJava,
  _generateAncestorHelpers
};
