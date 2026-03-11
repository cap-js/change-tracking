const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

let PostgresCQN2SQL;
let model;

function setModel(m) {
	model = m;
	PostgresCQN2SQL = null;
}

function getModel() {
	return model;
}

function toSQL(query) {
	if (!PostgresCQN2SQL) {
		const Service = require('@cap-js/postgres');
		const TriggerCQN2SQL = createTriggerCQN2SQL(Service.CQN2SQL);
		PostgresCQN2SQL = new TriggerCQN2SQL({ model });
	}
	const sqlCQN = cqn4sql(query, model);
	return PostgresCQN2SQL.SELECT(sqlCQN);
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(current_setting('${CT_SKIP_VAR}', true), 'false') != 'true' AND COALESCE(current_setting('${entitySkipVar}', true), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(current_setting('${varName}', true), 'false') != 'true'`;
}

/**
 * Truncates large strings: CASE WHEN LENGTH(val) > 5000 THEN LEFT(val, 4997) || '...' ELSE val END
 */
function wrapLargeString(val) {
	return `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

function compositeKeyExpr(parts) {
	if (parts.length <= 1) return `${parts[0]}::TEXT`;
	return parts.map((p) => `LENGTH(${p}::TEXT) || ',' || ${p}::TEXT`).join(" || ';' || ");
}

/**
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `CASE WHEN ${refRow}.${col.name} IS TRUE THEN 'true' WHEN ${refRow}.${col.name} IS FALSE THEN 'false' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys) {
		if (col.foreignKeys.length > 1) {
			return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}::TEXT`).join(" || ' ' || ");
		}
		return `${refRow}.${col.name}_${col.foreignKeys[0]}::TEXT`;
	}
	if (col.target && col.on) {
		return col.on.map((m) => `${refRow}.${m.foreignKeyField}::TEXT`).join(" || ' ' || ");
	}
	// Apply truncation for String and LargeString types
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') {
		return wrapLargeString(`${refRow}.${col.name}::TEXT`);
	}
	return `${refRow}.${col.name}::TEXT`;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
		return checkCols.map((c) => `NEW.${c} IS DISTINCT FROM OLD.${c}`).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'NEW' : 'OLD';
	if (col.foreignKeys) {
		return col.foreignKeys.map((fk) => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.on) {
		return col.on.map((m) => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${col.name} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale support
 */
function buildAssocLookup(column, refRow) {
	let where = {};
	if (column.foreignKeys) {
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${column.name}_${k}` };
			return acc;
		}, {});
	} else if (column.on) {
		where = column.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'current_setting', args: [{ val: 'cap.locale' }, { val: true }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		return `(SELECT COALESCE((${toSQL(textsQuery)}), (${toSQL(baseQuery)})))`;
	}

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${toSQL(query)})`;
}

/**
 * Returns SQL expression for a column's label (looked-up value for associations)
 */
function getLabelExpr(col, refRow) {
	if (col.target && col.alt) {
		return buildAssocLookup(col, refRow);
	}
	return 'NULL';
}

/**
 * Builds PL/pgSQL statement for objectID assignment
 */
function buildObjectIDAssignment(objectIDs, entity, keys, recVar, targetVar) {
	if (!objectIDs || objectIDs.length === 0) {
		return `${targetVar} := entity_key;`;
	}

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`${recVar}.${oid.name}::TEXT`);
		} else {
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `${recVar}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
		}
	}

	return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := entity_key;
    END IF;
    `;
}

function buildColumnSubquery(col, modification, entity) {
	const whereCondition = getWhereCondition(col, modification);
	const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
	let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

	// For composition-of-one columns, add deduplication check to prevent duplicate entries
	// when child trigger has already created a composition entry for this transaction
	if (col.type === 'cds.Composition') {
		fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM sap_changelog_changes
			WHERE entity = '${entity.name}'
			AND entitykey = entity_key
			AND attribute = '${col.name}'
			AND valuedatatype = 'cds.Composition'
			AND transactionid = transaction_id
		)`;
	}

	const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'OLD');
	const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'NEW');
	const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'OLD');
	const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'NEW');

	return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType WHERE ${fullWhere}`;
}

/**
 * Generates INSERT SQL for changelog entries from UNION query
 */
function buildChangelogInsertSQL(columns, modification, entity, hasCompositionParent = false) {
	const unionQuery = columns.map((col) => buildColumnSubquery(col, modification, entity)).join('\n            UNION ALL\n            ');
	const parentIdValue = hasCompositionParent ? 'comp_parent_id' : 'NULL';

	return `INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                ${parentIdValue},
                attribute,
                valueChangedFrom,
                valueChangedTo,
                valueChangedFromLabel,
                valueChangedToLabel,
                entity_name,
                entity_key,
                object_id,
                now(),
                user_id,
                valueDataType,
                '${modification}',
                transaction_id
            FROM (
            ${unionQuery}
            ) AS changes;`;
}

/**
 * Generates INSERT block for a modification type (with config check)
 */
function buildInsertBlock(columns, modification, entity, hasCompositionParent = false) {
	if (!config || (modification === 'create' && config.disableCreateTracking) || (modification === 'update' && config.disableUpdateTracking) || (modification === 'delete' && config.disableDeleteTracking)) {
		return '';
	}

	if (modification === 'delete' && !config?.preserveDeletes) {
		const keys = utils.extractKeys(entity.keys);
		const entityKey = compositeKeyExpr(keys.map((k) => `OLD.${k}`));
		const deleteSQL = `DELETE FROM sap_changelog_changes WHERE entity = '${entity.name}' AND entitykey = ${entityKey};`;
		return `${deleteSQL}\n            ${buildChangelogInsertSQL(columns, modification, entity, hasCompositionParent)}`;
	}

	return buildChangelogInsertSQL(columns, modification, entity, hasCompositionParent);
}

/**
 * Extracts database column names from tracked columns (for UPDATE OF clause)
 */
function extractTrackedDbColumns(columns) {
	const dbCols = [];
	for (const col of columns) {
		if (col.foreignKeys && col.foreignKeys.length > 0) {
			col.foreignKeys.forEach((fk) => dbCols.push(`${col.name}_${fk}`.toLowerCase()));
		} else if (col.on && col.on.length > 0) {
			col.on.forEach((m) => dbCols.push(m.foreignKeyField.toLowerCase()));
		} else {
			dbCols.push(col.name.toLowerCase());
		}
	}
	return [...new Set(dbCols)];
}

module.exports = {
	setModel,
	getModel,
	toSQL,
	getSkipCheckCondition,
	getElementSkipCondition,
	compositeKeyExpr,
	getValueExpr,
	getWhereCondition,
	getLabelExpr,
	buildObjectIDAssignment,
	buildInsertBlock,
	extractTrackedDbColumns
};
