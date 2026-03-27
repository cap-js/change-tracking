const utils = require('../utils/change-tracking.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

const _cqn2sqlCache = new WeakMap();

function _toSQL(query, model) {
	let cqn2sql = _cqn2sqlCache.get(model);
	if (!cqn2sql) {
		const SQLiteService = require('@cap-js/sqlite');
		const TriggerCQN2SQL = createTriggerCQN2SQL(SQLiteService.CQN2SQL);
		cqn2sql = new TriggerCQN2SQL({ model: model });
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
			acc[k] = { ref: ['?'], param: true };
			return acc;
		}, {});
		bindings = column.foreignKeys.map((fk) => `${refRow}.getString("${column.name}_${fk}")`);
	} else if (column.on) {
		where = column.on.reduce((acc, k) => {
			acc[k] = { ref: ['?'], param: true };
			return acc;
		}, {});
		bindings = column.on.map((assoc) => `${refRow}.getString("${assoc}")`);
	}

	const alt = assocPaths.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check if target entity has localized data
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, assocPaths, model);

	if (localizedInfo) {
		// Build locale-aware lookup: try .texts table first, fall back to base entity
		const textsWhere = { ...where, locale: { ref: ['?'], param: true } };
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
function _prepareLabelExpression(col, rowVar, model) {
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

module.exports = {
	_toSQL,
	_prepareValueExpression,
	_prepareLabelExpression,
	_wrapInTryCatch
};
