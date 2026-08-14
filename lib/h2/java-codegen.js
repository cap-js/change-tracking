const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { _prepareValueExpression, _prepareLabelExpression, _wrapInTryCatch, _toSQL } = require('./sql-expressions.js');
const { _generateGrandParentHelper, _generateParentIdHelper, _generateKeyCalculationJava } = require('./composition-codegen.js');

/**
 * For a composition-of-one column on the parent, build a Java snippet that
 * computes the child's objectID via a subselect on the child entity. Falls
 * back to the parent's `objectID` local when no @changelog is defined on the
 * child, or when the lookup returns null.
 *
 * @param {object} col   tracked column descriptor (must have target)
 * @param {string} refRow trigger row reference ('newRow' or 'oldRow')
 * @param {object} model  the CDS model
 * @returns {{ setup: string, javaVar: string } | null}
 */
function _buildChildObjectIDLookup(col, refRow, model) {
  if (!(col.type === 'cds.Composition' && col.is2one && col.target)) return null;
  const childEntity = model.definitions[col.target];
  if (!childEntity) return null;

  const childObjectIDs = utils.getObjectIDs(childEntity, model);
  if (!childObjectIDs || childObjectIDs.length === 0) return null;

  const childKeys = utils.extractKeys(childEntity.keys);
  if (childKeys.length === 0) return null;

  // FK from parent to child column names: <colName>_<childKey>
  const fkFields = childKeys.map((k) => `${col.name}_${k}`);

  const where = childKeys.reduce((acc, k) => {
    acc[k] = { val: '?', literal: 'sql' };
    return acc;
  }, {});

  const parts = [];
  const bindings = [];
  for (const oid of childObjectIDs) {
    const column = oid.expression ? utils.buildExpressionColumn(oid.expression) : oid.name;
    const query = SELECT.one.from(childEntity.name).columns(column).where(where);
    const sql = `(${_toSQL(query, model)})`;
    parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
    fkFields.forEach((fk) => bindings.push(`${refRow}.getString("${fk}")`));
  }

  const unionSql = parts.join(' UNION ALL ');
  const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

  // Sanitize variable name for use in Java
  const safeName = col.name.replace(/[^a-zA-Z0-9]/g, '_');
  const javaVar = `childObjectID_${safeName}_${refRow === 'oldRow' ? 'old' : 'new'}`;

  const setup = `
        String ${javaVar} = objectID;
        try (PreparedStatement stmtCOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtCOID.setString(${i + 1}, ${b});`).join('\n            ')}
            try (ResultSet rsCOID = stmtCOID.executeQuery()) {
                if (rsCOID.next()) {
                    String res = rsCOID.getString(1);
                    if (res != null) ${javaVar} = res;
                }
            }
        } catch (SQLException e) {
            /* Fall back to entity objectID when the child objectID lookup fails */
        }`;

  return { setup, javaVar };
}

function _generateJavaMethod(createBody, updateBody, deleteBody, entityName, compositionParentInfo = null, grandParentCompositionInfo = null) {
  const entitySkipVar = getEntitySkipVarName(entityName);

  const parentEntityName = compositionParentInfo?.parentEntityName ?? '';
  const compositionFieldName = compositionParentInfo?.compositionFieldName ?? '';
  const grandParentEntityName = grandParentCompositionInfo?.grandParentEntityName ?? '';
  const grandParentCompositionFieldName = grandParentCompositionInfo?.grandParentCompositionFieldName ?? '';

  const grandParentHelper = grandParentCompositionInfo ? _generateGrandParentHelper(grandParentEntityName, grandParentCompositionFieldName) : '';

  const parentIdHelper = compositionParentInfo ? _generateParentIdHelper(parentEntityName, compositionFieldName, grandParentCompositionInfo) : '';

  return `
    import java.sql.Connection;
    import java.sql.ResultSet;
    import java.sql.PreparedStatement;
    import java.sql.SQLException;
    import java.util.Objects;
    import org.h2.tools.TriggerAdapter;

    @CODE
    TriggerAdapter create() {
        return new TriggerAdapter() {
            private String getSessionVariable(Connection conn, String sql) {
                try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            return rs.getString(1);
                        }
                    }
                } catch (SQLException e) {
                    /* H2 2.x throws when session variable was never set - treat as null */
                }
                return null;
            }

            private boolean shouldSkipChangeTracking(Connection conn) throws SQLException {
                if ("true".equals(getSessionVariable(conn, "SELECT @${CT_SKIP_VAR}"))) return true;
                if ("true".equals(getSessionVariable(conn, "SELECT @${entitySkipVar}"))) return true;
                return false;
            }

            private boolean shouldSkipElement(Connection conn, String varName) throws SQLException {
                return "true".equals(getSessionVariable(conn, "SELECT @" + varName));
            }

            private String getLocale(Connection conn) throws SQLException {
                String locale = getSessionVariable(conn, "SELECT @\$user.locale");
                if (locale == null || locale.isEmpty()) locale = getSessionVariable(conn, "SELECT @locale");
                return locale;
            }

            private boolean hasExistingCompositionEntry(Connection conn, String entityName, String entityKey, String attribute) throws SQLException {
                String sql = "SELECT 1 FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = TRANSACTION_ID()";
                try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                    stmt.setString(1, entityName);
                    stmt.setString(2, entityKey);
                    stmt.setString(3, attribute);
                    try (ResultSet rs = stmt.executeQuery()) {
                        return rs.next();
                    }
                }
            }
${grandParentHelper}${parentIdHelper}
            @Override
            public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
                if (shouldSkipChangeTracking(conn)) {
                    return;
                }
                String locale = getLocale(conn);

                boolean isInsert = oldRow == null;
                boolean isDelete = newRow == null;
                boolean isUpdate = !isInsert && !isDelete;

                if (isInsert) {
                    ${createBody}
                } else if (isUpdate) {
                    ${updateBody}
                } else if (isDelete) {
                    ${deleteBody}
                }
            }
        };
    }`;
}

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
  const reference = 'newRow';

  // Set modification type for grandparent entry creation (must be before keysCalc which uses it)
  const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "create";' : '';
  const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, objectIDs);

  // Composition parent handling - with deep linking support when grandParentCompositionInfo exists
  let parentIdSetup = '';
  if (compositionParentInfo) {
    if (grandParentCompositionInfo) {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "create", parentChangelogId);`;
    } else {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "create");`;
    }
  }

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = columns
    .map((col) => {
      const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
      const labelRes = _prepareLabelExpression(col, reference, model);

      // For composition-of-one columns, compute the child's objectID via
      // subselect so the emitted change carries the child's display name
      // rather than the parent's (matches SQLite/Node.js semantics).
      const childLookup = _buildChildObjectIDLookup(col, reference, model);
      const objectIDVar = childLookup ? childLookup.javaVar : 'objectID';
      const childSetup = childLookup ? childLookup.setup : '';

      const insertSQL = compositionParentInfo
        ? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'create', TRANSACTION_ID())`
        : `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'create', TRANSACTION_ID())`;

      const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar];

      const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

      const elementSkipVar = getElementSkipVarName(entity.name, col.name);

      // For composition-of-one columns we still gate on non-null FK (create),
      // but dedup by attribute to avoid double emit when the child trigger
      // also creates a composition entry.
      const isCompOne = col.type === 'cds.Composition' && col.is2one;
      const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';

      const compositionCheck = isCompOne ? ` && !hasExistingCompositionEntry(conn, entityName, entityKey, "${col.name}")` : '';

      return `${childSetup}
        if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")${compositionCheck}) {
            ${tryBlock}
        }`;
    })
    .join('\n');

  return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
  const reference = 'newRow';

  const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "update";' : '';
  const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, objectIDs);

  let parentIdSetup = '';
  if (compositionParentInfo) {
    if (grandParentCompositionInfo) {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "update", parentChangelogId);`;
    } else {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "update");`;
    }
  }

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = columns
    .map((col) => {
      const newRes = _prepareValueExpression(col, 'newRow');
      const oldRes = _prepareValueExpression(col, 'oldRow');
      const newLabelRes = _prepareLabelExpression(col, 'newRow', model);
      const oldLabelRes = _prepareLabelExpression(col, 'oldRow', model);

      // For composition-of-one columns, look up the child's objectID for
      // the emitted change (uses OLD FK so we can find the child before an
      // eventual UPDATE nulls the FK).
      const childLookup = _buildChildObjectIDLookup(col, 'oldRow', model)
        ?? _buildChildObjectIDLookup(col, 'newRow', model);
      const objectIDVar = childLookup ? childLookup.javaVar : 'objectID';
      const childSetup = childLookup ? childLookup.setup : '';

      let checkCols = [col.name];
      if (col.foreignKeys && col.foreignKeys.length > 0) {
        checkCols = col.foreignKeys.map((fk) => `${col.name}_${fk}`);
      } else if (col.on && col.on.length > 0) {
        checkCols = col.on.map((m) => m.foreignKeyField);
      }

      const changeCheck = checkCols.map((dbCol) => `!Objects.equals(newRow.getObject("${dbCol}"), oldRow.getObject("${dbCol}"))`).join(' || ');

      const insertSQL = compositionParentInfo
        ? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'update', TRANSACTION_ID())`
        : `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'update', TRANSACTION_ID())`;

      const allBindings = compositionParentInfo
        ? ['parentId', ...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', objectIDVar]
        : [...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', objectIDVar];

      const elementSkipVar = getElementSkipVarName(entity.name, col.name);

      // For composition-of-one columns, add deduplication check to prevent duplicate entries
      // when child trigger has already created a composition entry for this transaction
      const compositionCheck = col.type === 'cds.Composition' ? ` && !hasExistingCompositionEntry(conn, entityName, entityKey, "${col.name}")` : '';

      return `${childSetup}
        if ((${changeCheck}) && !shouldSkipElement(conn, "${elementSkipVar}")${compositionCheck}) {
            ${_wrapInTryCatch(insertSQL, allBindings)}
        }`;
    })
    .join('\n');

  return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
  const reference = 'oldRow';

  const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "delete";' : '';
  const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, objectIDs);

  // First delete existing changelogs for this entity
  const deleteSQL = `DELETE FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ?`;
  const deleteBlock = _wrapInTryCatch(deleteSQL, ['entityName', 'entityKey']);

  let parentIdSetup = '';
  if (compositionParentInfo) {
    if (grandParentCompositionInfo) {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete", parentChangelogId);`;
    } else {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");`;
    }
  }

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${deleteBlock}\n${parentIdSetup}`;
  }

  const columnBlocks = _generateDeleteColumnBlocks(columns, reference, compositionParentInfo, entity, model);

  return `${modificationTypeSetup}
        ${keysCalc}
        ${deleteBlock}
        ${parentIdSetup}
        ${columnBlocks}`;
}

function _generateDeleteBodyPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null) {
  const reference = 'oldRow';

  const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "delete";' : '';
  const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, objectIDs);

  let parentIdSetup = '';
  if (compositionParentInfo) {
    if (grandParentCompositionInfo) {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete", parentChangelogId);`;
    } else {
      parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");`;
    }
  }

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = _generateDeleteColumnBlocks(columns, reference, compositionParentInfo, entity, model);

  return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

/**
 * Shared column block generation for both delete and delete-preserve.
 */
function _generateDeleteColumnBlocks(columns, reference, compositionParentInfo, entity, model) {
  return columns
    .map((col) => {
      const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
      const labelRes = _prepareLabelExpression(col, reference, model);

      const childLookup = _buildChildObjectIDLookup(col, reference, model);
      const objectIDVar = childLookup ? childLookup.javaVar : 'objectID';
      const childSetup = childLookup ? childLookup.setup : '';

      const insertSQL = compositionParentInfo
        ? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'delete', TRANSACTION_ID())`
        : `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.altExpression ? 'cds.String' : col.type}', 'delete', TRANSACTION_ID())`;

      const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar];

      const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

      const elementSkipVar = getElementSkipVarName(entity.name, col.name);

      const isCompOne = col.type === 'cds.Composition' && col.is2one;
      const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';
      const compositionCheck = isCompOne ? ` && !hasExistingCompositionEntry(conn, entityName, entityKey, "${col.name}")` : '';

      return `${childSetup}
        if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")${compositionCheck}) {
            ${tryBlock}
        }`;
    })
    .join('\n');
}

module.exports = {
  _generateJavaMethod,
  _generateCreateBody,
  _generateUpdateBody,
  _generateDeleteBody,
  _generateDeleteBodyPreserve
};
