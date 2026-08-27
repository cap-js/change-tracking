const fs = require('node:fs');
const path = require('node:path');

const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { _prepareValueExpression, _prepareLabelExpression, _wrapInTryCatch, _toSQL, _escapeForJavaStringLiteral } = require('./sql-expressions.js');
const { _generateGrandParentHelper, _generateParentIdHelper, _generateKeyCalculationJava, _generateAncestorHelpers } = require('./composition-codegen.js');

const TRIGGER_JAVA_PACKAGE = 'sap.changelog.triggers';
const TRIGGER_JAVA_BASE_CLASS = 'AbstractChangeTrackingTrigger';
const TRIGGER_JAVA_TEMPLATE_DIR = path.join(__dirname, 'java-templates');

/**
 * Turns a fully-qualified CDS entity name into a valid Java identifier.
 * The Java class name is the same as the trigger name minus the case
 * conversion (H2 upper-cases unquoted identifiers, but the CALL target
 * is a Java class name which is case-sensitive).
 */
function _javaClassNameForEntity(entityName) {
  return `${entityName.replace(/\./g, '_').replace(/[^a-zA-Z0-9_]/g, '_')}_ct`;
}

function _fqcnForEntity(entityName) {
  return `${TRIGGER_JAVA_PACKAGE}.${_javaClassNameForEntity(entityName)}`;
}

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
        try (PreparedStatement stmtCOID = conn.prepareStatement("${_escapeForJavaStringLiteral(finalSql)}")) {
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

/**
 * Generates the full Java source of a per-entity trigger class.
 *
 * The class extends `sap.changelog.triggers.AbstractChangeTrackingTrigger` which provides the shared helpers
 * Per-entity helpers such as `ensureCompositionParentEntry` and `ensureAncestor_*` still live on the entity's own class because the (entity, attribute) tuples are baked into the SQL statements as string literals.
 *
 * @returns {{ className: string, source: string }}
 */
function _generateJavaClass(createBody, updateBody, deleteBody, entityName, compositionParentInfo = null, grandParentCompositionInfo = null, ancestorLevels = []) {
  const entitySkipVar = getEntitySkipVarName(entityName);

  const parentEntityName = compositionParentInfo?.parentEntityName ?? '';
  const compositionFieldName = compositionParentInfo?.compositionFieldName ?? '';

  // Emit one helper method per ancestor level (grandparent, great-grandparent,
  // …). The immediate parent uses its own `ensureCompositionParentEntry` below.
  const ancestorHelpers =
    ancestorLevels.length > 0
      ? _generateAncestorHelpers(ancestorLevels)
      : grandParentCompositionInfo
        ? _generateGrandParentHelper(grandParentCompositionInfo.grandParentEntityName, grandParentCompositionInfo.grandParentCompositionFieldName)
        : '';

  const parentIdHelper = compositionParentInfo ? _generateParentIdHelper(parentEntityName, compositionFieldName, grandParentCompositionInfo || ancestorLevels.length > 0) : '';

  const className = _javaClassNameForEntity(entityName);

  const source = `package ${TRIGGER_JAVA_PACKAGE};

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Objects;

/**
 * Change-tracking trigger for entity {@code ${entityName}}.
 * Generated by @cap-js/change-tracking. Do not edit.
 */
public class ${className} extends ${TRIGGER_JAVA_BASE_CLASS} {
${ancestorHelpers}${parentIdHelper}
    @Override
    public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
        if (shouldSkipChangeTracking(conn, "${entitySkipVar}")) {
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
}
`;

  return { className, source };
}

/**
 * Returns the source of the shared abstract base class that every generated
 * trigger class extends. The source lives in `java-templates/AbstractChangeTrackingTrigger.java`. Two placeholders are substituted (__PACKAGE__, __CT_SKIP_VAR__)
 *
 * The template is read once per Node process and cached.
 */
let _abstractBaseSource = null;
function _generateAbstractBaseClass() {
  if (_abstractBaseSource === null) {
    const templatePath = path.join(TRIGGER_JAVA_TEMPLATE_DIR, `${TRIGGER_JAVA_BASE_CLASS}.java`);
    const template = fs.readFileSync(templatePath, 'utf8');
    _abstractBaseSource = template.replaceAll('__PACKAGE__', TRIGGER_JAVA_PACKAGE).replaceAll('__CT_SKIP_VAR__', CT_SKIP_VAR);
  }
  return { className: TRIGGER_JAVA_BASE_CLASS, source: _abstractBaseSource };
}

/**
 * `INSERT INTO sap_changelog_Changes ...` builder. Returns the SQL template
 * (with `?` placeholders for the value/label expression slots substituted in)
 * that all create/update/delete bodies share.
 *
 * @param {object} col               tracked column descriptor
 * @param {boolean} hasParent        whether the trigger emits into a parent composition (adds PARENT_ID)
 * @param {string} fromExpr          SQL expression for VALUECHANGEDFROM (or 'NULL')
 * @param {string} toExpr            SQL expression for VALUECHANGEDTO (or 'NULL')
 * @param {string} fromLabelExpr     SQL expression for VALUECHANGEDFROMLABEL (or 'NULL')
 * @param {string} toLabelExpr       SQL expression for VALUECHANGEDTOLABEL (or 'NULL')
 * @param {string} modification      'create' | 'update' | 'delete'
 * @returns {string}
 */
function _buildChangelogInsertSQL(col, hasParent, fromExpr, toExpr, fromLabelExpr, toLabelExpr, modification) {
  const valueType = col.altExpression ? 'cds.String' : col.type;
  const cols = hasParent
    ? `(ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)`
    : `(ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)`;
  const values = hasParent
    ? `(RANDOM_UUID(), ?, '${col.name}', ${fromExpr}, ${toExpr}, ${fromLabelExpr}, ${toLabelExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${valueType}', '${modification}', TRANSACTION_ID())`
    : `(RANDOM_UUID(), '${col.name}', ${fromExpr}, ${toExpr}, ${fromLabelExpr}, ${toLabelExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${valueType}', '${modification}', TRANSACTION_ID())`;
  return `INSERT INTO sap_changelog_Changes 
            ${cols} 
            VALUES 
            ${values}`;
}

/**
 * Build the `String parentId = ensureCompositionParentEntry(...);` line for
 * a create/update/delete body. Returns `''` when there is no composition
 * parent (top-level tracked entity).
 */
function _buildParentIdSetup(compositionParentInfo, hasAncestors, modification) {
  if (!compositionParentInfo) return '';
  const extraArg = hasAncestors ? ', parentChangelogId' : '';
  return `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "${modification}"${extraArg});`;
}

/**
 * Emit the shared prelude for every body: `modificationTypeSetup + keysCalc
 * + parentIdSetup`. Returns an object with the pieces so bodies can splice
 * additional statements between them (e.g. deleteBlock in delete-body).
 */
function _buildBodyPrelude(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, ancestorChain, reference, modification) {
  const modificationTypeSetup = grandParentCompositionInfo ? `String modificationType = "${modification}";` : '';
  const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, objectIDs, ancestorChain);
  const hasAncestors = !!grandParentCompositionInfo || (ancestorChain && ancestorChain.length > 0);
  const parentIdSetup = _buildParentIdSetup(compositionParentInfo, hasAncestors, modification);
  return { modificationTypeSetup, keysCalc, parentIdSetup };
}

/**
 * Generates the per-column change-detection block used by create /
 * delete / delete-preserve bodies. All three share the same guard
 * (non-null bindings + skip check + optional composition-dedup) and only
 * differ in which VALUECHANGED slot is populated + the MODIFICATION literal.
 */
function _generateNonUpdateColumnBlock(col, reference, compositionParentInfo, entity, model, modification) {
  const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
  const labelRes = _prepareLabelExpression(col, reference, model, entity);

  const childLookup = _buildChildObjectIDLookup(col, reference, model);
  const objectIDVar = childLookup ? childLookup.javaVar : 'objectID';
  const childSetup = childLookup ? childLookup.setup : '';

  // create → new value goes to VALUECHANGEDTO; delete → old value goes to VALUECHANGEDFROM
  const fromExpr = modification === 'delete' ? sqlExpr : 'NULL';
  const toExpr = modification === 'delete' ? 'NULL' : sqlExpr;
  const fromLbl = modification === 'delete' ? labelRes.sqlExpr : 'NULL';
  const toLbl = modification === 'delete' ? 'NULL' : labelRes.sqlExpr;

  const insertSQL = _buildChangelogInsertSQL(col, !!compositionParentInfo, fromExpr, toExpr, fromLbl, toLbl, modification);

  const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', objectIDVar];

  const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

  const elementSkipVar = getElementSkipVarName(entity.name, col.name);

  // Composition-of-one columns are deduplicated by attribute so the child
  // trigger doesn't emit a second composition entry for the same (entity,
  // attribute) pair within a single transaction.
  const isCompOne = col.type === 'cds.Composition' && col.is2one;
  const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';
  const compositionCheck = isCompOne ? ` && !hasExistingCompositionEntry(conn, entityName, entityKey, "${col.name}")` : '';

  return `${childSetup}
        if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")${compositionCheck}) {
            ${tryBlock}
        }`;
}

function _generateNonUpdateColumnBlocks(columns, reference, compositionParentInfo, entity, model, modification) {
  return columns.map((col) => _generateNonUpdateColumnBlock(col, reference, compositionParentInfo, entity, model, modification)).join('\n');
}

// ------------------------------------------------------------------------
// Body generators
// ------------------------------------------------------------------------

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, ancestorChain = null) {
  const reference = 'newRow';
  const { modificationTypeSetup, keysCalc, parentIdSetup } = _buildBodyPrelude(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, ancestorChain, reference, 'create');

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = _generateNonUpdateColumnBlocks(columns, reference, compositionParentInfo, entity, model, 'create');
  return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, ancestorChain = null) {
  const reference = 'newRow';
  const { modificationTypeSetup, keysCalc, parentIdSetup } = _buildBodyPrelude(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, ancestorChain, reference, 'update');

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = columns
    .map((col) => {
      const newRes = _prepareValueExpression(col, 'newRow');
      const oldRes = _prepareValueExpression(col, 'oldRow');
      const newLabelRes = _prepareLabelExpression(col, 'newRow', model, entity);
      const oldLabelRes = _prepareLabelExpression(col, 'oldRow', model, entity);

      // For composition-of-one columns, look up the child's objectID for
      // the emitted change (uses OLD FK so we can find the child before an
      // eventual UPDATE nulls the FK).
      const childLookup = _buildChildObjectIDLookup(col, 'oldRow', model) ?? _buildChildObjectIDLookup(col, 'newRow', model);
      const objectIDVar = childLookup ? childLookup.javaVar : 'objectID';
      const childSetup = childLookup ? childLookup.setup : '';

      let checkCols = [col.name];
      if (col.foreignKeys && col.foreignKeys.length > 0) {
        checkCols = col.foreignKeys.map((fk) => `${col.name}_${fk}`);
      } else if (col.on && col.on.length > 0) {
        checkCols = col.on.map((m) => m.foreignKeyField);
      }

      const changeCheck = checkCols.map((dbCol) => `!Objects.equals(newRow.getObject("${dbCol}"), oldRow.getObject("${dbCol}"))`).join(' || ');

      const insertSQL = _buildChangelogInsertSQL(col, !!compositionParentInfo, oldRes.sqlExpr, newRes.sqlExpr, oldLabelRes.sqlExpr, newLabelRes.sqlExpr, 'update');

      const allBindings = compositionParentInfo
        ? ['parentId', ...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', objectIDVar]
        : [...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', objectIDVar];

      const elementSkipVar = getElementSkipVarName(entity.name, col.name);

      // For composition columns, add deduplication check to prevent duplicate entries
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

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, ancestorChain = null) {
  const reference = 'oldRow';
  const { modificationTypeSetup, keysCalc, parentIdSetup } = _buildBodyPrelude(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, ancestorChain, reference, 'delete');

  // First delete existing changelogs for this entity
  const deleteBlock = _wrapInTryCatch(`DELETE FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ?`, ['entityName', 'entityKey']);

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${deleteBlock}\n${parentIdSetup}`;
  }

  const columnBlocks = _generateNonUpdateColumnBlocks(columns, reference, compositionParentInfo, entity, model, 'delete');

  return `${modificationTypeSetup}
        ${keysCalc}
        ${deleteBlock}
        ${parentIdSetup}
        ${columnBlocks}`;
}

function _generateDeleteBodyPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo = null, grandParentCompositionInfo = null, ancestorChain = null) {
  const reference = 'oldRow';
  const { modificationTypeSetup, keysCalc, parentIdSetup } = _buildBodyPrelude(entity, columns, objectIDs, rootEntity, rootObjectIDs, model, compositionParentInfo, grandParentCompositionInfo, ancestorChain, reference, 'delete');

  // Handle composition-only triggers (no tracked columns)
  if (columns.length === 0 && compositionParentInfo) {
    return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
  }

  const columnBlocks = _generateNonUpdateColumnBlocks(columns, reference, compositionParentInfo, entity, model, 'delete');

  return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

module.exports = {
  _generateJavaClass,
  _generateAbstractBaseClass,
  _generateCreateBody,
  _generateUpdateBody,
  _generateDeleteBody,
  _generateDeleteBodyPreserve,
  _javaClassNameForEntity,
  _fqcnForEntity,
  TRIGGER_JAVA_PACKAGE,
  TRIGGER_JAVA_BASE_CLASS
};
