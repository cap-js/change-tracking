const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

let HANACQN2SQL;
let _quoter;

function _getInstance() {
  if (!HANACQN2SQL) {
    const { CQN2SQL } = require('@cap-js/hana');
    const TriggerCQN2SQL = createTriggerCQN2SQL(CQN2SQL);
    HANACQN2SQL = new TriggerCQN2SQL();
  }
  return HANACQN2SQL;
}

/**
 * Strips `LIMIT` / `one` from a CQN SELECT query (recursively into compound queries).
 *
 * Statement-level triggers reference the outer transition table aliases (e.g. `nr.<col>`)
 * inside scalar subqueries (association/text-table lookups). HANA forbids `TOP`/`ORDER BY`
 * in correlated subqueries, so the `LIMIT 1` that `SELECT.one` emits causes the trigger
 * to be rejected at deploy time. Uniqueness is guaranteed by the PK / locale composite key
 * of the lookup target, so dropping the LIMIT is safe.
 */
function _stripLimit(query) {
  if (!query) return;
  if (query.SELECT) {
    query.SELECT.limit = undefined;
    query.SELECT.one = false;
    if (query.SELECT.from) _stripLimit(query.SELECT.from);
  }
  if (Array.isArray(query.args)) query.args.forEach(_stripLimit);
}

/**
 * Compiles a CQN query to HANA SQL for use inside a statement-level trigger body.
 * Always strips `LIMIT` to satisfy the HANA correlated-subquery restriction.
 */
function toSQL(query, model) {
  const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
  const sqlCQN = cqn4sql(query, model);
  _stripLimit(sqlCQN);
  return _getInstance().SELECT(sqlCQN);
}

/**
 * Quotes a HANA SQL identifier if it is a reserved keyword. Uses HANA CQN2SQL adapter's built-in quoting logic.
 */
function quote(name) {
  if (!_quoter) _quoter = new (require('@cap-js/hana').CQN2SQL)();
  return _quoter.quote(name);
}

/**
 * Returns the SQL fragment for referencing a column on a transition row.
 *
 * Accepts two forms of `refRow` so that both trigger-generation strategies can
 * share the helpers in this file:
 *  - 'new' / 'old' for row-level scalar reference (e.g. `:new.col`)
 *  - any other string  for transition-table alias (e.g. `nr.col`, `o.col`)
 */
function colRef(refRow, col) {
  if (refRow === 'new' || refRow === 'old') {
    return `:${refRow}.${quote(col)}`;
  }
  return `${refRow}.${quote(col)}`;
}

function getSkipCheckCondition(entityName) {
  const entitySkipVar = getEntitySkipVarName(entityName);
  return `(COALESCE(SESSION_CONTEXT('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(SESSION_CONTEXT('${entitySkipVar}'), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
  const varName = getElementSkipVarName(entityName, elementName);
  return `COALESCE(SESSION_CONTEXT('${varName}'), 'false') != 'true'`;
}

function entityKeyExpr(parts) {
  if (parts.length <= 1) return `TO_NVARCHAR(${parts[0]})`;
  return `HIERARCHY_COMPOSITE_ID(${parts.join(', ')})`;
}

/**
 * Truncates large strings: CASE WHEN LENGTH(val) > 5000 THEN LEFT(val, 4997) || '...' ELSE val END
 */
function wrapLargeString(val, isLob = false) {
  if (val === 'NULL') return 'NULL';
  // For LOB types, we need to convert to NVARCHAR first
  const expr = isLob ? `TO_NVARCHAR(${val})` : val;
  return `CASE WHEN LENGTH(${expr}) > 5000 THEN LEFT(${expr}, 4997) || '...' ELSE ${expr} END`;
}

/**
 * Returns SQL expression for a column's raw value.
 */
function getValueExpr(col, refRow) {
  if (col.type === 'cds.Boolean') {
    return colRef(refRow, col.name);
  }
  if (col.target && col.foreignKeys) {
    return col.foreignKeys.map((fk) => `TO_NVARCHAR(${colRef(refRow, `${col.name}_${fk}`)})`).join(" || ' ' || ");
  }
  if (col.target && col.on) {
    return col.on.map((m) => `TO_NVARCHAR(${colRef(refRow, m.foreignKeyField)})`).join(" || ' ' || ");
  }
  // Scalar value
  let raw = colRef(refRow, col.name);
  if (col.type === 'cds.LargeString') {
    return wrapLargeString(raw, true);
  }
  if (col.type === 'cds.String') {
    return wrapLargeString(raw, false);
  }
  return `TO_NVARCHAR(${raw})`;
}

/**
 * Null-safe change detection: (old <> new OR old IS NULL OR new IS NULL) AND NOT (old IS NULL AND new IS NULL)
 */
function nullSafeChanged(column, isLob, newRef, oldRef) {
  // For LOB types, convert to NVARCHAR before comparison
  const oRaw = colRef(oldRef, column);
  const nRaw = colRef(newRef, column);
  const o = isLob ? `TO_NVARCHAR(${oRaw})` : oRaw;
  const n = isLob ? `TO_NVARCHAR(${nRaw})` : nRaw;
  return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

/**
 * Returns SQL WHERE condition for detecting column changes (null-safe comparison).
 *
 * @param {object} col
 * @param {'create'|'update'|'delete'} modification
 * @param {{ newRef: string, oldRef: string }} [refs] - Row-refs. Defaults to
 *   `{ newRef: 'new', oldRef: 'old' }` for the row-level path.
 */
function getWhereCondition(col, modification, refs = { newRef: 'new', oldRef: 'old' }) {
  const isLob = col.type === 'cds.LargeString';
  const { newRef, oldRef } = refs;

  if (modification === 'update') {
    const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
    return checkCols.map((k) => nullSafeChanged(k, isLob, newRef, oldRef)).join(' OR ');
  }
  // CREATE or DELETE: check value is not null
  const refRow = modification === 'create' ? newRef : oldRef;
  if (col.target && col.foreignKeys) {
    return col.foreignKeys.map((fk) => `${colRef(refRow, `${col.name}_${fk}`)} IS NOT NULL`).join(' OR ');
  }
  if (col.target && col.on) {
    return col.on.map((m) => `${colRef(refRow, m.foreignKeyField)} IS NOT NULL`).join(' OR ');
  }
  // For LOB types, convert to NVARCHAR before null check
  if (isLob) {
    return `TO_NVARCHAR(${colRef(refRow, col.name)}) IS NOT NULL`;
  }
  return `${colRef(refRow, col.name)} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale awareness.
 */
function buildAssocLookup(col, assocPaths, refRow, model) {
  let where = {};
  if (col.foreignKeys) {
    where = col.foreignKeys.reduce((acc, k) => {
      acc[k] = { val: colRef(refRow, `${col.name}_${k}`), literal: 'sql' };
      return acc;
    }, {});
  } else if (col.on) {
    where = col.on.reduce((acc, mapping) => {
      acc[mapping.targetKey] = { val: colRef(refRow, mapping.foreignKeyField), literal: 'sql' };
      return acc;
    }, {});
  }

  const alt = assocPaths.map((s) => s.split('.').slice(1).join('.'));
  const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

  // Check for localization
  const localizedInfo = utils.getLocalizedLookupInfo(col.target, assocPaths, model);
  if (localizedInfo) {
    const textsWhere = { ...where, locale: { func: 'SESSION_CONTEXT', args: [{ val: 'LOCALE' }] } };
    const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
    const baseQuery = SELECT.one.from(col.target).columns(columns).where(where);
    return `COALESCE((${toSQL(textsQuery, model)}), (${toSQL(baseQuery, model)}))`;
  }

  const query = SELECT.one.from(col.target).columns(columns).where(where);
  return `(${toSQL(query, model)})`;
}

const { buildExpressionSQL } = require('../utils/expression-sql.js');

/**
 * Returns SQL expression for a column's label (looked-up value for associations).
 */
function getLabelExpr(col, refRow, model, entity) {
  // Expression-based labels: translate CDS expression to SQL with trigger row refs
  if (col.altExpression) {
    const CQN2SQLClass = require('@cap-js/hana').CQN2SQL;
    return `TO_NVARCHAR(${buildExpressionSQL(col.altExpression, entity, refRow, model, toSQL, colRef, CQN2SQLClass)})`;
  }

  if (!col.alt || col.alt.length === 0) return `NULL`;

  const parts = [];
  let assocBatch = [];

  const flushAssocBatch = () => {
    if (assocBatch.length > 0) {
      parts.push(buildAssocLookup(col, assocBatch, refRow, model));
      assocBatch = [];
    }
  };

  for (const entry of col.alt) {
    if (entry.source === 'assoc') {
      assocBatch.push(entry.path);
    } else {
      flushAssocBatch();
      parts.push(`TO_NVARCHAR(${colRef(refRow, entry.path)})`);
    }
  }
  flushAssocBatch();

  return parts.length === 0 ? `NULL` : parts.join(" || ', ' || ");
}

/**
 * Builds SQL expression for objectID based on @changelog annotation. Supports direct field references and expressions.
 * Falls back to entity keys when all fields are NULL.
 */
function buildObjectIDExpr(objectIDs, entity, refRow, model) {
  if (!objectIDs || objectIDs.length === 0) return null;
  const keys = utils.extractKeys(entity.keys);

  for (const objectID of objectIDs) {
    if (objectID.included) continue;
    if (objectID.expression) {
      const CQN2SQLClass = require('@cap-js/hana').CQN2SQL;
      objectID.selectSQL = buildExpressionSQL(objectID.expression, entity, refRow, model, toSQL, colRef, CQN2SQLClass);
    } else {
      const where = keys.reduce((acc, k) => {
        acc[k] = { val: colRef(refRow, k), literal: 'sql' };
        return acc;
      }, {});
      const query = SELECT.one.from(entity.name).columns(objectID.name).where(where);
      objectID.selectSQL = toSQL(query, model);
    }
  }

  const entityKey = entityKeyExpr(keys.map((k) => colRef(refRow, k)));

  // Single objectID field: simple COALESCE, no concat needed
  if (objectIDs.length === 1) {
    const id = objectIDs[0];
    const valueExpr = id.included ? `TO_NVARCHAR(${colRef(refRow, id.name)})` : `TO_NVARCHAR((${id.selectSQL}))`;
    return `COALESCE(${valueExpr}, ${entityKey})`;
  }

  // Multiple objectID fields: HANA-specific concat idiom; same outer fallback shape
  const parts = objectIDs.map((id) => (id.included ? `COALESCE(TO_NVARCHAR(${colRef(refRow, id.name)}), '<empty>')` : `TO_NVARCHAR((${id.selectSQL}))`));
  const nullChecks = objectIDs.map((id) => (id.included ? `${colRef(refRow, id.name)} IS NULL` : `(${id.selectSQL}) IS NULL`));
  const allNullCondition = nullChecks.join(' AND ');
  const concatExpr = parts.map((p) => `CASE WHEN ${p} IS NOT NULL THEN ', ' || ${p} ELSE '' END`).join(' || ');
  return `(CASE WHEN ${allNullCondition} THEN ${entityKey} ELSE COALESCE(NULLIF(LTRIM(${concatExpr}, ', '), ''), ${entityKey}) END)`;
}

/**
 * Builds the trigger context (entityKey + objectID SQL expressions) for an entity.
 *
 * @param {object} entity - The CDS entity definition
 * @param {Array} objectIDs - @changelog objectIDs of the entity
 * @param {string} refRow - Transition-table alias (e.g. 'nr' or 'o')
 * @param {object} model - The CDS model (CSN)
 * @returns {{ entityKey: string, objectID: string }}
 */
function buildTriggerContext(entity, objectIDs, refRow, model) {
  const keys = utils.extractKeys(entity.keys);
  const entityKey = entityKeyExpr(keys.map((k) => colRef(refRow, k)));
  const objectID = buildObjectIDExpr(objectIDs, entity, refRow, model) ?? entityKey;

  return { entityKey, objectID };
}

module.exports = {
  toSQL,
  quote,
  colRef,
  getSkipCheckCondition,
  getElementSkipCondition,
  entityKeyExpr,
  getValueExpr,
  getWhereCondition,
  getLabelExpr,
  buildObjectIDExpr,
  buildTriggerContext
};
