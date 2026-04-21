const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

const _cqn2sqlCache = new WeakMap();
let _quoter;

function toSQL(query, model) {
	const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
	let cqn2sql = _cqn2sqlCache.get(model);
	if (!cqn2sql) {
		const Service = require('@cap-js/postgres');
		const TriggerCQN2SQL = createTriggerCQN2SQL(Service.CQN2SQL);
		cqn2sql = new TriggerCQN2SQL({ model });
		_cqn2sqlCache.set(model, cqn2sql);
	}
	const sqlCQN = cqn4sql(query, model);
	return cqn2sql.SELECT(sqlCQN);
}

/**
 * Quotes a Postgres SQL identifier if it is a reserved keyword.
 * Uses the Postgres CQN2SQL adapter's built-in quoting logic.
 */
function quote(name) {
	if (!_quoter) _quoter = new (require('@cap-js/postgres').CQN2SQL)();
	return _quoter.quote(name);
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

function entityKeyExpr(parts) {
	if (parts.length <= 1) return `${parts[0]}::TEXT`;
	return parts.map((p) => `LENGTH(${p}::TEXT) || ',' || ${p}::TEXT`).join(" || ';' || ");
}

/**
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `CASE WHEN ${refRow}.${quote(col.name)} IS TRUE THEN 'true' WHEN ${refRow}.${quote(col.name)} IS FALSE THEN 'false' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys) {
		if (col.foreignKeys.length > 1) {
			return col.foreignKeys.map((fk) => `${refRow}.${quote(`${col.name}_${fk}`)}::TEXT`).join(" || ' ' || ");
		}
		return `${refRow}.${quote(`${col.name}_${col.foreignKeys[0]}`)}::TEXT`;
	}
	if (col.target && col.on) {
		return col.on.map((m) => `${refRow}.${quote(m.foreignKeyField)}::TEXT`).join(" || ' ' || ");
	}
	// Apply truncation for String and LargeString types
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') {
		return wrapLargeString(`${refRow}.${quote(col.name)}::TEXT`);
	}
	return `${refRow}.${quote(col.name)}::TEXT`;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
		return checkCols.map((c) => `NEW.${quote(c)} IS DISTINCT FROM OLD.${quote(c)}`).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'NEW' : 'OLD';
	if (col.foreignKeys) {
		return col.foreignKeys.map((fk) => `${rowRef}.${quote(`${col.name}_${fk}`)} IS NOT NULL`).join(' OR ');
	}
	if (col.on) {
		return col.on.map((m) => `${rowRef}.${quote(m.foreignKeyField)} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${quote(col.name)} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale support.
 * @param {Object} column Column entry with target, foreignKeys/on, etc.
 * @param {string[]} assocPaths Array of association paths (format: "assocName.field")
 * @param {string} refRow Trigger row reference ('NEW' or 'OLD')
 * @param {*} model CSN model
 */
function buildAssocLookup(column, assocPaths, refRow, model) {
	let where = {};
	if (column.foreignKeys) {
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${quote(`${column.name}_${k}`)}`, literal: 'sql' };
			return acc;
		}, {});
	} else if (column.on) {
		where = column.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `${refRow}.${quote(mapping.foreignKeyField)}`, literal: 'sql' };
			return acc;
		}, {});
	}

	const alt = assocPaths.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, assocPaths, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'current_setting', args: [{ val: 'cap.locale' }, { val: true }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		return `(SELECT COALESCE((${toSQL(textsQuery, model)}), (${toSQL(baseQuery, model)})))`;
	}

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${toSQL(query, model)})`;
}

const { buildExpressionSQL } = require('../utils/expression-sql.js');

/**
 * Returns SQL expression for a column's label (looked-up value for associations).
 */
function getLabelExpr(col, refRow, model, entityName = null) {
	// Expression-based labels: translate CDS expression to SQL with trigger row refs
	if (col.altExpression && entityName) {
		const PostgresService = require('@cap-js/postgres');
		const CQN2SQLClass = PostgresService?.CQN2SQL ?? require('@cap-js/db-service/lib/cqn2sql');
		// Cast to TEXT to ensure UNION compatibility — expression results may be numeric/date/etc.
		return `(${buildExpressionSQL(col.altExpression, entityName, refRow, model, CQN2SQLClass, toSQL, (r, c) => `${r}.${quote(c)}`)})::TEXT`;
	}

	if (!col.alt || col.alt.length === 0) return 'NULL';

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
			parts.push(`${refRow}.${quote(entry.path)}::TEXT`);
		}
	}
	flushAssocBatch();

	return parts.length === 0 ? 'NULL' : parts.join(" || ', ' || ");
}

/**
 * Builds PL/pgSQL statement for objectID assignment
 */
function buildObjectIDAssignment(objectIDs, entity, keys, recVar, targetVar, model) {
	if (!objectIDs || objectIDs.length === 0) {
		return `${targetVar} := entity_key;`;
	}

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`COALESCE(${recVar}.${quote(oid.name)}::TEXT, '<empty>')`);
		} else if (oid.expression) {
			// Expression-based ObjectID: inline expression using trigger row refs
			// Leave NULL as-is so CONCAT_WS skips unresolved expressions
			const PostgresService = require('@cap-js/postgres');
			const CQN2SQLClass = PostgresService?.CQN2SQL ?? require('@cap-js/db-service/lib/cqn2sql');
			const sql = buildExpressionSQL(oid.expression, entity.name, recVar, model, CQN2SQLClass, toSQL, (r, c) => `${r}.${quote(c)}`);
			parts.push(`(${sql})::TEXT`);
		} else {
			// Leave NULL as-is so CONCAT_WS skips unresolved association paths
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `${recVar}.${quote(k)}`, literal: 'sql' };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			parts.push(`(${toSQL(query, model)})::TEXT`);
		}
	}

	return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := entity_key;
    END IF;
    `;
}

function buildColumnSubquery(col, modification, entity, model) {
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
	const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'OLD', model, entity.name);
	const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'NEW', model, entity.name);

	const dataType = col.altExpression ? 'cds.String' : col.type;

	return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${dataType}' AS valueDataType WHERE ${fullWhere}`;
}

/**
 * Generates INSERT SQL for changelog entries from UNION query
 */
function buildChangelogInsertSQL(columns, modification, entity, model, hasCompositionParent = false) {
	const unionQuery = columns.map((col) => buildColumnSubquery(col, modification, entity, model)).join('\n            UNION ALL\n            ');
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
function buildInsertBlock(columns, modification, entity, model, hasCompositionParent = false) {
	if (!config || (modification === 'create' && config.disableCreateTracking) || (modification === 'update' && config.disableUpdateTracking) || (modification === 'delete' && config.disableDeleteTracking)) {
		return '';
	}

	if (modification === 'delete' && !config?.preserveDeletes) {
		const keys = utils.extractKeys(entity.keys);
		const entityKey = entityKeyExpr(keys.map((k) => `OLD.${quote(k)}`));
		const deleteSQL = `DELETE FROM sap_changelog_changes WHERE entity = '${entity.name}' AND entitykey = ${entityKey};`;
		return `${deleteSQL}\n            ${buildChangelogInsertSQL(columns, modification, entity, model, hasCompositionParent)}`;
	}

	return buildChangelogInsertSQL(columns, modification, entity, model, hasCompositionParent);
}

/**
 * Extracts database column names from tracked columns (for UPDATE OF clause)
 */
function extractTrackedDbColumns(columns) {
	const dbCols = [];
	for (const col of columns) {
		if (col.foreignKeys && col.foreignKeys.length > 0) {
			col.foreignKeys.forEach((fk) => dbCols.push(quote(`${col.name}_${fk}`.toLowerCase())));
		} else if (col.on && col.on.length > 0) {
			col.on.forEach((m) => dbCols.push(quote(m.foreignKeyField.toLowerCase())));
		} else {
			dbCols.push(quote(col.name.toLowerCase()));
		}
	}
	return [...new Set(dbCols)];
}

module.exports = {
	toSQL,
	quote,
	getSkipCheckCondition,
	getElementSkipCondition,
	entityKeyExpr,
	getValueExpr,
	getWhereCondition,
	getLabelExpr,
	buildObjectIDAssignment,
	buildInsertBlock,
	extractTrackedDbColumns
};
