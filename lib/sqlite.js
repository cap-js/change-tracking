const cds = require('@sap/cds');
const utils = require('./utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;

function _toSQLite(query) {
	if (!SQLiteCQN2SQL) {
		const SQLiteService = require('@cap-js/sqlite');
		SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model });
	}
	const sqlCQN = cqn4sql(query, cds.model);
	let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
	return unquoteOldNew(sql);
}

// REVISIT: currently just a workaround
function unquoteOldNew(sql) {
	const regex = /'((?:old|new)\.\w+)'/g;
	return sql.replace(regex, '$1');
}


function generateTriggers(entity, rootEntity) {
	const triggers = [];
	const trackedColumns = utils.extractTrackedColumns(entity);
	if (trackedColumns.length === 0) return triggers;
	const objectIDs = utils.getObjectIDs(entity);
	const rootObjectIDs = rootEntity ? utils.getObjectIDs(rootEntity) : [];

	if (!config?.disableCreateTracking) {
		triggers.push(_generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableUpdateTracking) {
		triggers.push(_generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
	}

	if (!config?.disableDeleteTracking) {
		let deleteTrigger = config?.preserveDeletes
			? _generateDeleteTriggerPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs)
			: _generateDeleteTriggerCascade(entity);
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

function _buildWhereClauseCondition(col, keys, refRow) {
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}`).join(' AND ') + ' IS NOT NULL';
	} else if (col.target && col.on?.length) {
		return keys.map((k) => `${refRow}.${k} IS NOT NULL`).join(' AND ');
	}
	return `${refRow}.${col.name} IS NOT NULL`;
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	if (objectIDs.length === 0) return null;
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
	if (!rootEntity || rootObjectIDs.length === 0) return null

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

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new')
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;

	const entriesSQL = columns
		.map((col) => {

			// Set new value
			let newVal = `new.${col.name}`;
			if (col.target && col.alt) newVal = handleAssocLookup(col, 'new', entityKey);
			else if (col.target) newVal = col.foreignKeys.map((fk) => `new.${col.name}_${fk}`).join(" || '||' || ");

			// Special handling for Boolean type
			if (col.type === 'cds.Boolean') newVal = `CASE ${newVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;


			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.name}', NULL, ${newVal}, '${entity.name}', ${entityKey}, ${objectID}, '${rootEntity?.name ?? null}', ${rootEntityKey ?? 'NULL'}, ${rootObjectID ?? 'NULL'}, session_context('$now'), session_context('$user.id'), '${col.type}', 'create'
        WHERE ${_buildWhereClauseCondition(col, keys, 'new')};`;
		})
		.join('\n');

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new')
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;

	const entriesSQL = columns
		.map((col) => {
			// Set old and new value
			let oldVal = `old.${col.name}`;
			let newVal = `new.${col.name}`;
			if (col.target && col.alt) {
				oldVal = handleAssocLookup(col, 'old', entityKey);
				newVal = handleAssocLookup(col, 'new', entityKey);
			} else if (col.target) {
				oldVal = col.foreignKeys.map((fk) => `old.${col.name}_${fk}`).join(" || '||' || ");
				newVal = col.foreignKeys.map((fk) => `new.${col.name}_${fk}`).join(" || '||' || ");
			}

			// Special handling for Boolean type
			if (col.type === 'cds.Boolean') {
				oldVal = `CASE ${oldVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
				newVal = `CASE ${newVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
			}

			// where clause
			let whereCondition = '';
			if (col.target && col.foreignKeys?.length) {
				whereCondition = col.foreignKeys.map((fk) => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
			} else {
				whereCondition = `old.${col.name} IS NOT new.${col.name}`;
			}

			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.name}', ${oldVal}, ${newVal}, '${entity.name}', ${entityKey}, ${objectID}, '${rootEntity?.name ?? null}', ${rootEntityKey ?? 'NULL'}, ${rootObjectID ?? 'NULL'}, session_context('$now'), session_context('$user.id'), '${col.type}', 'update'
        WHERE ${whereCondition};`;
		})
		.join('\n');

	// OF columns clause
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name]
		// use foreignKeys for managed associations and on for unmanaged
		const fks = c.foreignKeys ?? c.on ?? []
		return fks.map(k => `${c.name}_${k}`)
	})
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'old')
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'old') ?? rootEntityKey
		: null;

	const entriesSQL = columns
		.map((col) => {
			// Set old value
			let oldVal = `old.${col.name}`;
			if (col.target && col.alt) {
				oldVal = handleAssocLookup(col, 'old', entityKey);
			} else if (col.target) {
				oldVal = col.foreignKeys.map((fk) => `old.${col.name}_${fk}`).join(" || '||' || ");
			}

			// Special handling for Boolean type
			if (col.type === 'cds.Boolean') {
				oldVal = `CASE ${oldVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
			}

			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.name}', ${oldVal}, NULL, '${entity.name}', ${entityKey}, ${objectID}, '${rootEntity?.name ?? null}', ${rootEntityKey ?? 'NULL'}, ${rootObjectID ?? 'NULL'}, session_context('$now'), session_context('$user.id'), '${col.type}', 'delete'
        WHERE ${_buildWhereClauseCondition(col, keys, 'old')};`;
		})
		.join('\n');

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

// Revisit: currently all DELETE tracking is CASCADE and this mean no tracking is created at all
function _generateDeleteTriggerCascade(entity) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    BEGIN
        DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
    END;`;
}

module.exports = {
	generateTriggers
};
