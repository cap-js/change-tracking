const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

function toSQL(query) {
	const sqlCQN = cqn4sql(query, model);
	let sql = HANACQN2SQL.SELECT(sqlCQN);
	// Remove quotes around trigger row references: ':old.col' -> :old.col
	return sql.replace(/'(:(?:old|new)\.\w+)'/g, '$1');
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(SESSION_CONTEXT('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(SESSION_CONTEXT('${entitySkipVar}'), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(SESSION_CONTEXT('${varName}'), 'false') != 'true'`;
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
		return col.foreignKeys.map(fk => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	}
	if (col.target && col.on) {
		return col.on.map(m => `TO_NVARCHAR(:${refRow}.${m.foreignKeyField})`).join(" || ' ' || ");
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
 * Returns SQL WHERE condition for detecting column changes (null-safe comparison)
 */
function getWhereCondition(col, modification) {
	const isLob = col.type === 'cds.LargeString';
	if (modification === 'update') {
		const checkCols = col.foreignKeys
			? col.foreignKeys.map(fk => `${col.name}_${fk}`)
			: col.on
				? col.on.map(m => m.foreignKeyField)
				: [col.name];
		return checkCols.map(k => nullSafeChanged(k, isLob)).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys) {
		return col.foreignKeys.map(fk => `:${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on) {
		return col.on.map(m => `:${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	// For LOB types, convert to NVARCHAR before null check
	if (isLob) {
		return `TO_NVARCHAR(:${rowRef}.${col.name}) IS NOT NULL`;
	}
	return `:${rowRef}.${col.name} IS NOT NULL`;
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
 * Builds inline SELECT expression for association label lookup with locale support
 */
function buildAssocLookup(column, refRow) {
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

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'SESSION_CONTEXT', args: [{ val: 'LOCALE' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);
		return `COALESCE((${toSQL(textsQuery)}), (${toSQL(baseQuery)}))`;
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
 * Returns inline expression for entity key concatenation
 * e.g., "TO_NVARCHAR(:new.ID)" or "TO_NVARCHAR(:new.ID) || '||' || TO_NVARCHAR(:new.version)"
 */
function buildEntityKeyExpr(entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	return keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
}

/**
 * Returns inline expression for root entity key from child entity
 */
function buildRootEntityKeyExpr(entity, rootEntity, rowRef) {
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
		const columns = rootKeys.length === 1 ? rootKeys[0] : utils.buildConcatXpr(rootKeys);
		const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where);
		return `(${toSQL(query)})`;
	}

	// Standard case: direct FK binding on child
	if (Array.isArray(binding) && binding.length > 0) {
		return binding.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
	}
	return 'NULL';
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity name
 */
function buildObjectIDExpr(objectIDs, entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	if (!objectIDs || objectIDs.length === 0) {
		return `'${entity.name}'`;
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
 * Builds SQL expression for root entity's objectID
 */
function buildRootObjectIDExpr(rootObjectIDs, childEntity, rootEntity, rowRef) {
	if (!rootEntity) return 'NULL';

	const rootEntityKeyExpr = buildRootEntityKeyExpr(childEntity, rootEntity, rowRef);

	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		return `'${rootEntity.name}'`;
	}

	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return rootEntityKeyExpr;

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `:${rowRef}.${childKey}` };
		}

		const parts = [];
		for (const oid of rootObjectIDs) {
			const query = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where);
			parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query)})), '')`);
		}

		const concatLogic = parts.join(" || ', ' || ");
		return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
	}

	// Standard case: child has FK to root
	if (!Array.isArray(binding) || binding.length === 0) return rootEntityKeyExpr;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	const where = {};
	rootKeys.forEach((rk, index) => {
		where[rk] = { val: `:${rowRef}.${binding[index]}` };
	});

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query)})), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");
	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

/**
 * Generates a single UNION member subquery for tracking a column change
 */
function buildColumnSubquery(col, modification, entity) {
	const whereCondition = getWhereCondition(col, modification);
	const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
	const fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

	const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'old');
	const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'new');
	const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old');
	const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new');

	return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY WHERE ${fullWhere}`;
}

/**
 * Common context for all trigger types
 */
function buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, rowRef) {
	return {
		entityKeyExpr: buildEntityKeyExpr(entity, rowRef),
		rootEntityKeyExpr: buildRootEntityKeyExpr(entity, rootEntity, rowRef),
		objectIDExpr: buildObjectIDExpr(objectIDs, entity, rowRef),
		rootObjectIDExpr: buildRootObjectIDExpr(rootObjectIDs, entity, rootEntity, rowRef),
		rootEntityValue: rootEntity ? `'${rootEntity.name}'` : 'NULL'
	};
}

/**
 * Generates INSERT SQL for changelog entries from UNION query
 */
function buildInsertSQL(entity, columns, modification, ctx) {
	const unionQuery = columns.map(col => buildColumnSubquery(col, modification, entity)).join('\nUNION ALL\n');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'${entity.name}',
			${ctx.entityKeyExpr},
			${ctx.objectIDExpr},
			${ctx.rootEntityValue},
			${ctx.rootEntityKeyExpr},
			${ctx.rootObjectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'${modification}',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);`;
}

/**
 * Wraps INSERT SQL in skip check condition
 */
function wrapInSkipCheck(entityName, insertSQL) {
	return `IF ${getSkipCheckCondition(entityName)} THEN
		${insertSQL}
	END IF;`;
}

/**
 * Generates CREATE trigger for INSERT events
 */
function generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'new');
	const insertSQL = buildInsertSQL(entity, columns, 'create', ctx);
	const body = wrapInSkipCheck(entity.name, insertSQL);

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

/**
 * Generates UPDATE trigger
 */
function generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'new');
	const insertSQL = buildInsertSQL(entity, columns, 'update', ctx);
	const body = wrapInSkipCheck(entity.name, insertSQL);

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) return c.foreignKeys.map(k => `${c.name}_${k.replaceAll(/\./g, '_')}`);
		if (c.on) return c.on.map(m => m.foreignKeyField);
		return [];
	});
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

/**
 * Generates DELETE trigger (preserves history)
 */
function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'old');
	const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
	const body = wrapInSkipCheck(entity.name, insertSQL);

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

/**
 * Generates DELETE trigger (clears history first)
 */
function generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'old');

	const deleteSQL = `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey = ${entityKey};`;
	const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
	const body = wrapInSkipCheck(entity.name, `${deleteSQL}\n\t\t${insertSQL}`);

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

/**
 * Builds SQL expression for composition objectID from target entity row
 */
function buildCompOfManyObjectID(altPaths, refRow) {
	if (!altPaths || altPaths.length === 0) return 'NULL';
	if (altPaths.length === 1) return `TO_NVARCHAR(:${refRow}.${altPaths[0]})`;
	return altPaths.map(p => `TO_NVARCHAR(:${refRow}.${p})`).join(" || ', ' || ");
}

/**
 * Builds rootObjectID select for composition of many
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) return `'${rootEntity.name}'`;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return `'${rootEntity.name}'`;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `:${refRow}.${binding[i]}` };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE(TO_NVARCHAR((${toSQL(query)})), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");
	const rootEntityKeyExpr = binding.map(k => `TO_NVARCHAR(:${refRow}.${k})`).join(" || '||' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

/**
 * Generates INSERT VALUES SQL for composition triggers
 */
function buildCompInsertSQL(compInfo, rootEntity, modification, parentEntityKey, objectID, rootObjectID) {
	const valueFrom = modification === 'delete' ? objectID : (modification === 'update' ? objectID.old : 'NULL');
	const valueTo = modification === 'create' ? objectID : (modification === 'update' ? objectID.new : 'NULL');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		VALUES (
			SYSUUID,
			'${compInfo.name}',
			${valueFrom},
			${valueTo},
			NULL,
			NULL,
			'${rootEntity.name}',
			${parentEntityKey},
			${rootObjectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'${modification}',
			CURRENT_UPDATE_TRANSACTION()
		);`;
}

function generateCompOfManyCreateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_CREATE`;

	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;

	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:new.${k})`).join(" || '||' || ");
	const objectID = buildCompOfManyObjectID(compInfo.alt, 'new');
	const rootObjectID = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');

	const insertSQL = buildCompInsertSQL(compInfo, rootEntity, 'create', parentEntityKey, objectID, rootObjectID);
	const body = wrapInSkipCheck(targetEntity.name, insertSQL);

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

function generateCompOfManyUpdateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_UPDATE`;

	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;

	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:new.${k})`).join(" || '||' || ");
	const objectIDNew = buildCompOfManyObjectID(compInfo.alt, 'new');
	const objectIDOld = buildCompOfManyObjectID(compInfo.alt, 'old');
	const rootObjectID = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');

	const insertSQL = buildCompInsertSQL(compInfo, rootEntity, 'update', parentEntityKey, { old: objectIDOld, new: objectIDNew }, rootObjectID);
	const body = wrapInSkipCheck(targetEntity.name, insertSQL);

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

function generateCompOfManyDeleteTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_CT_COMP_${compInfo.name.toUpperCase()}_DELETE`;

	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;

	const parentEntityKey = binding.map(k => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
	const objectID = buildCompOfManyObjectID(compInfo.alt, 'old');
	const rootObjectID = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'old');

	const insertSQL = buildCompInsertSQL(compInfo, rootEntity, 'delete', parentEntityKey, objectID, rootObjectID);
	const body = wrapInSkipCheck(targetEntity.name, insertSQL);

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
			triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		}
		if (!config?.disableUpdateTracking) {
			triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		}
		if (!config?.disableDeleteTracking) {
			const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
			triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		}
	}

	// Generate composition of many triggers
	for (const comp of compositionsOfMany) {
		const targetEntity = model.definitions[comp.target];
		if (!targetEntity) continue;

		if (!config?.disableCreateTracking) {
			triggers.push(generateCompOfManyCreateTrigger(targetEntity, entity, comp, objectIDs));
		}
		if (!config?.disableUpdateTracking) {
			triggers.push(generateCompOfManyUpdateTrigger(targetEntity, entity, comp, objectIDs));
		}
		if (!config?.disableDeleteTracking) {
			triggers.push(generateCompOfManyDeleteTrigger(targetEntity, entity, comp, objectIDs));
		}
	}

	return triggers;
}

module.exports = { generateHANATriggers };
