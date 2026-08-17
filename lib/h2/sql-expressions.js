const utils = require('../utils/change-tracking.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');
const { buildExpressionSQL } = require('../utils/expression-sql.js');

const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

// H2 reserves a superset of the SQLite keywords used by the base CQN2SQL
// https://h2database.com/html/advanced.html#keywords for reference.
const H2_EXTRA_RESERVED_WORDS = [
  'VALUE',
  'KEY',
  'YEAR',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
  'USER',
  'CURRENT_USER',
  'SESSION_USER',
  'SYSTEM_USER',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'LOCALTIME',
  'LOCALTIMESTAMP',
  'ARRAY',
  'ROW',
  'ROWS',
  'INTERSECTS'
];

const _cqn2sqlCache = new WeakMap();
let _TriggerCQN2SQLClass;

function _getTriggerCQN2SQLClass() {
  if (!_TriggerCQN2SQLClass) {
    const SQLiteService = require('@cap-js/sqlite');
    _TriggerCQN2SQLClass = createTriggerCQN2SQL(SQLiteService.CQN2SQL, H2_EXTRA_RESERVED_WORDS);
  }
  return _TriggerCQN2SQLClass;
}

function _toSQL(query, model) {
  let cqn2sql = _cqn2sqlCache.get(model);
  if (!cqn2sql) {
    cqn2sql = new (_getTriggerCQN2SQLClass())({ model: model });
    _cqn2sqlCache.set(model, cqn2sql);
  }
  const sqlCQN = cqn4sql(query, model);
  return cqn2sql.SELECT(sqlCQN);
}

function handleAssocLookup(column, assocPaths, refRow, model) {
  let bindings = [];
  let where = {};

  if (column.foreignKeys) {
    where = column.foreignKeys.reduce((acc, k) => {
      acc[k] = { val: '?', literal: 'sql' };
      return acc;
    }, {});
    bindings = column.foreignKeys.map((fk) => `${refRow}.getString("${column.name}_${fk}")`);
  } else if (column.on) {
    where = column.on.reduce((acc, mapping) => {
      acc[mapping.targetKey ?? mapping] = { val: '?', literal: 'sql' };
      return acc;
    }, {});
    bindings = column.on.map((assoc) => `${refRow}.getString("${assoc.foreignKeyField ?? assoc}")`);
  }

  const alt = assocPaths.map((s) => s.split('.').slice(1).join('.'));
  const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

  // Check if target entity has localized data
  const localizedInfo = utils.getLocalizedLookupInfo(column.target, assocPaths, model);

  if (localizedInfo) {
    // Build locale-aware lookup: try .texts table first, fall back to base entity
    const textsWhere = { ...where, locale: { val: '?', literal: 'sql' } };
    const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
    const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);

    const textsSQL = _toSQL(textsQuery, model);
    const baseSQL = _toSQL(baseQuery, model);

    // Add locale binding (fetched from session variable @$user.locale)
    const textsBindings = [...bindings, 'locale'];
    const baseBindings = [...bindings];

    return {
      sql: `(SELECT COALESCE((${textsSQL}), (${baseSQL})))`,
      bindings: [...textsBindings, ...baseBindings],
      needsLocale: true
    };
  }

  const query = SELECT.one.from(column.target).columns(columns).where(where);

  return {
    sql: `(${_toSQL(query, model)})`,
    bindings: bindings
  };
}

/**
 * Translates a CDS expression (xpr) into H2-flavored parameterized SQL for
 * use inside a Java trigger. Every local column reference is emitted as a
 * `?` placeholder; the corresponding Java binding (e.g. `newRow.getString("firstName")`)
 * is collected into a `bindings` array in emission order so the caller can
 * bind them onto the PreparedStatement.
 *
 * Numeric columns need an explicit `CAST(? AS DECIMAL)` type hint because
 * H2's implicit type-inference makes VARCHAR-bound `?` values incompatible
 * with arithmetic operators (e.g. `? * 2` throws "Data conversion error"
 * when H2 tries to multiply a VARCHAR by a number, even if the string is
 * parseable as a decimal).
 *
 * Multi-segment refs (association paths) are handled by the shared
 * `buildExpressionSQL` utility, which builds a scalar subselect against the
 * association target with the FK columns of the trigger row parameterized
 * via the same mechanism.
 *
 * @param {Array} xpr        CDS expression (array of tokens)
 * @param {object} entity    the CDS entity the expression is annotated on
 * @param {string} refRow    the trigger row local ('newRow' | 'oldRow')
 * @param {object} model     the CDS model
 * @returns {{ sqlExpr: string, bindings: string[] }}
 */
function _buildExpressionSQLForH2(xpr, entity, refRow, model) {
  const bindings = [];
  const colRef = (r, c) => {
    bindings.push(`${r}.getString("${c}")`);
    // Emit a type-hint CAST when the referenced element is numeric, so H2 can
    // apply arithmetic / comparison operators on the parameter without
    // failing "Data conversion error converting <string>".
    const el = entity?.elements?.[c];
    if (el && _isNumericType(el.type)) return 'CAST(? AS DECIMAL)';
    return '?';
  };
  const sqlExpr = buildExpressionSQL(xpr, entity, refRow, model, _toSQL, colRef, _getTriggerCQN2SQLClass());
  return { sqlExpr, bindings };
}

const _NUMERIC_TYPES = new Set([
  'cds.Decimal',
  'cds.DecimalFloat',
  'cds.Double',
  'cds.Integer',
  'cds.Integer64',
  'cds.UInt8',
  'cds.Int16',
  'cds.Int32',
  'cds.Int64'
]);
function _isNumericType(type) {
  return _NUMERIC_TYPES.has(type);
}

function _prepareValueExpression(col, rowVar) {
  // REVISIT
  if (col.type === 'cds.Boolean') {
    const val = `${rowVar}.getString("${col.name}")`;
    return {
      sqlExpr: `CASE WHEN ? IN ('1', 'TRUE', 'true') THEN 'true' WHEN ? IN ('0', 'FALSE', 'false') THEN 'false' ELSE NULL END`,
      bindings: [val, val]
    };
  }

  if (col.target && col.foreignKeys) {
    if (col.foreignKeys.length === 1) {
      // Single foreign key
      return {
        sqlExpr: '?',
        bindings: [`${rowVar}.getString("${col.name}_${col.foreignKeys[0]}")`]
      };
    } else {
      // Composite key handling (concatenation)
      const expr = col.foreignKeys.map(() => '?').join(" || ' ' || ");
      const binds = col.foreignKeys.map((fk) => `${rowVar}.getString("${col.name}_${fk}")`);
      return { sqlExpr: expr, bindings: binds };
    }
  }

  if (col.target && col.on) {
    if (col.on.length === 1) {
      return {
        sqlExpr: '?',
        bindings: [`${rowVar}.getString("${col.on[0].foreignKeyField}")`]
      };
    } else {
      const expr = col.on.map(() => '?').join(" || ' ' || ");
      const binds = col.on.map((m) => `${rowVar}.getString("${m.foreignKeyField}")`);
      return { sqlExpr: expr, bindings: binds };
    }
  }

  // Scalar value - apply truncation for String and LargeString types
  if (col.type === 'cds.String' || col.type === 'cds.LargeString') {
    return {
      sqlExpr: "CASE WHEN LENGTH(?) > 5000 THEN LEFT(?, 4997) || '...' ELSE ? END",
      bindings: [`${rowVar}.getString("${col.name}")`, `${rowVar}.getString("${col.name}")`, `${rowVar}.getString("${col.name}")`]
    };
  }

  return {
    sqlExpr: '?',
    bindings: [`${rowVar}.getString("${col.name}")`]
  };
}

// Returns label expression for a column
function _prepareLabelExpression(col, rowVar, model, entity) {
  // Expression-based labels: translate CDS expression to SQL with parameterized
  // trigger row references. Uses the shared expression builder with a stateful
  // colRef so we can collect the bindings for the emitted PreparedStatement.
  if (col.altExpression) {
    const { sqlExpr, bindings } = _buildExpressionSQLForH2(col.altExpression, entity, rowVar, model);
    // Preserve decimal scale for arithmetic expressions on Decimal columns.
    // H2 loses fractional digits when evaluating numeric expressions
    // (e.g. 50 * 2 -> 100), so cast the (possibly NULL) result to a
    // fixed-scale decimal and then to VARCHAR. CAST propagates NULL.
    if (col.type === 'cds.Decimal' && col.scale != null) {
      return {
        sqlExpr: `CAST(CAST((${sqlExpr}) AS DECIMAL(38,${col.scale})) AS VARCHAR)`,
        bindings
      };
    }
    return { sqlExpr: `(${sqlExpr})`, bindings };
  }

  if (!col.alt || col.alt.length === 0) {
    return { sqlExpr: 'NULL', bindings: [] };
  }

  const sqlParts = [];
  const allBindings = [];
  let assocBatch = [];

  const flushAssocBatch = () => {
    if (assocBatch.length > 0) {
      const { sql, bindings } = handleAssocLookup(col, assocBatch, rowVar, model);
      sqlParts.push(sql);
      allBindings.push(...bindings);
      assocBatch = [];
    }
  };

  for (const entry of col.alt) {
    if (entry.source === 'assoc') {
      assocBatch.push(entry.path);
    } else {
      flushAssocBatch();
      sqlParts.push('?');
      allBindings.push(`${rowVar}.getString("${entry.path}")`);
    }
  }
  flushAssocBatch();

  if (sqlParts.length === 0) {
    return { sqlExpr: 'NULL', bindings: [] };
  }

  const sqlExpr = sqlParts.length === 1 ? sqlParts[0] : sqlParts.join(" || ', ' || ");
  return { sqlExpr, bindings: allBindings };
}

function _wrapInTryCatch(sql, bindings) {
  // Escapes quotes for Java String
  const cleanSql = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');

  const setParams = bindings.map((b, i) => `stmt.setString(${i + 1}, ${b});`).join('\n                ');

  return `try (PreparedStatement stmt = conn.prepareStatement("${cleanSql}")) {
                ${setParams}
                stmt.executeUpdate();
            }`;
}

function entityKeyExpr(parts) {
  if (parts.length <= 1) return `CAST(${parts[0]} AS VARCHAR)`;
  return parts
    .map((p) => `LENGTH(CAST(${p} AS VARCHAR)) || ',' || CAST(${p} AS VARCHAR)`)
    .join(" || ';' || ");
}

module.exports = {
  _toSQL,
  _prepareValueExpression,
  _prepareLabelExpression,
  _wrapInTryCatch,
  entityKeyExpr
};
