const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

function _getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(
		(SESSION_CONTEXT('${CT_SKIP_VAR}') IS NULL OR SESSION_CONTEXT('${CT_SKIP_VAR}') != 'true')
		AND
		(SESSION_CONTEXT('${entitySkipVar}') IS NULL OR SESSION_CONTEXT('${entitySkipVar}') != 'true')
	)`;
}

function _getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `(SESSION_CONTEXT('${varName}') IS NULL OR SESSION_CONTEXT('${varName}') != 'true')`;
}

function _toHanaSQL(query) {
	const sqlCQN = cqn4sql(query, model);
	let sql = HANACQN2SQL.SELECT(sqlCQN);
	return removeSingleQuotes(sql);
}

function removeSingleQuotes(sql) {
	// Matches ':new.column' or ':old.column' and removes the single quotes
	return sql.replace(/'(:(?:old|new)\.\w+)'/g, '$1');
}

function generateHANATriggers(csn, entity, rootEntity = null) {
	model = csn;
	const triggers = [];
	const trackedColumns = utils.extractTrackedColumns(entity, csn);
	if (trackedColumns.length === 0) return triggers;

	const objectIDs = utils.getObjectIDs(entity, model);
	const rootObjectIDs = rootEntity ? utils.getObjectIDs(rootEntity, model) : [];

	const keys = utils.extractKeys(entity.keys);
	if (keys.length === 0) return triggers;

	if (!config?.disableCreateTracking) {
		triggers.push(_generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableUpdateTracking) {
		triggers.push(_generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableDeleteTracking) {
		if (config?.preserveDeletes) {
			triggers.push(_generateDeleteTriggerPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		} else {
			triggers.push(_generateDeleteTrigger(entity));
		}
	}
	return triggers;
}

/**
 * Returns inline expression for entity key
 * e.g., "TO_NVARCHAR(:new.ID)" or "TO_NVARCHAR(:new.ID) || '||' || TO_NVARCHAR(:new.version)"
 */
function _getEntityKeyExpression(entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	return keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
}

function _getRootEntityKeyExpression(entity, rootEntity, rowRef) {
	if (!rootEntity) return 'NULL';
	const binding = utils.getRootBinding(entity, rootEntity);
	if (binding && binding.length > 0) {
		return binding.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
	}
	return 'NULL';
}


function _getObjectIDExpression(objectIDs, entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	if (!objectIDs || objectIDs.length === 0) {
		return entityKeyExpr;
	}

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`TO_NVARCHAR(:${rowRef}.${oid.name})`);
		} else {
			// Sub-Select for computed fields
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `:${rowRef}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			let sql = `(${_toHanaSQL(query)})`;
			parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
		}
	}
	const concatLogic = parts.join(" || ', ' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${entityKeyExpr})`;
}

function _getRootObjectIDExpression(rootObjectIDs, childEntity, rootEntity, rowRef) {
	if (!rootEntity) return 'NULL';

	const rootEntityKeyExpr = _getRootEntityKeyExpression(childEntity, rootEntity, rowRef);

	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		return rootEntityKeyExpr;
	}

	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);

	const where = {};
	rootKeys.forEach((rk, index) => {
		const fk = binding[index];
		where[rk] = { val: `:${rowRef}.${fk}` };
	});

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		let sql = `(${_toHanaSQL(query)})`;
		parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

/**
 * Returns where condition for a column based on modification type
 * - CREATE/DELETE: checks if value is not null
 * - UPDATE: checks if value changed (using null-safe != operator)
 */
function _getWhereCondition(col, modification) {
	if (modification === 'update') {
		// Check if value changed using null-safe != operator
		const checkCols = col.foreignKeys
			? col.foreignKeys.map(fk => `${col.name}_${fk}`)
			: col.on
				? col.on.map(m => m.foreignKeyField)
				: [col.name];
		return checkCols.map(k => _nullSafeChanged(k)).join(' OR ');
	} else {
		// CREATE or DELETE: check value is not null
		const rowRef = modification === 'create' ? 'new' : 'old';
		if (col.target && col.foreignKeys) {
			return col.foreignKeys.map(fk => `:${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
		} else if (col.target && col.on) {
			return col.on.map(m => `:${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
		} else {
			return `:${rowRef}.${col.name} IS NOT NULL`;
		}
	}
}

function _nullSafeChanged(column, oldRef = 'old', newRef = 'new') {
	const o = `:${oldRef}.${column}`;
	const n = `:${newRef}.${column}`;
	// (o <> n OR o IS NULL OR n IS NULL) AND NOT (o IS NULL AND n IS NULL)
	return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

/**
 * Generates a single UNION member subquery for a column
 */
function _generateColumnSubquery(col, modification, entity) {
	const whereCondition = _getWhereCondition(col, modification);
	const oldValExp = _getValueExpression(col, 'old');
	const newValExp = _getValueExpression(col, 'new');

	// Build FROM clause using entity table instead of DUMMY
	const tableName = utils.transformName(entity.name);
	const keys = utils.extractKeys(entity.keys);
	const rowRef = modification === 'create' ? 'new' : 'old';
	const keyCondition = keys.map(k => `${k} = :${rowRef}.${k}`).join(' AND ');
	const fromDummy = `FROM (SELECT 1 FROM ${tableName} WHERE ${keyCondition}) AS d`;

	// Add element-level skip condition
	const elementSkipCondition = _getElementSkipCondition(entity.name, col.name);
	const fullWhereCondition = `(${whereCondition}) AND ${elementSkipCondition}`;

	return `SELECT '${col.name}' AS attribute, ${modification === 'create' ? 'NULL' : oldValExp} AS valueChangedFrom, ${modification === 'delete' ? 'NULL' : newValExp} AS valueChangedTo, '${col.type}' AS valueDataType ${fromDummy} WHERE ${fullWhereCondition}`;
}

/**
 * Returns the value expression for a column
 */
function _getValueExpression(col, refRow) {
	if (col.target && col.alt) {
		// Association lookup using inline SELECT
		return _getAssociationLookupExpression(col, refRow);
	} else if (col.type === 'cds.Boolean') {
		return `:${refRow}.${col.name}`;
	} else if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.foreignKeys) {
		// Concatenate keys
		return col.foreignKeys.map(fk => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	} else if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.on) {
		return col.on.map(mapping => `TO_NVARCHAR(:${refRow}.${mapping.foreignKeyField})`).join(" || ' ' || ");
	} else {
		// Scalar
		let raw = `:${refRow}.${col.name}`;
		if (['cds.Date', 'cds.DateTime', 'cds.Timestamp', 'cds.Time'].includes(col.type)) {
			raw = `TO_NVARCHAR(${raw})`;
		} else if (col.type === 'cds.String') {
			raw = _considerLargeString(raw);
		}
		return raw;
	}
}

/**
 * Returns inline SELECT expression for association lookup
 */
function _getAssociationLookupExpression(column, refRow) {
	let where = {};
	if (column.foreignKeys) {
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${column.name}_${k}` };
			return acc;
		}, {});
	} else if (column.on) {
		where = column.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `:${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${_toHanaSQL(query)})`;
}

// Revisit: check if Left is supported for all db adapters
function _considerLargeString(val) {
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

function _generateCreateTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const entityKeyExpr = _getEntityKeyExpression(entity, 'new');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'new');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'new');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'new');
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'create', entity));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const body = `IF ${_getSkipCheckCondition(entity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKeyExpr},
			${objectIDExpr},
			${rootEntityValue},
			${rootEntityKeyExpr},
			${rootObjectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'create',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);
	END IF;`;

	return {
		name: entity.name + '_CT_CREATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_CREATE AFTER INSERT 
ON ${utils.transformName(entity.name)}
REFERENCING NEW ROW new
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateUpdateTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const entityKeyExpr = _getEntityKeyExpression(entity, 'old');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'old');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'old');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'old');
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'update', entity));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	// Build OF clause
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) {
			return c.foreignKeys.map(k => `${c.name}_${k.replaceAll(/\./g, '_')}`);
		} else if (c.on) {
			return c.on.map(m => m.foreignKeyField);
		}
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	const body = `IF ${_getSkipCheckCondition(entity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKeyExpr},
			${objectIDExpr},
			${rootEntityValue},
			${rootEntityKeyExpr},
			${rootObjectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'update',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);
	END IF;`;

	return {
		name: entity.name + '_CT_UPDATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_UPDATE AFTER UPDATE ${ofClause}
ON ${utils.transformName(entity.name)}
REFERENCING NEW ROW new, OLD ROW old
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const entityKeyExpr = _getEntityKeyExpression(entity, 'old');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'old');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'old');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'old');
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const body = `IF ${_getSkipCheckCondition(entity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKeyExpr},
			${objectIDExpr},
			${rootEntityValue},
			${rootEntityKeyExpr},
			${rootObjectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'delete',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);
	END IF;`;

	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
ON ${utils.transformName(entity.name)}
REFERENCING OLD ROW old
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTrigger(entity) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map((k) => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
ON ${utils.transformName(entity.name)}
REFERENCING OLD ROW old
BEGIN
	IF ${_getSkipCheckCondition(entity.name)} THEN
		DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
	END IF;
END;`,
		suffix: '.hdbtrigger'
	};
}

module.exports = {
	generateHANATriggers
};