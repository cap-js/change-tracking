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
	if (binding && binding.foreignKeys) {
		return binding.foreignKeys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
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

	// Direct fallback to entityKey expression using COALESCE
	return `COALESCE(NULLIF(${concatLogic}, ''), ${entityKeyExpr})`;
}

function _getRootObjectIDExpression(rootObjectIDs, childEntity, rootEntity, rowRef) {
	if (!rootEntity) return 'NULL';

	const rootEntityKeyExpr = _getRootEntityKeyExpression(childEntity, rootEntity, rowRef);

	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		return rootEntityKeyExpr;
	}

	// We need to link Child -> Root
	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return rootEntityKeyExpr;

	// The keys of the root entity
	const rootKeys = utils.extractKeys(rootEntity.keys);

	// WHERE clause: Root.Key = :child.ForeignKey
	const where = {};
	rootKeys.forEach((rk, index) => {
		const fk = binding.foreignKeys[index];
		where[rk] = { val: `:${rowRef}.${fk}` };
	});

	// Use sub-selects to get root object IDs based on child row context
	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		let sql = `(${_toHanaSQL(query)})`;
		parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");

	// Direct fallback to rootEntityKey expression using COALESCE
	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function _generateCreateTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const entityKeyExpr = _getEntityKeyExpression(entity, 'new');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'new');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'new');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'new');
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	const body = columns.map((col) => {
		const { condition, valExp } = _prepareValue(col, 'new');

		return `IF (${condition}) THEN
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(
					SYSUUID,
					'${col.name}',
					NULL,
					${valExp},
					'${entity.name}',
					${entityKeyExpr},
					${objectIDExpr},
					${rootEntityValue},
					${rootEntityKeyExpr},
					${rootObjectIDExpr},
					CURRENT_TIMESTAMP,
					SESSION_CONTEXT('APPLICATIONUSER'),
					'${col.type}',
					'create',
					CURRENT_UPDATE_TRANSACTION()
				);
			END IF;`;
	}).join('\n');

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

	const body = columns.map((col) => {
		// Prepare old and new values
		const newVal = _prepareValue(col, 'new');
		const oldVal = _prepareValue(col, 'old');

		// Check logic (for association, check all foreign keys)
		const checkCols = col.foreignKeys ? col.foreignKeys.flatMap(fk => `${col.name}_${fk}`)
			: col.on
				? col.on.map(m => m.foreignKeyField)
				: [col.name];
		const changeCondition = checkCols.map(k => `:old.${k} != :new.${k}`).join(' OR ');

		return `IF (${changeCondition}) THEN
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(
					SYSUUID,
					'${col.name}',
					${oldVal.valExp},
					${newVal.valExp},
					'${entity.name}',
					${entityKeyExpr},
					${objectIDExpr},
					${rootEntityValue},
					${rootEntityKeyExpr},
					${rootObjectIDExpr},
					CURRENT_TIMESTAMP,
					SESSION_CONTEXT('APPLICATIONUSER'),
					'${col.type}',
					'update',
					CURRENT_UPDATE_TRANSACTION()
				);
			END IF;`;
	}).join('\n');

	// Build OF clause
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name]
		// use foreignKeys for managed associations
		if (c.foreignKeys) {
			return c.foreignKeys.map(k => `${c.name}_${k.replaceAll(/\./g, '_')}`)
		} else if (c.on) {
			return c.on.map(m => m.foreignKeyField);
		}
	})
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

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

	const body = columns.map((col) => {
		const { condition, valExp } = _prepareValue(col, 'old');

		return `IF (${condition}) THEN
				INSERT INTO SAP_CHANGELOG_CHANGES 
				(ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES 
				(
					SYSUUID,
					'${col.name}',
					${valExp},
					NULL,
					'${entity.name}',
					${entityKeyExpr},
					${objectIDExpr},
					${rootEntityValue},
					${rootEntityKeyExpr},
					${rootObjectIDExpr},
					CURRENT_TIMESTAMP,
					SESSION_CONTEXT('APPLICATIONUSER'),
					'${col.type}',
					'delete',
					CURRENT_UPDATE_TRANSACTION()
				);
			END IF;`;
	}).join('\n');

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

	if (col.target && col.alt) {
		// Association lookup using inline SELECT
		valExp = _getAssociationLookupExpression(col, refRow);

	} else if (col.type === 'cds.Boolean') {
		// REVISIT: Boolean handling
		valExp = `:${refRow}.${col.name}`;
	} else if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.foreignKeys) {
		// Concatenate keys
		valExp = col.foreignKeys.map(fk => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	} else if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.on) {
		valExp = col.on.map(mapping => `TO_NVARCHAR(:${refRow}.${mapping.foreignKeyField})`).join(" || ' ' || ");
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

	// Condition to check for NOT NULL
	if (col.target && col.foreignKeys) {
		condition = col.foreignKeys?.map(fk => `:${refRow}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	} else if (col.target && col.on) {
		condition = col.on?.map(mapping => `:${refRow}.${mapping.foreignKeyField} IS NOT NULL`).join(' OR ');
	} else {
		condition = `:${refRow}.${col.name} IS NOT NULL`;
	}

	return { condition, valExp };
}

// Revisit: check if Left is supported for all db adapters
function considerLargeString(val) {
	// CASE WHEN LENGTH(:val) > 5000 THEN LEFT(:val, 4997) || '...' ELSE :val END
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns inline SELECT expression for association lookup
 * e.g., "(SELECT "$C".firstName || ' ' || "$C".lastName FROM ... WHERE ... LIMIT 1)"
 */
function _getAssociationLookupExpression(column, refRow) {
	let where = {};
	if (column.foreignKeys) {
		// managed association
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${column.name}_${k}` };
			return acc;
		}, {});
	} else if (column.on) {
		// unmanaged association
		where = column.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `:${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Build the SELECT query
	const query = SELECT.one.from(column.target).columns(columns).where(where);

	// Return as transformed inline expression wrapped in parentheses
	return `(${_toHanaSQL(query)})`;
}


module.exports = {
	generateHANATriggers
};