const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const _cqn2sqlCache = new WeakMap();

function toSQL(query, model) {
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
 * Builds WHERE clause for CQN query from entity keys
 * Maps each key to a trigger row reference (e.g., new.ID, old.name)
 */
function buildKeyWhere(keys, refRow) {
	return keys.reduce((acc, k) => {
		acc[k] = { val: `${refRow}.${k}` };
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

function compositeKeyExpr(parts) {
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
		return `CASE ${refRow}.${col.name} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}`).join(" || '||' || ");
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${refRow}.${m.foreignKeyField}`).join(" || '||' || ");
	}
	let raw = `${refRow}.${col.name}`;
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') raw = wrapLargeString(raw);
	return raw;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map((fk) => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
		}
		if (col.target && col.on?.length) {
			return col.on.map((m) => `old.${m.foreignKeyField} IS NOT new.${m.foreignKeyField}`).join(' OR ');
		}
		return `old.${col.name} IS NOT new.${col.name}`;
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${col.name} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale awareness
 */
function buildAssocLookup(column, refRow, entityKey, model) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
				acc[k] = { val: `${refRow}.${column.name}_${k}` };
				return acc;
			}, {})
		: column.on?.reduce((acc, k) => {
				// Composition of aspect has a targetKey object
				acc[k.targetKey ?? k] = { val: entityKey };
				return acc;
			}, {});

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'session_context', args: [{ val: '$user.locale' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		return `(SELECT COALESCE((${toSQL(textsQuery, model)}), (${toSQL(baseQuery, model)})))`;
	}

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${toSQL(query, model)})`;
}

/**
 * Returns SQL expression for a column's label (looked-up value for associations)
 */
function getLabelExpr(col, refRow, entityKey, model) {
	const parts = [];

	if (col.target && col.alt) {
		parts.push(buildAssocLookup(col, refRow, entityKey, model));
	}

	if (col.altLocal) {
		for (const field of col.altLocal) parts.push(`${refRow}.${field}`);
	}

	return parts.length === 0 ? 'NULL' : parts.join(" || ', ' || ");
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity keys
 */
function buildObjectIDSelect(objectIDs, entityName, entityKeys, refRow, model) {
	if (objectIDs.length === 0) return null;

	for (const objectID of objectIDs) {
		if (objectID.included) continue;
		const where = buildKeyWhere(entityKeys, refRow);
		const query = SELECT.one.from(entityName).columns(objectID.name).where(where);
		objectID.selectSQL = toSQL(query, model);
	}

	const unionParts = objectIDs.map((id) => (id.included ? `SELECT COALESCE(${refRow}.${id.name}, '<empty>') AS value` : `SELECT (${id.selectSQL}) AS value`));

	return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unionParts.join('\nUNION ALL\n')}))`;
}

function buildTriggerContext(entity, objectIDs, refRow, model, compositionParentInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = compositeKeyExpr(keys.map((k) => `${refRow}.${k}`));
	const objectID = buildObjectIDSelect(objectIDs, entity.name, keys, refRow, model) ?? entityKey;
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
			const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old', ctx.entityKey, model);
			const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new', ctx.entityKey, model);

			return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType WHERE ${fullWhere}`;
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
	getSkipCheckCondition,
	getElementSkipCondition,
	compositeKeyExpr,
	getValueExpr,
	getWhereCondition,
	getLabelExpr,
	buildObjectIDSelect,
	buildTriggerContext,
	buildInsertSQL
};
