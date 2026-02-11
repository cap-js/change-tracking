const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;

function _getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(session_context('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(session_context('${entitySkipVar}'), 'false') != 'true')`;
}

function _getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(session_context('${varName}'), 'false') != 'true'`;
}

function _toSQLite(query) {
	if (!SQLiteCQN2SQL) {
		const SQLiteService = require('@cap-js/sqlite');
		SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model });
	}
	const sqlCQN = cqn4sql(query, cds.model);
	let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
	return removeSingleQuotes(sql);
}

function removeSingleQuotes(sql) {
	return sql.replace(/'((?:old|new)\.\w+)'/g, '$1');
}


function generateSQLiteTriggers(entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
	const triggers = [];
	const trackedColumns = utils.extractTrackedColumns(entity, cds.model, mergedAnnotations);
	if (trackedColumns.length === 0) return triggers;
	const objectIDs = utils.getObjectIDs(entity, cds.model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, cds.model, rootMergedAnnotations?.entityAnnotation);

	if (!config?.disableCreateTracking) {
		triggers.push(_generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableUpdateTracking) {
		triggers.push(_generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableDeleteTracking) {
		let deleteTrigger = config?.preserveDeletes
			? _generateDeleteTriggerPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs)
			: _generateDeleteTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);
		triggers.push(deleteTrigger);
	}
	return triggers;
}
/**
 * Build scalar subselect for association alternative
 * - concatenates multiple alt columns with ", "
 * - builds WHERE from foreignKeys (managed) or ON (unmanaged) using refRow
 * - returns valid SQLite string "(SELECT ... LIMIT 1)"
 */
function handleAssocLookup(column, refRow, entityKey) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${column.name}_${k}` };
			return acc;
		}, {})
		: column.on?.reduce((acc, k) => {
			acc[k] = { val: entityKey };
			return acc;
		}, {});

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	return `(${_toSQLite(query)})`;
}

function _considerLargeString(val) {
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN SUBSTR(${val}, 1, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns WHERE condition for a column based on modification type
 * - CREATE/DELETE: checks if value is not null
 * - UPDATE: checks if value changed (using IS NOT comparison)
 */
function _getWhereCondition(col, modification) {
	if (modification === 'update') {
		// Check if value changed
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map(fk => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
		} else if (col.target && col.on?.length) {
			return col.on.map(m => `old.${m.foreignKeyField} IS NOT new.${m.foreignKeyField}`).join(' OR ');
		}
		return `old.${col.name} IS NOT new.${col.name}`;
	} else {
		// CREATE or DELETE: check value is not null
		const rowRef = modification === 'create' ? 'new' : 'old';
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map(fk => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
		} else if (col.target && col.on?.length) {
			return col.on.map(m => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
		}
		return `${rowRef}.${col.name} IS NOT NULL`;
	}
}

/**
 * Returns the value expression for a column
 */
function _getValueExpression(col, refRow, entityKey) {
	if (col.target && col.alt) {
		// Association lookup using inline SELECT
		return handleAssocLookup(col, refRow, entityKey);
	} else if (col.type === 'cds.Boolean') {
		return `CASE ${refRow}.${col.name} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
	} else if (col.target && col.foreignKeys?.length) {
		// Concatenate foreign keys for managed associations
		return col.foreignKeys.map(fk => `${refRow}.${col.name}_${fk}`).join(" || '||' || ");
	} else if (col.target && col.on?.length) {
		// Concatenate foreign key fields for unmanaged associations
		return col.on.map(m => `${refRow}.${m.foreignKeyField}`).join(" || '||' || ");
	} else {
		// Scalar value
		let raw = `${refRow}.${col.name}`;
		if (col.type === 'cds.String') {
			raw = _considerLargeString(raw);
		}
		return raw;
	}
}

/**
 * Generates a single UNION member subquery for a column
 */
function _generateColumnSubquery(col, modification, entity, entityKey) {
	const whereCondition = _getWhereCondition(col, modification);
	const oldValExp = _getValueExpression(col, 'old', entityKey);
	const newValExp = _getValueExpression(col, 'new', entityKey);

	const valueFrom = modification === 'create' ? 'NULL' : oldValExp;
	const valueTo = modification === 'delete' ? 'NULL' : newValExp;

	// Add element-level skip condition
	const elementSkipCondition = _getElementSkipCondition(entity.name, col.name);
	const fullWhereCondition = `(${whereCondition}) AND ${elementSkipCondition}`;

	return `SELECT '${col.name}' AS attribute, ${valueFrom} AS valueChangedFrom, ${valueTo} AS valueChangedTo, '${col.type}' AS valueDataType WHERE ${fullWhereCondition}`;
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	// fallback to entity name when no @changelog annotation
	if (objectIDs.length === 0) return `'${entityName}'`;
	for (const objectID of objectIDs) {
		if (objectID.included) continue;
		const where = entityKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${k}` };
			return acc;
		}, {});
		const query = SELECT.one.from(entityName).columns(objectID.name).where(where);
		objectID.selectSQL = _toSQLite(query);
	}

	const objectID = objectIDs.map((id) => (id.included ? `SELECT ${refRow}.${id.name} AS value WHERE ${refRow}.${id.name} IS NOT NULL` : `SELECT (${id.selectSQL}) AS value`)).join('\nUNION ALL\n');

	return `(
    SELECT GROUP_CONCAT(value, ', ')
        FROM (
            ${objectID}
        )
    )`;
}

function _getRootObjectIDSelect(rootObjectIDs, childEntity, rootEntity, refRow) {
	if (rootObjectIDs.length === 0) return `'${rootEntity.name}'`

	const binding = utils.getRootBinding(childEntity, rootEntity)
	if (!binding || binding.length === 0) return null

	// Root keys (plain names on root)
	const rootKeys = utils.extractKeys(rootEntity.keys)
	if (rootKeys.length !== binding.length) {
		return null
	}

	// Build WHERE: rootKey = new.<childFK> (or old.<childFK>)
	const where = {}
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` }
	}

	// Prepare subselects for each root objectID candidate
	for (const oid of rootObjectIDs) {
		const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where)
		oid.selectSQL = _toSQLite(q)
	}

	const unions = rootObjectIDs.map(oid => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n')

	return `(
    SELECT GROUP_CONCAT(value, ', ')
    FROM (
      ${unions}
    )
  )`
}

function _rootKeyFromChild(childEntity, rootEntity, refRow) {
	if (!rootEntity) return null
	const binding = utils.getRootBinding(childEntity, rootEntity)
	if (!binding) return null
	return binding.map(k => `${refRow}.${k}`).join(" || '||' || ")
}

function _generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'create', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'update', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name];
		// use foreignKeys for managed associations and on for unmanaged
		if (c.foreignKeys) return c.foreignKeys.map(k => `${c.name}_${k}`);
		if (c.on) return c.on.map(m => `${c.name}_${m.foreignKeyField}`);
		return [];
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'old');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'old') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'old');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'old') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// First delete existing changelogs for this entity
	const deleteSQL = `DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};`;

	// Then insert delete changelog entries for each tracked column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${deleteSQL}
        ${insertSQL}
    END;`;
}

module.exports = {
	generateSQLiteTriggers
};
