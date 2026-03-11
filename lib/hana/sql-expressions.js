const utils = require('../utils/change-tracking.js');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

const TriggerCQN2SQL = createTriggerCQN2SQL(HANAService.CQN2SQL);
let HANACQN2SQL;
let model;

function setModel(m) {
	model = m;
}

function getModel() {
	return model;
}

function toSQL(query) {
	if (!HANACQN2SQL) {
		HANACQN2SQL = new TriggerCQN2SQL();
	}
	const sqlCQN = cqn4sql(query, model);
	return HANACQN2SQL.SELECT(sqlCQN);
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(SESSION_CONTEXT('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(SESSION_CONTEXT('${entitySkipVar}'), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(SESSION_CONTEXT('${varName}'), 'false') != 'true'`;
}

function compositeKeyExpr(parts) {
	if (parts.length <= 1) return parts[0];
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
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `:${refRow}.${col.name}`;
	}
	if (col.target && col.foreignKeys) {
		return col.foreignKeys.map((fk) => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	}
	if (col.target && col.on) {
		return col.on.map((m) => `TO_NVARCHAR(:${refRow}.${m.foreignKeyField})`).join(" || ' ' || ");
	}
	// Scalar value
	let raw = `:${refRow}.${col.name}`;
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
function nullSafeChanged(column, isLob = false) {
	// For LOB types, convert to NVARCHAR before comparison
	const o = isLob ? `TO_NVARCHAR(:old.${column})` : `:old.${column}`;
	const n = isLob ? `TO_NVARCHAR(:new.${column})` : `:new.${column}`;
	return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

/**
 * Returns SQL WHERE condition for detecting column changes (null-safe comparison)
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
		return col.foreignKeys.map((fk) => `:${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on) {
		return col.on.map((m) => `:${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	// For LOB types, convert to NVARCHAR before null check
	if (isLob) {
		return `TO_NVARCHAR(:${rowRef}.${col.name}) IS NOT NULL`;
	}
	return `:${rowRef}.${col.name} IS NOT NULL`;
}

/**
 * Returns SQL expression for a column's label (looked-up value for associations)
 */
function getLabelExpr(col, refRow) {
	if (!(col.target && col.alt)) {
		return `NULL`;
	}

	// Builds inline SELECT expression for association label lookup with locale support
	let where = {};
	if (col.foreignKeys) {
		where = col.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${col.name}_${k}` };
			return acc;
		}, {});
	} else if (col.on) {
		where = col.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `:${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	const alt = col.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(col.target, col.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'SESSION_CONTEXT', args: [{ val: 'LOCALE' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(col.target).columns(columns).where(where);
		return `COALESCE((${toSQL(textsQuery)}), (${toSQL(baseQuery)}))`;
	}

	const query = SELECT.one.from(col.target).columns(columns).where(where);
	return `(${toSQL(query)})`;
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity name
 */
function buildObjectIDExpr(objectIDs, entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = compositeKeyExpr(keys.map((k) => `:${rowRef}.${k}`));

	if (!objectIDs || objectIDs.length === 0) {
		return entityKeyExpr;
	}

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`TO_NVARCHAR(:${rowRef}.${oid.name})`);
		} else {
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `:${rowRef}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query)})), '')`);
		}
	}

	const concatLogic = parts.join(" || ', ' || ");
	return `COALESCE(NULLIF(${concatLogic}, ''), ${entityKeyExpr})`;
}

/**
 * Builds SQL expression for grandparent entity's objectID
 * Used when creating grandparent composition entries for deep linking
 */
function buildGrandParentObjectIDExpr(grandParentObjectIDs, grandParentEntity, parentEntityName, parentKeyBinding, grandParentKeyBinding, rowRef) {
	// Build WHERE clause to find the parent entity record (e.g., OrderItem from OrderItemNote's FK)
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhere = parentKeys.map((pk, i) => `${pk} = :${rowRef}.${parentKeyBinding[i]}`).join(' AND ');

	// Build WHERE clause to find the grandparent entity record from parent
	const grandParentKeys = utils.extractKeys(grandParentEntity.keys);
	const grandParentWhereSubquery = grandParentKeys
		.map((gk, i) => {
			const fkField = grandParentKeyBinding[i];
			return `${gk} = (SELECT ${fkField} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`;
		})
		.join(' AND ');

	const parts = [];
	for (const oid of grandParentObjectIDs) {
		// Since we're using a raw WHERE string, we need to construct this manually
		const selectSQL = `SELECT ${oid.name} FROM ${utils.transformName(grandParentEntity.name)} WHERE ${grandParentWhereSubquery}`;
		parts.push(`COALESCE(TO_NVARCHAR((${selectSQL})), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");
	const grandParentKeyExpr = compositeKeyExpr(grandParentKeyBinding.map((k) => `(SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`));

	return `COALESCE(NULLIF(${concatLogic}, ''), ${grandParentKeyExpr})`;
}

module.exports = {
	setModel,
	getModel,
	toSQL,
	getSkipCheckCondition,
	getElementSkipCondition,
	compositeKeyExpr,
	wrapLargeString,
	getValueExpr,
	getWhereCondition,
	getLabelExpr,
	buildObjectIDExpr,
	buildGrandParentObjectIDExpr
};
