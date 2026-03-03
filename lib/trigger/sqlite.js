const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('./TriggerCQN2SQL');

const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;
let model;

function toSQL(query) {
	if (!SQLiteCQN2SQL) {
		const SQLiteService = require('@cap-js/sqlite');
		const TriggerCQN2SQL = createTriggerCQN2SQL(SQLiteService.CQN2SQL);
		SQLiteCQN2SQL = new TriggerCQN2SQL({ model: model });
	}
	const sqlCQN = cqn4sql(query, model);
	return SQLiteCQN2SQL.SELECT(sqlCQN);
}

/**
 * Builds WHERE clause for CQN query from entity keys
 * Maps each key to a trigger row reference (e.g., new.ID, old.name)
 */
function buildKeyWhere(keys, refRow) {
	return keys.reduce((acc, k) => {
		acc[k] = { val: `${refRow}.${k}` };
		return acc;
	}, {});
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(session_context('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(session_context('${entitySkipVar}'), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(session_context('${varName}'), 'false') != 'true'`;
}

/**
 * Truncates large strings in SQL: CASE WHEN LENGTH(val) > 5000 THEN SUBSTR(val, 1, 4997) || '...' ELSE val END
 */
function wrapLargeString(val) {
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN SUBSTR(${val}, 1, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `CASE ${refRow}.${col.name} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}`).join(" || '||' || ");
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${refRow}.${m.foreignKeyField}`).join(" || '||' || ");
	}
	let raw = `${refRow}.${col.name}`;
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') raw = wrapLargeString(raw);
	return raw;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map((fk) => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
		}
		if (col.target && col.on?.length) {
			return col.on.map((m) => `old.${m.foreignKeyField} IS NOT new.${m.foreignKeyField}`).join(' OR ');
		}
		return `old.${col.name} IS NOT new.${col.name}`;
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on?.length) {
		return col.on.map((m) => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${col.name} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale awareness
 */
function buildAssocLookup(column, refRow, entityKey) {
	const where = column.foreignKeys
		? column.foreignKeys.reduce((acc, k) => {
				acc[k] = { val: `${refRow}.${column.name}_${k}` };
				return acc;
			}, {})
		: column.on?.reduce((acc, k) => {
				// Composition of aspect has a targetKey object
				acc[k.targetKey ?? k] = { val: entityKey };
				return acc;
			}, {});

	// Drop the first part of column.alt (association name)
	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'session_context', args: [{ val: '$user.locale' }] } };
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
function getLabelExpr(col, refRow, entityKey) {
	if (col.target && col.alt) {
		return buildAssocLookup(col, refRow, entityKey);
	}
	return 'NULL';
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity name
 */
function buildObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	if (objectIDs.length === 0) return `'${entityName}'`;

	for (const objectID of objectIDs) {
		if (objectID.included) continue;
		const where = buildKeyWhere(entityKeys, refRow);
		const query = SELECT.one.from(entityName).columns(objectID.name).where(where);
		objectID.selectSQL = toSQL(query);
	}

	const unionParts = objectIDs.map((id) => (id.included ? `SELECT ${refRow}.${id.name} AS value WHERE ${refRow}.${id.name} IS NOT NULL` : `SELECT (${id.selectSQL}) AS value`));

	return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unionParts.join('\nUNION ALL\n')}))`;
}

/**
 * Builds SQL expression for root entity's objectID
 */
function buildRootObjectIDSelect(rootObjectIDs, childEntity, rootEntity, refRow) {
	if (rootObjectIDs.length === 0) return `'${rootEntity.name}'`;

	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return null;

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${refRow}.${childKey}` };
		}
		for (const oid of rootObjectIDs) {
			const q = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where);
			oid.selectSQL = toSQL(q);
		}
		const unions = rootObjectIDs.map((oid) => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n');
		return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;
	}

	// Standard case: child has FK to root
	if (!Array.isArray(binding) || binding.length === 0) return null;

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return null;

	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
	}

	for (const oid of rootObjectIDs) {
		const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		oid.selectSQL = toSQL(q);
	}

	const unions = rootObjectIDs.map((oid) => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n');
	return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;
}

/**
 * Builds SQL expression for root entity key from child entity
 */
function buildRootKeyFromChild(childEntity, rootEntity, refRow) {
	if (!rootEntity) return null;
	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return null;

	if (binding.type === 'compositionOfOne') {
		const rootKeys = utils.extractKeys(rootEntity.keys);
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${refRow}.${childKey}` };
		}
		const columns = rootKeys.length === 1 ? rootKeys[0] : utils.buildConcatXpr(rootKeys);
		const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where);
		return `(${toSQL(query)})`;
	}

	return binding.map((k) => `${refRow}.${k}`).join(" || '||' || ");
}

/**
 * Generates a single UNION member subquery for tracking a column change
 */
function buildColumnSubquery(col, modification, entity, entityKey) {
	const whereCondition = getWhereCondition(col, modification);
	const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
	const fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

	const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'old');
	const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'new');
	const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old', entityKey);
	const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new', entityKey);

	return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType WHERE ${fullWhere}`;
}

/**
 * Common context for all trigger types
 */
function buildTriggerContext(entity, columns, objectIDs, rootEntity, rootObjectIDs, refRow, compositionParentInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map((k) => `${refRow}.${k}`).join(" || '||' || ");
	const objectID = buildObjectIDSelect(objectIDs, entity.name, keys, refRow) ?? entityKey;
	const rootEntityKey = buildRootKeyFromChild(entity, rootEntity, refRow);
	const rootObjectID = rootEntity ? (buildRootObjectIDSelect(rootObjectIDs, entity, rootEntity, refRow) ?? rootEntityKey) : null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';
	const parentLookupExpr = compositionParentInfo ? 'PARENT_LOOKUP_PLACEHOLDER' : null;

	return { keys, entityKey, objectID, rootEntityKey, rootObjectID, rootEntityValue, parentLookupExpr };
}

/**
 * Generates INSERT SQL for changelog entries
 */
function buildInsertSQL(entity, columns, modification, ctx) {
	const unionQuery = columns.map((col) => buildColumnSubquery(col, modification, entity, ctx.entityKey)).join('\nUNION ALL\n');

	return `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			${ctx.parentLookupExpr ?? 'NULL'},
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'${entity.name}',
			${ctx.entityKey},
			${ctx.objectID},
			${ctx.rootEntityValue},
			${ctx.rootEntityKey ?? 'NULL'},
			${ctx.rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'${modification}'
		FROM (
			${unionQuery}
		);`;
}

function generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new')
		: null;
	const ctx = buildTriggerContext(entity, columns, objectIDs, rootEntity, rootObjectIDs, 'new', compositionParentInfo);
	
	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'create', ctx);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new')
		: null;
	const ctx = buildTriggerContext(entity, columns, objectIDs, rootEntity, rootObjectIDs, 'new', compositionParentInfo);
	
	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'update', ctx);
	}

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap((c) => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) return c.foreignKeys.map((k) => `${c.name}_${k}`);
		if (c.on) return c.on.map((m) => `${c.name}_${m.foreignKeyField}`);
		return [];
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old')
		: null;
	const ctx = buildTriggerContext(entity, columns, objectIDs, rootEntity, rootObjectIDs, 'old', compositionParentInfo);
	
	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = compositionParentContext.insertSQL;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		bodySQL = `${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		bodySQL = buildInsertSQL(entity, columns, 'delete', ctx);
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

function generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old')
		: null;
	const ctx = buildTriggerContext(entity, columns, objectIDs, rootEntity, rootObjectIDs, 'old', compositionParentInfo);
	
	// Replace placeholder with actual parent lookup expression if needed
	if (compositionParentContext && ctx.parentLookupExpr) {
		ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
	}

	const deleteSQL = `DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${ctx.entityKey};`;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let bodySQL;
	if (columns.length === 0 && compositionParentContext) {
		bodySQL = `${deleteSQL}\n        ${compositionParentContext.insertSQL}`;
	} else if (compositionParentContext) {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		bodySQL = `${deleteSQL}\n        ${compositionParentContext.insertSQL}\n        ${insertSQL}`;
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		bodySQL = `${deleteSQL}\n        ${insertSQL}`;
	}

	return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
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
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
	}

	// Clone to avoid mutation
	const oids = rootObjectIDs.map((o) => ({ ...o }));
	for (const oid of oids) {
		const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		oid.selectSQL = toSQL(q);
	}

	const unions = oids.map((oid) => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n');
	return `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;
}

/**
 * Finds composition parent info for an entity (checks if root entity has a @changelog annotation on a composition field pointing to this entity)
 */
function getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations) {
	if (!rootEntity) return null;

	for (const [elemName, elem] of Object.entries(rootEntity.elements)) {
		if (elem.type !== 'cds.Composition' || elem.target !== entity.name) continue;

		const changelogAnnotation = rootMergedAnnotations?.elementAnnotations?.[elemName] ?? elem['@changelog'];
		if (!changelogAnnotation) continue;

		// Found a tracked composition - get the FK binding from child to parent
		const parentKeyBinding = utils.getCompositionParentBinding(entity, rootEntity);
		if (!parentKeyBinding || parentKeyBinding.length === 0) continue;

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding
		};
	}

	return null;
}

/**
 * Builds context for composition parent changelog entry
 */
function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const parentKeyExpr = parentKeyBinding.map((k) => `${rowRef}.${k}`).join(" || '||' || ");

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef);

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			'${compositionFieldName}',
			'${parentEntityName}',
			${parentKeyExpr},
			${rootObjectIDExpr},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'${modification}'
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND createdBy = session_context('$user.id')
			AND createdAt = session_context('$now')
		);`;

	// SELECT SQL to get the parent_ID for child entries
	const parentLookupExpr = `(SELECT ID FROM sap_changelog_Changes
		WHERE entity = '${parentEntityName}'
		AND entityKey = ${parentKeyExpr}
		AND attribute = '${compositionFieldName}'
		AND valueDataType = 'cds.Composition'
		AND createdBy = session_context('$user.id')
		ORDER BY createdAt DESC LIMIT 1)`;

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

function generateSQLiteTrigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
	model = csn;
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, model, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, model, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
	
	if (shouldGenerateTriggers) {
		if (!config?.disableCreateTracking) {
			triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo));
		}
		if (!config?.disableUpdateTracking) {
			triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo));
		}
		if (!config?.disableDeleteTracking) {
			const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
			triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo));
		}
	}

	return triggers.length === 1 ? triggers[0] : triggers.length > 0 ? triggers : null;
}

module.exports = { generateSQLiteTrigger };
