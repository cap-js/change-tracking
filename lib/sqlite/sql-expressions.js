const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

const _cqn2sqlCache = new WeakMap();
let _quoter;

function toSQL(query, model) {
	const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
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

/**
 * Quotes a SQLite SQL identifier if it is a reserved keyword.
 * Uses the SQLite CQN2SQL adapter's built-in quoting logic.
 */
function quote(name) {
	if (!_quoter) _quoter = new (require('@cap-js/sqlite').CQN2SQL)();
	return _quoter.quote(name);
}

/**
 * Builds WHERE clause for CQN query from entity keys
 * Maps each key to a trigger row reference (e.g., new.ID, old.name)
 */
function buildKeyWhere(keys, refRow) {
	return keys.reduce((acc, k) => {
		acc[k] = { val: `${refRow}.${quote(k)}`, literal: 'sql' };
		return acc;
	}, {});
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(session_context('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(session_context('${entitySkipVar}'), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(session_context('${varName}'), 'false') != 'true'`;
}

function entityKeyExpr(parts) {
	if (parts.length <= 1) return parts[0];
	return parts.map((p) => `LENGTH(CAST(${p} AS TEXT)) || ',' || CAST(${p} AS TEXT)`).join(" || ';' || ");
}

/**
 * Truncates large strings in SQL: CASE WHEN LENGTH(val) > 5000 THEN SUBSTR(val, 1, 4997) || '...' ELSE val END
 */
function wrapLargeString(val) {
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN SUBSTR(${val}, 1, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `CASE ${refRow}.${quote(col.name)} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${refRow}.${quote(`${col.name}_${fk}`)}`).join(" || '||' || ");
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${refRow}.${quote(m.foreignKeyField)}`).join(" || '||' || ");
	}
	let raw = `${refRow}.${quote(col.name)}`;
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') raw = wrapLargeString(raw);
	if (col.type === 'cds.Decimal' && col.scale != null) {
		return `CASE WHEN ${raw} IS NOT NULL THEN PRINTF('%.${col.scale}f', ${raw}) ELSE NULL END`;
	}
	return raw;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys
				.map((fk) => {
					const q = quote(`${col.name}_${fk}`);
					return `old.${q} IS NOT new.${q}`;
				})
				.join(' OR ');
		}
		if (col.target && col.on?.length) {
			return col.on
				.map((m) => {
					const q = quote(m.foreignKeyField);
					return `old.${q} IS NOT new.${q}`;
				})
				.join(' OR ');
		}
		const q = quote(col.name);
		return `old.${q} IS NOT new.${q}`;
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${rowRef}.${quote(`${col.name}_${fk}`)} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${rowRef}.${quote(m.foreignKeyField)} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${quote(col.name)} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale awareness
 */
function buildAssocLookup(column, assocPaths, refRow, entityKey, model) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
				acc[k] = { val: `${refRow}.${quote(`${column.name}_${k}`)}`, literal: 'sql' };
				return acc;
			}, {})
		: column.on?.reduce((acc, k) => {
				// Composition of aspect has a targetKey object
				acc[k.targetKey ?? k] = { val: entityKey, literal: 'sql' };
				return acc;
			}, {});

	// Drop the first part of each path (association name)
	const alt = assocPaths.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, assocPaths, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'session_context', args: [{ val: '$user.locale' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		return `(SELECT COALESCE((${toSQL(textsQuery, model)}), (${toSQL(baseQuery, model)})))`;
	}

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${toSQL(query, model)})`;
}

const { buildExpressionSQL } = require('../utils/expression-sql.js');

/**
 * Returns SQL expression for a column's label (looked-up value for associations)
 */
function getLabelExpr(col, refRow, entityKey, model, entity) {
	// Expression-based labels: translate CDS expression to SQL with trigger row refs
	if (col.altExpression) {
		const SQLiteService = require('@cap-js/sqlite');
		const exprSQL = buildExpressionSQL(col.altExpression, entity, refRow, model, SQLiteService.CQN2SQL, toSQL, (r, c) => `${r}.${quote(c)}`);
		// Preserve decimal scale for arithmetic expressions on Decimal columns
		// SQLite loses fractional digits when evaluating numeric expressions (e.g. 50 * 2 → 100).
		if (col.type === 'cds.Decimal' && col.scale != null) {
			return `CASE WHEN (${exprSQL}) IS NOT NULL THEN PRINTF('%.${col.scale}f', ${exprSQL}) ELSE NULL END`;
		}
		return exprSQL;
	}

	if (!col.alt || col.alt.length === 0) return 'NULL';

	const parts = [];
	let assocBatch = [];

	const flushAssocBatch = () => {
		if (assocBatch.length > 0) {
			parts.push(buildAssocLookup(col, assocBatch, refRow, entityKey, model));
			assocBatch = [];
		}
	};

	for (const entry of col.alt) {
		if (entry.source === 'assoc') {
			assocBatch.push(entry.path);
		} else {
			// local field: flush any pending association batch first, then emit local ref
			flushAssocBatch();
			parts.push(`${refRow}.${quote(entry.path)}`);
		}
	}
	flushAssocBatch();

	return parts.length === 0 ? 'NULL' : parts.join(" || ', ' || ");
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity keys.
 * When all @changelog fields are NULL, falls back to the entity key.
 * When some are NULL, shows '<empty>' for missing values.
 */
function buildObjectIDSelect(objectIDs, entity, entityKeys, refRow, model) {
	if (objectIDs.length === 0) return null;

	for (const objectID of objectIDs) {
		if (objectID.included) continue;
		if (objectID.expression) {
			// Expression-based ObjectID: inline expression using trigger row refs
			const SQLiteService = require('@cap-js/sqlite');
			objectID.selectSQL = buildExpressionSQL(objectID.expression, entity, refRow, model, SQLiteService.CQN2SQL, toSQL, (r, c) => `${r}.${quote(c)}`);
		} else {
			const where = buildKeyWhere(entityKeys, refRow);
			const query = SELECT.one.from(entity).columns(objectID.name).where(where);
			objectID.selectSQL = toSQL(query, model);
		}
	}

	const entityKey = entityKeyExpr(entityKeys.map((k) => `${refRow}.${quote(k)}`));

	// Single objectID field: simple COALESCE, no GROUP_CONCAT needed
	if (objectIDs.length === 1) {
		const id = objectIDs[0];
		const valueExpr = id.included ? `${refRow}.${quote(id.name)}` : `(${id.selectSQL})`;
		return `COALESCE(${valueExpr}, ${entityKey})`;
	}

	// Multiple objectID fields: use GROUP_CONCAT with '<empty>' for individual NULLs,
	// fall back to entityKey when ALL fields are NULL
	const unionParts = objectIDs.map((id) => (id.included ? `SELECT COALESCE(${refRow}.${quote(id.name)}, '<empty>') AS value` : `SELECT (${id.selectSQL}) AS value`));
	const concatExpr = `(SELECT GROUP_CONCAT(value, ', ') FROM (${unionParts.join('\nUNION ALL\n')}))`;

	const nullChecks = objectIDs.map((id) => (id.included ? `${refRow}.${quote(id.name)} IS NULL` : `(${id.selectSQL}) IS NULL`));
	const allNullCondition = nullChecks.join(' AND ');

	return `(CASE WHEN ${allNullCondition} THEN ${entityKey} ELSE ${concatExpr} END)`;
}

function buildTriggerContext(entity, objectIDs, refRow, model, compositionParentInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = entityKeyExpr(keys.map((k) => `${refRow}.${quote(k)}`));
	const objectID = buildObjectIDSelect(objectIDs, entity, keys, refRow, model) ?? entityKey;
	const parentLookupExpr = compositionParentInfo ? 'PARENT_LOOKUP_PLACEHOLDER' : null;

	return { keys, entityKey, objectID, parentLookupExpr };
}

function buildInsertSQL(entity, columns, modification, ctx, model) {
	const unionQuery = columns
		.map((col) => {
			const whereCondition = getWhereCondition(col, modification);
			const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
			let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

			// For composition-of-one columns, add deduplication check to prevent duplicate entries
			// when child trigger has already created a composition entry for this transaction
			if (col.type === 'cds.Composition' && ctx.entityKey) {
				fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${entity.name}'
			AND entityKey = ${ctx.entityKey}
			AND attribute = '${col.name}'
			AND valueDataType = 'cds.Composition'
			AND createdAt = session_context('$now')
			AND createdBy = session_context('$user.id')
		)`;
			}

			const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'old');
			const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'new');
			const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old', ctx.entityKey, model, entity);
			const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new', ctx.entityKey, model, entity);

			// When an expression-based label is used, the label result type may differ from
			// the element's declared type (e.g., a ternary returning strings on a Decimal column).
			// Use 'cds.String' so the ChangeView doesn't cast the label to the wrong type.
			const dataType = col.altExpression ? 'cds.String' : col.type;

			return `
			SELECT 
				'${col.name}' AS attribute, 
				${oldVal} AS valueChangedFrom, 
				${newVal} AS valueChangedTo, 
				${oldLabel} AS valueChangedFromLabel, 
				${newLabel} AS valueChangedToLabel, 
				'${dataType}' AS valueDataType 
			WHERE ${fullWhere}`;
		})
		.join('\nUNION ALL\n');

	return `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			${ctx.parentLookupExpr ?? 'NULL'},
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'${entity.name}',
			${ctx.entityKey},
			${ctx.objectID},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'${modification}',
			session_context('$now')
		FROM (
			${unionQuery}
		);`;
}

module.exports = {
	toSQL,
	quote,
	getSkipCheckCondition,
	getElementSkipCondition,
	entityKeyExpr,
	getValueExpr,
	getWhereCondition,
	buildObjectIDSelect,
	buildTriggerContext,
	buildInsertSQL
};
