const cds = require('@sap/cds');
const utils = require('./utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

const insertChangesSQL = `INSERT INTO SAP_CHANGELOG_CHANGES (
  ID,
  attribute,
  valueChangedFrom,
  valueChangedTo,
  entity,
  entityKey,
  rootEntity,
  rootEntityKey,
  objectID,
  rootObjectID,
  modification,
  valueDataType,
  createdAt,
  createdBy,
  transactionID
) VALUES (
  SYSUUID,
  {{attribute}},
  {{valueChangedFrom}},
  {{valueChangedTo}},
  :entity,
  :entityKey,
  :rootEntity,
  :rootEntityKey,
  :objectID,
  :rootObjectID,
  {{modification}},
  'cds.String',
  CURRENT_TIMESTAMP,
  SESSION_CONTEXT('APPLICATIONUSER'),
  :transactionID
);`;

function _toHanaSQL(query) {
	const sqlCQN = cqn4sql(query, model);
	let hanaSQL = HANACQN2SQL.SELECT(sqlCQN);
	return removeSingleQuotes(hanaSQL) + ';';
}

// REVISIT: currently just a workaround
function removeSingleQuotes(sql) {
	const regex = /'(:(?:old|new)\.\w+)'/g;
	return sql.replace(regex, '$1');
}

function addInsertTo(sql, name, ref) {
	return sql.replace(/\bSELECT\s+(.*?)\s+FROM\b/i, `SELECT $1 into v_${ref}_${name} FROM`);
}

function generateTriggersForEntity(csn, entity) {
	model = csn;
	const triggers = [];
	const trackedColumns = utils.extractTrackedColumns(entity, csn);
	const objectIDs = utils.getObjectIDs(entity, model);

	if (!config?.disableCreateTracking) {
		triggers.push(_generateCreateTrigger(entity, trackedColumns, objectIDs));
	}

	if (!config?.disableUpdateTracking) {
		triggers.push(_generateUpdateTrigger(entity, trackedColumns, objectIDs));
	}

	if (!config?.disableDeleteTracking) {
		if (config?.preserveDeletes) {
			triggers.push(_generateDeleteTriggerPreserve(entity, trackedColumns, objectIDs));
		} else {
			triggers.push(_generateDeleteTriggerCascade(entity, keys));
		}
	}
	return triggers;
}

const _convertDatetimeTypes = (val, type) => {
	const datetimeDataTypes = ['cds.Date', 'cds.DateTime', 'cds.Time', 'cds.Timestamp'];
	if (!datetimeDataTypes.includes(type)) return val;
	return `TO_NVARCHAR(${val})`;
};

const getInsertChangesSQL = (attribute, oldVal, newVal, modification) => {
	return insertChangesSQL.replace('{{attribute}}', `'${attribute}'`).replace('{{valueChangedFrom}}', oldVal).replace('{{valueChangedTo}}', newVal).replace('{{modification}}', `'${modification}'`);
};

function _generateTriggerDeclaration(entity, rowRef, objectID, rootEntity = null, rootObjectID = null) {
	// Entity Keys
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
	const rootKeys = utils.extractKeys(rootEntity?.keys);
	const rootEntityKeys = rootKeys?.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ") || 'NULL';

	// Object IDs
	const objectIDDeclaration = _getObjectIDDeclaration(objectID);

	return `
      -- Trigger Declaration List
      DECLARE entity           CONSTANT NVARCHAR(5000) := '${entity.name}';
      DECLARE entityKey        CONSTANT NVARCHAR(5000) := ${entityKey};
      DECLARE rootEntity       CONSTANT NVARCHAR(5000) := ${rootEntity || 'NULL'};
      DECLARE rootEntityKey    CONSTANT NVARCHAR(5000) := ${rootEntityKeys};
      DECLARE transactionID    CONSTANT BIGINT         := CURRENT_UPDATE_TRANSACTION();
      DECLARE objectID         NVARCHAR(5000);
      DECLARE rootObjectID     NVARCHAR(5000);
      ${objectIDDeclaration}
  `.trim();
}

function considerLargeString(val) {
	// CASE WHEN LENGTH(:val) > 5000 THEN LEFT(:val, 4997) || '...' ELSE :val END
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

function _nullSafeChanged(column, oldRef = 'old', newRef = 'new') {
	const o = `:${oldRef}.${column}`;
	const n = `:${newRef}.${column}`;
	// (o <> n OR o IS NULL OR n IS NULL) AND NOT (o IS NULL AND n IS NULL)
	return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

function handleAssociationLookUp(column, refRow) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${column.name}_${k}` };
			return acc;
		}, {})
		: column.on?.reduce((acc, k) => {
			acc[k] = { val: `:entityKey` };
			return acc;
		}, {})

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map(s => s.split('.').slice(1).join('.'));

	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);
	const query = SELECT.one.from(column.target).columns(columns).where(where);
	let hanaSQL = _toHanaSQL(query);
	return addInsertTo(hanaSQL, column.name, refRow);
}

function _getObjectIDDeclaration(objectIDs) {
	const declarations = objectIDs.map((oi) => (oi.included ? null : `DECLARE v_objectID_${oi.name.replaceAll('.', '_')} NVARCHAR(5000);`));
	return declarations.join('\n');
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	if (objectIDs.length === 0) return '';
	const selects = objectIDs
		.map((oi) => {
			if (oi.included) return null;
			const where = entityKeys.reduce((acc, k) => {
				acc[k] = { val: `:${refRow}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entityName).columns(oi.name).where(where);

			let hanaSQL = _toHanaSQL(query);
			hanaSQL = addInsertTo(hanaSQL, oi.name.replaceAll('.', '_'), 'objectID');
			return hanaSQL;
		})
		.join('\n');

	const objectID = objectIDs.map((id) => (id.included ? `COALESCE(:${refRow}.${id.name},'')` : `COALESCE(:v_objectID_${id.name.replaceAll('.', '_')},'')`)).join(' || ', '');
	return `${selects}
  objectID := ${objectID || ':entityKey'};
  rootObjectID := :rootEntityKey;`;
}

function _generateCreateTrigger(entity, columns, objectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new');
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'new', objectIDs);

	const entriesSQL = columns
		.map((c) => {
			// set new value
			let newVal = `:new.${c.name}`;
			let assocLookUp = '';
			if (c.target && c.alt) {
				assocLookUp = handleAssociationLookUp(c, 'new');
				newVal = `:v_new_${c.name}`;
			} else if (c.target) {
				newVal = c.foreignKeys.map((fk) => `:new.${c.name}_${fk}`).join(" || '||' || ");
			}

			// prepare new value
			newVal = _convertDatetimeTypes(newVal, c.type);
			if (c.type === 'cds.Boolean') {
				newVal = `CASE WHEN ${newVal} IS NULL THEN 'NULL' WHEN ${newVal} = true THEN 'true' ELSE 'false' END`;
			}
			if (c.type === 'cds.String') newVal = considerLargeString(newVal);

			const insertStatement = getInsertChangesSQL(c.name, 'NULL', newVal, 'create');

			return assocLookUp + '\n' + insertStatement;
		})
		.join('\n');

	return {
		name: entity.name + '_CT_CREATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_CREATE AFTER INSERT
    ON ${utils.transformName(entity.name)}
    REFERENCING NEW ROW new
      BEGIN
      ${triggerDeclaration}
      ${columns.map(c => (c.target && c.alt ? `DECLARE v_new_${c.name} NVARCHAR(5000);` : '')).join('\n')}
      ${objectID}

      ${entriesSQL}
      END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateUpdateTrigger(entity, columns, objectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old');
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'old', objectIDs);

	const entriesSQL = columns
		.map((c) => {
			// Set old and new values
			let oldVal = `:old.${c.name}`;
			let newVal = `:new.${c.name}`;
			let assocLookUp = '';
			let condition = _nullSafeChanged(c.name);
			if (c.target && c.alt) {
				// REVISIT: name clash possible? v_new_<target>_<column>
				assocLookUp = `DECLARE v_new_${c.name} NVARCHAR(5000); DECLARE v_old_${c.name} NVARCHAR(5000);
				${handleAssociationLookUp(c, 'new')}
				${handleAssociationLookUp(c, 'old')}`
				oldVal = `:v_old_${c.name}`;
				newVal = `:v_new_${c.name}`;
				condition = c.foreignKeys.map((k) => _nullSafeChanged(`${c.name}_${k}`)).join(' OR ');
			} else if (c.target) {
				oldVal = c.foreignKeys.map(fk => `:old.${c.name}_${fk}`).join(" || '||' || ");
				newVal = col.foreignKeys.map(fk => `:new.${c.name}_${fk}`).join(" || '||' || ");
				condition = c.foreignKeys.map((k) => _nullSafeChanged(`${c.name}_${k}`)).join(' OR ');
			}

			// prepare old and new values
			oldVal = _convertDatetimeTypes(oldVal, c.type);
			newVal = _convertDatetimeTypes(newVal, c.type);
			if (c.type === 'cds.Boolean') {
				oldVal = `CASE WHEN ${oldVal} IS NULL THEN 'NULL' WHEN ${oldVal} = true THEN 'true' ELSE 'false' END`;
				newVal = `CASE WHEN ${newVal} IS NULL THEN 'NULL' WHEN ${newVal} = true THEN 'true' ELSE 'false' END`;
			}
			if (c.type === 'cds.String') {
				oldVal = considerLargeString(oldVal);
				newVal = considerLargeString(newVal);
			}

			const insertStatement = getInsertChangesSQL(c.name, oldVal, newVal, 'update');

			return `IF ${condition} THEN
    ${assocLookUp}
    ${insertStatement}
    END IF;`;
		})
		.join('\n');

	// Build OF clause
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name]
		// use foreignKeys for managed associations and on for unmanaged
		const fks = c.foreignKeys ?? c.on ?? []
		return fks.map(k => `${c.name}_${k}`)
	})
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return {
		name: entity.name + '_CT_UPDATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_UPDATE AFTER UPDATE ${ofClause}
      ON ${utils.transformName(entity.name)}
      REFERENCING NEW ROW new, OLD ROW old
      BEGIN
        ${triggerDeclaration}
        ${objectID}

        ${entriesSQL}
      END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old');
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'old', objectIDs);

	const entriesSQL = columns
		.map((c) => {
			// set old value
			let oldVal = `:old.${c.name}`;
			let assocLookUp = '';
			if (c.target && c.alt) {
				assocLookUp = handleAssociationLookUp(c, 'old');
				oldVal = `:v_old_${c.name}`;
			} else if (c.target) {
				oldVal = c.foreignKeys.map((fk) => `:old.${c.name}_${fk}`).join(" || '||' || ");
			}

			// prepare old value
			oldVal = _convertDatetimeTypes(oldVal, c.type);
			if (c.type === 'cds.Boolean') {
				oldVal = `CASE WHEN ${oldVal} IS NULL THEN 'NULL' WHEN ${oldVal} = true THEN 'true' ELSE 'false' END`;
			}
			if (c.type === 'cds.String') oldVal = considerLargeString(oldVal);

			const insertStatement = getInsertChangesSQL(c.name, oldVal, 'NULL', 'delete');

			return assocLookUp + '\n' + insertStatement;
		})
		.join('\n');

	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
    ON ${utils.transformName(entity.name)}
    REFERENCING OLD ROW old
      BEGIN
        ${triggerDeclaration}
        ${columns.map((c) => (c.target && c.alt ? `DECLARE v_old_${c.name} NVARCHAR(5000);` : '')).join('\n')}
        ${objectID}

        ${entriesSQL}
      END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTriggerCascade(entity, keys) {
	const entityKey = keys.map((k) => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
    ON ${utils.transformName(entity.name)}
    REFERENCING OLD ROW old
      BEGIN
        DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
      END;`,
		suffix: '.hdbtrigger'
	};
}

module.exports = {
	generateTriggersForEntity
};