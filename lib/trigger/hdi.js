const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

function _toHanaSQL(query) {
	const sqlCQN = cqn4sql(query, model);
	let sql = HANACQN2SQL.SELECT(sqlCQN);
	return removeSingleQuotes(sql);
}

function removeSingleQuotes(sql) {
	// Matches ':new.column' or ':old.column' and removes the single quotes
	return sql.replace(/'(:(?:old|new)\.\w+)'/g, '$1');
}

function addInsertTo(sql, name, ref) {
	if (!Array.isArray(name)) name = [name];
	const intoVars = name.map(n => `v_assoc_${n}_${ref}`).join(', ');
	// Replace SELECT ... FROM part with SELECT ... INTO {{intoVars}} FROM
	return sql.replace(/\bSELECT\s+(.*?)\s+FROM\b/i, `SELECT $1 into ${intoVars} FROM`);
}

function generateHANATriggers(csn, entity, rootEntity = null) {
	model = csn;
	const triggers = [];
	const trackedColumns = utils.extractTrackedColumns(entity, csn);
	if (trackedColumns.length === 0) return triggers;

	const objectIDs = utils.getObjectIDs(entity, model);
	const rootObjectIDs = rootEntity ? utils.getObjectIDs(rootEntity, model) : [];

	// Revisit
	const keys = utils.extractKeys(entity.keys)
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
			triggers.push(_generateDeleteTriggerCascade(entity));
		}
	}
	return triggers;
}

function _generateTriggerDeclaration(entity, rowRef, objectIDs, rootEntity = null, rootObjectIDs = null) {
	// Entity Keys
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	// Root Entity Keys
	let rootEntityKeyExp = 'NULL';
	if (rootEntity) {
		const binding = utils.getRootBinding(entity, rootEntity);
		if (binding && binding.foreignKeys) {
			rootEntityKeyExp = binding.foreignKeys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
		}
	}

	// Object IDs
	const objectIDDeclaration = _generateObjectIDLogic(objectIDs, entity, keys, rowRef);
	const rootObjectIDLogic = rootEntity
		? _generateRootObjectIDLogic(rootObjectIDs, entity, rootEntity, rowRef)
		: `rootObjectID = ${rootEntityKeyExp};`;

	const result = [];
	result.push('-- Trigger Declaration List');
	result.push(`DECLARE entity           CONSTANT NVARCHAR(5000) = '${entity.name}';`);
	result.push(`DECLARE entityKey        CONSTANT NVARCHAR(5000) = ${entityKey};`);
	result.push(`DECLARE rootEntity       CONSTANT NVARCHAR(5000) = ${rootEntity ? `'${rootEntity.name}'` : 'NULL'};`);
	result.push(`DECLARE rootEntityKey    CONSTANT NVARCHAR(5000) = ${rootEntityKeyExp};`);
	result.push(`DECLARE objectID         NVARCHAR(5000);`);
	result.push(`DECLARE rootObjectID     NVARCHAR(5000);`);
	result.push('');
	result.push('-- Object ID Calculation');
	result.push(objectIDDeclaration);
	result.push(rootObjectIDLogic);
	return result;
}

function _generateColumnDeclaration(columns, ref) {
	// Only associations with 'alt' need temporary variables
	return columns
		.filter(c => c.target && c.alt)
		.map(c => `DECLARE v_assoc_${c.name.replace(/\./g, '_')}_${ref} NVARCHAR(5000);`);
}

function _generateCreateTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'new', objectIDs, rootEntity, rootObjectIDs);
	const colVars = _generateColumnDeclaration(columns, 'new');
	if (colVars.length) {
		triggerDeclaration.splice(triggerDeclaration.length - 3, 0, ...colVars, '');
	}

	const body = columns.map((col) => {
		// set new value
		const { condition, valExp, assignment } = _prepareValue(col, 'new');

		// Insert Satement
		return `${assignment}
			IF (${condition}) THEN
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(SYSUUID, '${col.name}', NULL, ${valExp}, :entity, :entityKey, :objectID, :rootEntity, :rootEntityKey, :rootObjectID, CURRENT_TIMESTAMP, SESSION_CONTEXT('APPLICATIONUSER'), '${col.type}', 'create', CURRENT_UPDATE_TRANSACTION());
			END IF;`;
	}).join('\n');

	return {
		name: entity.name + '_CT_CREATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_CREATE AFTER INSERT 
		ON ${utils.transformName(entity.name)}
		REFERENCING NEW ROW new
      	BEGIN
			${triggerDeclaration.join('\n')}
			${body}
		END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateUpdateTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'old', objectIDs, rootEntity, rootObjectIDs);
	const colVarsOld = _generateColumnDeclaration(columns, 'old');
	const colVarsNew = _generateColumnDeclaration(columns, 'new');
	const inject = [...colVarsOld, ...colVarsNew];
	if (inject.length > 0) {
		triggerDeclaration.splice(triggerDeclaration.length - 3, 0, ...inject, '');
	}


	const body = columns.map((col) => {
		// Prepare old and new values
		const newVal = _prepareValue(col, 'new');
		const oldVal = _prepareValue(col, 'old');

		// Check logic (for association, check all foreign keys)
		const checkCols = col.foreignKeys ? col.foreignKeys.flatMap(fk => `${col.name}_${fk}`) : [col.name];
		const changeCondition = checkCols.map(k => _nullSafeChanged(k)).join(' OR ');

		return `IF (${changeCondition}) THEN
				${oldVal.assignment}
				${newVal.assignment}
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(SYSUUID, '${col.name}', ${oldVal.valExp}, ${newVal.valExp}, :entity, :entityKey, :objectID, :rootEntity, :rootEntityKey, :rootObjectID, CURRENT_TIMESTAMP, SESSION_CONTEXT('APPLICATIONUSER'), '${col.type}', 'update', CURRENT_UPDATE_TRANSACTION());
			END IF;`;
	}).join('\n');

	// Build OF clause
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name]
		// use foreignKeys for managed associations, but skip on for unmanaged
		if (c.foreignKeys) {
			return c.foreignKeys.map(k => `${c.name}_${k.replaceAll(/\./g, '_')}`)
		} else if (c.on) {
			// REVISIT: for unmanaged associations, we cannot be sure which columns are involved
			return [];
		}
	})
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return {
		name: entity.name + '_CT_UPDATE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_UPDATE AFTER UPDATE ${ofClause}
	  ON ${utils.transformName(entity.name)}
      REFERENCING NEW ROW new, OLD ROW old
      BEGIN
        ${triggerDeclaration.join('\n')}
        ${body}
      END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const triggerDeclaration = _generateTriggerDeclaration(entity, 'old', objectIDs, rootEntity, rootObjectIDs);
	const colVars = _generateColumnDeclaration(columns, 'old');
	if (colVars.length) {
		triggerDeclaration.splice(triggerDeclaration.length - 3, 0, ...colVars, '');
	}

	const body = columns.map((c) => {
		// set old value
		const { condition, valExp, assignment } = _prepareValue(c, 'old');

		return `${assignment}
			IF (${condition}) THEN
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(SYSUUID, '${c.name}', ${valExp}, NULL, :entity, :entityKey, :objectID, :rootEntity, :rootEntityKey, :rootObjectID, CURRENT_TIMESTAMP, SESSION_CONTEXT('APPLICATIONUSER'), '${c.type}', 'delete', CURRENT_UPDATE_TRANSACTION());
			END IF;`;
	})
		.join('\n');

	return {
		name: entity.name + '_CT_DELETE',
		sql: `TRIGGER ${utils.transformName(entity.name)}_CT_DELETE AFTER DELETE
    ON ${utils.transformName(entity.name)}
    REFERENCING OLD ROW old
      BEGIN
        ${triggerDeclaration.join('\n')}
        ${body}
      END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateDeleteTriggerCascade(entity) {
	const keys = utils.extractKeys(entity.keys);
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

function _prepareValue(col, refRow) {
	let condition = '';
	let valExp = '';
	let assignment = '';

	if (col.target && col.alt) {
		// Association Lookup -> generates SELECT INTO
		const varName = `v_assoc_${col.name.replace(/\./g, '_')}_${refRow}`;
		const queryFragment = handleAssociationLookUp(col, refRow);

		// HANA variable assignment from query: (temp = (SELECT ...))
		assignment = `${queryFragment};`;
		valExp = `:${varName}`;

	} else if (col.type === 'cds.Boolean') {
		// REVISIT: Boolean handling
		// INT type is not comparable with BOOLEAN typ
		// valExp = `CASE WHEN :${refRow}.${col.name} IS NULL THEN NULL WHEN :${refRow}.${col.name} = 1 THEN 'true' ELSE 'false' END`;
		valExp = `:${refRow}.${col.name}`;
	} else if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.foreignKeys) {
		// Concatenate keys
		valExp = col.foreignKeys.map(fk => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	} else {
		// Scalar
		let raw = `:${refRow}.${col.name}`;
		if (['cds.Date', 'cds.DateTime', 'cds.Timestamp'].includes(col.type)) {
			raw = `TO_NVARCHAR(${raw})`;
		} else if (col.type === 'cds.String') {
			// Handle large strings
			raw = considerLargeString(raw);
		}
		valExp = raw;
	}

	if (col.target && col.foreignKeys) {
		condition = col.foreignKeys?.map(fk => `:${refRow}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	} else {
		condition = `:${refRow}.${col.name} IS NOT NULL`;
	}

	return { condition, valExp, assignment };
}

function _generateObjectIDLogic(objectIDs, entity, keys, refRow) {
	if (!objectIDs || objectIDs.length === 0) return `objectID = :entityKey;`;

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) parts.push(`TO_NVARCHAR(:${refRow}.${oid.name})`);
		else {
			// Sub-Select
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `:${refRow}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			let sql = `(${_toHanaSQL(query)})`;
			parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
		}
	}
	const concatLogic = parts.join(" || ', ' || ");

	return `objectID = ${concatLogic};
            IF :objectID IS NULL OR :objectID = '' THEN
                objectID = entityKey;
            END IF;`;
}

function _generateRootObjectIDLogic(rootObjectIDs, childEntity, rootEntity, refRow) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) return `rootObjectID = :rootEntityKey;`;

	// We need to link Child -> Root
	const binding = utils.getRootBinding(childEntity, rootEntity);

	// The keys of the root entity
	const rootKeys = utils.extractKeys(rootEntity.keys);

	// WHERE clause: Root.Key = :child.ForeignKey
	const where = {};
	rootKeys.forEach((rk, index) => {
		// CAUTION: Assumes order matches. Ideally map by name if available, or assume foreignKeys array aligns with root keys
		const fk = binding.foreignKeys[index];
		where[rk] = { val: `:${refRow}.${fk}` };
	});

	// Use sub-selects to get root object IDs based on child row context
	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		let sql = `(${_toHanaSQL(query)})`;
		parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");
	return `rootObjectID = ${concatLogic};
            IF rootObjectID IS NULL OR rootObjectID = '' THEN
                rootObjectID = rootEntityKey;
            END IF;`;
}

function _nullSafeChanged(column, oldRef = 'old', newRef = 'new') {
	const o = `:${oldRef}.${column}`;
	const n = `:${newRef}.${column}`;
	// (o <> n OR o IS NULL OR n IS NULL) AND NOT (o IS NULL AND n IS NULL)
	return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

function considerLargeString(val) {
	// CASE WHEN LENGTH(:val) > 5000 THEN LEFT(:val, 4997) || '...' ELSE :val END
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

function handleAssociationLookUp(column, refRow) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${column.name}_${k}` };
			return acc;
		}, {})
		: column.on?.reduce((acc, k) => {
			acc[k] = { ref: ['entityKey'], param: true };
			return acc;
		}, {})

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	const query = SELECT.one.from(column.target).columns(columns).where(where);
	let hanaSQL = _toHanaSQL(query);
	//return hanaSQL;
	return addInsertTo(hanaSQL, column.name, refRow);
}


module.exports = {
	generateHANATriggers
};