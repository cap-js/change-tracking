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
	return `(COALESCE(SESSION_CONTEXT('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(SESSION_CONTEXT('${entitySkipVar}'), 'false') != 'true')`;
}

function _getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(SESSION_CONTEXT('${varName}'), 'false') != 'true'`;
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

function generateHANATriggers(csn, entity, rootEntity = null, mergedAnnotations = null, rootMergedAnnotations = null) {
	model = csn;
	const triggers = [];
	const { columns: trackedColumns, compositionsOfMany } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	if (trackedColumns.length === 0 && compositionsOfMany.length === 0) return triggers;

	const objectIDs = utils.getObjectIDs(entity, model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, model, rootMergedAnnotations?.entityAnnotation);

	const keys = utils.extractKeys(entity.keys);
	if (keys.length === 0 && trackedColumns.length > 0) return triggers;

	// Generate regular column triggers
	if (trackedColumns.length > 0) {
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
				triggers.push(_generateDeleteTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
			}
		}
	}

	// Generate composition of many triggers (triggers on target entity that log changes to this entity)
	for (const comp of compositionsOfMany) {
		const targetEntity = model.definitions[comp.target];
		if (!targetEntity) continue;

		if (!config?.disableCreateTracking) {
			const trigger = _generateCompOfManyCreateTrigger(targetEntity, entity, comp, objectIDs);
			if (trigger) triggers.push(trigger);
		}
		if (!config?.disableUpdateTracking) {
			const trigger = _generateCompOfManyUpdateTrigger(targetEntity, entity, comp, objectIDs);
			if (trigger) triggers.push(trigger);
		}
		if (!config?.disableDeleteTracking) {
			const trigger = _generateCompOfManyDeleteTrigger(targetEntity, entity, comp, objectIDs);
			if (trigger) triggers.push(trigger);
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
	if (!binding) return 'NULL';
	
	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		const rootKeys = utils.extractKeys(rootEntity.keys);
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `:${rowRef}.${childKey}` };
		}
		// Select root keys concatenated
		const columns = rootKeys.length === 1 
			? rootKeys[0] 
			: utils.buildConcatXpr(rootKeys);
		const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where);
		return `(${_toHanaSQL(query)})`;
	}
	
	// Standard case: direct FK binding on child
	if (Array.isArray(binding) && binding.length > 0) {
		return binding.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
	}
	return 'NULL';
}


function _getObjectIDExpression(objectIDs, entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	// fallback to entity name when no @changelog annotation
	if (!objectIDs || objectIDs.length === 0) {
		return `'${entity.name}'`;
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
		return `'${rootEntity.name}'`;
	}

	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return rootEntityKeyExpr;

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		// Build WHERE: <compositionName>_<childKey> = :rowRef.<childKey>
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `:${rowRef}.${childKey}` };
		}

		const parts = [];
		for (const oid of rootObjectIDs) {
			const query = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where);
			let sql = `(${_toHanaSQL(query)})`;
			parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
		}

		const concatLogic = parts.join(" || ', ' || ");
		return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
	}

	// Standard case: child has FK to root
	if (!Array.isArray(binding) || binding.length === 0) return rootEntityKeyExpr;

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
		return checkCols.map(k => _nullSafeChanged(k, 'old', 'new')).join(' OR ');
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
	const oldLabelExp = _getLabelExpression(col, 'old');
	const newLabelExp = _getLabelExpression(col, 'new');

	// Build FROM clause using entity table instead of DUMMY
	const fromDummy = `FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY`;

	// Add element-level skip condition
	const elementSkipCondition = _getElementSkipCondition(entity.name, col.name);
	const fullWhereCondition = `(${whereCondition}) AND ${elementSkipCondition}`;

	return `SELECT '${col.name}' AS attribute, ${modification === 'create' ? 'NULL' : oldValExp} AS valueChangedFrom, ${modification === 'delete' ? 'NULL' : newValExp} AS valueChangedTo, ${modification === 'create' ? 'NULL' : oldLabelExp} AS valueChangedFromLabel, ${modification === 'delete' ? 'NULL' : newLabelExp} AS valueChangedToLabel, '${col.type}' AS valueDataType ${fromDummy} WHERE ${fullWhereCondition}`;
}

/**
 * Returns the value expression for a column
 */
function _getValueExpression(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `:${refRow}.${col.name}`;
	} else if (col.target && col.foreignKeys) {
		// Concatenate keys (raw FK value)
		return col.foreignKeys.map(fk => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	} else if (col.target && col.on) {
		return col.on.map(mapping => `TO_NVARCHAR(:${refRow}.${mapping.foreignKeyField})`).join(" || ' ' || ");
	} else {
		// Scalar
		let raw = `:${refRow}.${col.name}`;
		if (['cds.Date', 'cds.DateTime', 'cds.Timestamp', 'cds.Time', 'cds.Decimal'].includes(col.type)) {
			raw = `TO_NVARCHAR(${raw})`;
		} else if (col.type === 'cds.String') {
			raw = _considerLargeString(raw);
		}
		return raw;
	}
}

// Returns the label expression for a column
function _getLabelExpression(col, refRow) {
	if (col.target && col.alt) {
		// Association lookup using inline SELECT - this is the display label
		return _getAssociationLookupExpression(col, refRow);
	}
	return 'NULL';
}

// Returns inline SELECT expression for association lookup with locale support
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

	// Check if target entity has localized data
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	
	if (localizedInfo) {
		// Build locale-aware lookup: try .texts table first, fall back to base entity
		const textsWhere = { ...where, locale: { func: 'SESSION_CONTEXT', args: [{ val: '$user.locale' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		
		const textsSQL = _toHanaSQL(textsQuery);
		const baseSQL = _toHanaSQL(baseQuery);
		
		return `COALESCE((${textsSQL}), (${baseSQL}))`;
	}

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
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
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
	const entityKeyExpr = _getEntityKeyExpression(entity, 'new');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'new');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'new');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'new');
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
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
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
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
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

function _generateDeleteTrigger(entity, columns, objectIDs, rootEntity = null, rootObjectIDs = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map((k) => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	const entityKeyExpr = _getEntityKeyExpression(entity, 'old');
	const rootEntityKeyExpr = _getRootEntityKeyExpression(entity, rootEntity, 'old');
	const objectIDExpr = _getObjectIDExpression(objectIDs, entity, 'old');
	const rootObjectIDExpr = _getRootObjectIDExpression(rootObjectIDs, entity, rootEntity, 'old');
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const body = `IF ${_getSkipCheckCondition(entity.name)} THEN
		DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
		
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
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


// Build objectID expression for composition of many from the target entity's row
function _getCompOfManyObjectID(altPaths, refRow) {
	if (!altPaths || altPaths.length === 0) return 'NULL';
	
	if (altPaths.length === 1) {
		return `TO_NVARCHAR(:${refRow}.${altPaths[0]})`;
	}
	
	// Concatenate multiple paths
	return altPaths.map(p => `TO_NVARCHAR(:${refRow}.${p})`).join(" || ', ' || ");
}

// Looks up the root entity's objectID via FK from target
function _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) return `'${rootEntity.name}'`;
	
	// Build WHERE: rootKey = refRow.<FK>
	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return `'${rootEntity.name}'`;
	
	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `:${refRow}.${binding[i]}` };
	}
	
	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		let sql = `(${_toHanaSQL(query)})`;
		parts.push(`COALESCE(TO_NVARCHAR(${sql}), '')`);
	}
	
	const concatLogic = parts.join(" || ', ' || ");
	
	// Build fallback rootEntityKey expression
	const rootEntityKeyExpr = binding.map(k => `TO_NVARCHAR(:${refRow}.${k})`).join(" || '||' || ");
	
	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function _generateCompOfManyCreateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_CREATE`;
	
	// Get FK from target to root (e.g., Books.bookStore_ID -> BookStores.ID)
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// Use parent's key as entityKey since the composition attribute belongs to the parent
	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:new.${k})`).join(" || '||' || ");
	
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'new');
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');
	
	// valueChangedTo = the objectID (title) for create operations
	const valueChangedTo = objectID;

	const body = `IF ${_getSkipCheckCondition(targetEntity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		VALUES (
			SYSUUID,
			'${compInfo.name}',
			NULL,
			${valueChangedTo},
			NULL,
			NULL,
			'${rootEntity.name}',
			${parentEntityKey},
			${rootObjectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'create',
			CURRENT_UPDATE_TRANSACTION()
		);
	END IF;`;

	return {
		name: triggerName,
		sql: `TRIGGER ${triggerName} AFTER INSERT
ON ${targetTableName}
REFERENCING NEW ROW new
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateCompOfManyUpdateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_UPDATE`;
	
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// Use parent's key as entityKey since the composition attribute belongs to the parent
	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:new.${k})`).join(" || '||' || ");
	
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'new');
	const oldObjectID = _getCompOfManyObjectID(compInfo.alt, 'old');
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');

	const body = `IF ${_getSkipCheckCondition(targetEntity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		VALUES (
			SYSUUID,
			'${compInfo.name}',
			${oldObjectID},
			${objectID},
			NULL,
			NULL,
			'${rootEntity.name}',
			${parentEntityKey},
			${rootObjectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'update',
			CURRENT_UPDATE_TRANSACTION()
		);
	END IF;`;

	return {
		name: triggerName,
		sql: `TRIGGER ${triggerName} AFTER UPDATE
ON ${targetTableName}
REFERENCING NEW ROW new, OLD ROW old
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

function _generateCompOfManyDeleteTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_DELETE`;
	
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// Use parent's key as entityKey since the composition attribute belongs to the parent
	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'old');
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'old');

	const body = `IF ${_getSkipCheckCondition(targetEntity.name)} THEN
		INSERT INTO SAP_CHANGELOG_CHANGES 
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		VALUES (
			SYSUUID,
			'${compInfo.name}',
			${objectID},
			NULL,
			NULL,
			NULL,
			'${rootEntity.name}',
			${parentEntityKey},
			${rootObjectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'delete',
			CURRENT_UPDATE_TRANSACTION()
		);
	END IF;`;

	return {
		name: triggerName,
		sql: `TRIGGER ${triggerName} AFTER DELETE
ON ${targetTableName}
REFERENCING OLD ROW old
BEGIN
	${body}
END;`,
		suffix: '.hdbtrigger'
	};
}

module.exports = {
	generateHANATriggers
};