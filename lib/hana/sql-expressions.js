const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

let HANACQN2SQL;
let _quoter;

function toSQL(query, model) {
	const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
	if (!HANACQN2SQL) {
		const { CQN2SQL } = require('@cap-js/hana');
		const TriggerCQN2SQL = createTriggerCQN2SQL(CQN2SQL);
		HANACQN2SQL = new TriggerCQN2SQL();
	}
	const sqlCQN = cqn4sql(query, model);
	return HANACQN2SQL.SELECT(sqlCQN);
}

/**
 * Quotes a HANA SQL identifier if it is a reserved keyword. Uses HANA CQN2SQL adapter's built-in quoting logic.
 */
function quote(name) {
	if (!_quoter) _quoter = new (require('@cap-js/hana').CQN2SQL)();
	return _quoter.quote(name);
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
 * Uses HANA row-level trigger syntax: :refRow.column
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `:${refRow}.${quote(col.name)}`;
	}
	if (col.target && col.foreignKeys) {
		return col.foreignKeys.map((fk) => `TO_NVARCHAR(:${refRow}.${quote(`${col.name}_${fk}`)})`).join(" || ' ' || ");
	}
	if (col.target && col.on) {
		return col.on.map((m) => `TO_NVARCHAR(:${refRow}.${quote(m.foreignKeyField)})`).join(" || ' ' || ");
	}
	// Scalar value
	let raw = `:${refRow}.${quote(col.name)}`;
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
 * Uses HANA row-level trigger syntax: :old.column, :new.column
 */
function nullSafeChanged(column, isLob = false) {
	// For LOB types, convert to NVARCHAR before comparison
	const qCol = quote(column);
	const o = isLob ? `TO_NVARCHAR(:old.${qCol})` : `:old.${qCol}`;
	const n = isLob ? `TO_NVARCHAR(:new.${qCol})` : `:new.${qCol}`;
	return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

/**
 * Returns SQL WHERE condition for detecting column changes (null-safe comparison).
 * Uses HANA row-level trigger syntax.
 */
function getWhereCondition(col, modification) {
	const isLob = col.type === 'cds.LargeString';
	if (modification === 'update') {
		const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
		return checkCols.map((k) => nullSafeChanged(k, isLob)).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys) {
		return col.foreignKeys.map((fk) => `:${rowRef}.${quote(`${col.name}_${fk}`)} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on) {
		return col.on.map((m) => `:${rowRef}.${quote(m.foreignKeyField)} IS NOT NULL`).join(' OR ');
	}
	// For LOB types, convert to NVARCHAR before null check
	if (isLob) {
		return `TO_NVARCHAR(:${rowRef}.${quote(col.name)}) IS NOT NULL`;
	}
	return `:${rowRef}.${quote(col.name)} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale awareness.
 */
function buildAssocLookup(col, assocPaths, refRow, model) {
	let where = {};
	if (col.foreignKeys) {
		where = col.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${quote(`${col.name}_${k}`)}`, literal: 'sql' };
			return acc;
		}, {});
	} else if (col.on) {
		where = col.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `:${refRow}.${quote(mapping.foreignKeyField)}`, literal: 'sql' };
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
function getLabelExpr(col, refRow, model, entityName = null) {
	// Expression-based labels: translate CDS expression to SQL with trigger row refs
	if (col.altExpression && entityName) {
		const CQN2SQLClass = require('@cap-js/hana').CQN2SQL;
		// Cast to NVARCHAR to ensure UNION compatibility — expression results may be numeric/date/etc.
		return `TO_NVARCHAR(${buildExpressionSQL(col.altExpression, entityName, refRow, model, CQN2SQLClass, toSQL, (r, c) => `:${r}.${quote(c)}`)})`;
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
			parts.push(`TO_NVARCHAR(:${refRow}.${quote(entry.path)})`);
		}
	}
	flushAssocBatch();

	return parts.length === 0 ? `NULL` : parts.join(" || ', ' || ");
}

/**
 * Builds SQL expression for objectID (entity display name).
 * Uses @changelog annotation fields, falling back to entity keys.
 */
function buildObjectIDExpr(objectIDs, entity, rowRef, model) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = entityKeyExpr(keys.map((k) => `:${rowRef}.${quote(k)}`));

	if (!objectIDs || objectIDs.length === 0) {
		return entityKey;
	}

	const parts = [];
	const nullChecks = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			// Included fields are directly available from the trigger row
			parts.push(`COALESCE(TO_NVARCHAR(:${rowRef}.${quote(oid.name)}), '<empty>')`);
			nullChecks.push(`:${rowRef}.${quote(oid.name)} IS NULL`);
		} else if (oid.expression) {
			// Expression-based ObjectID: inline expression using trigger row refs
			const CQN2SQLClass = require('@cap-js/hana').CQN2SQL;
			const sql = buildExpressionSQL(oid.expression, entity.name, rowRef, model, CQN2SQLClass, toSQL, (r, c) => `:${r}.${quote(c)}`);
			parts.push(`TO_NVARCHAR(${sql})`);
			nullChecks.push(`(${sql}) IS NULL`);
		} else {
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `:${rowRef}.${quote(k)}`, literal: 'sql' };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			const sql = toSQL(query, model);
			parts.push(`TO_NVARCHAR((${sql}))`);
			nullChecks.push(`(${sql}) IS NULL`);
		}
	}

	// When all @changelog fields are NULL, fall back to entity key
	// Single objectID field: simple COALESCE, no concat needed
	if (parts.length === 1) {
		return `COALESCE(${parts[0]}, ${entityKey})`;
	}

	// Multiple objectID fields: use concat with '<empty>' for individual NULLs,
	// fall back to entityKey when ALL fields are NULL
	const allNullCondition = nullChecks.join(' AND ');
	const concatExpr = parts.map((p) => `CASE WHEN ${p} IS NOT NULL THEN ', ' || ${p} ELSE '' END`).join(' || ');
	return `CASE WHEN ${allNullCondition} THEN ${entityKey} ELSE COALESCE(NULLIF(LTRIM(${concatExpr}, ', '), ''), ${entityKey}) END`;
}

module.exports = {
	toSQL,
	quote,
	getSkipCheckCondition,
	getElementSkipCondition,
	entityKeyExpr,
	wrapLargeString,
	getValueExpr,
	getWhereCondition,
	getLabelExpr,
	buildObjectIDExpr
};
