const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { createTriggerCQN2SQL } = require('./TriggerCQN2SQL');

const TriggerCQN2SQL = createTriggerCQN2SQL(HANAService.CQN2SQL);
let HANACQN2SQL;
let model;

function toSQL(query) {
	if (!HANACQN2SQL) {
		HANACQN2SQL = new TriggerCQN2SQL();
	}
	const sqlCQN = cqn4sql(query, model);
	return HANACQN2SQL.SELECT(sqlCQN);
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
		return col.foreignKeys.map((fk) => `TO_NVARCHAR(:${refRow}.${col.name}_${fk})`).join(" || ' ' || ");
	}
	if (col.target && col.on) {
		return col.on.map((m) => `TO_NVARCHAR(:${refRow}.${m.foreignKeyField})`).join(" || ' ' || ");
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
		const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
		return checkCols.map((k) => nullSafeChanged(k, isLob)).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'new' : 'old';
	if (col.target && col.foreignKeys) {
		return col.foreignKeys.map((fk) => `:${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.target && col.on) {
		return col.on.map((m) => `:${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
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
 * Returns SQL expression for a column's label (looked-up value for associations)
 */
function getLabelExpr(col, refRow) {
	if (!(col.target && col.alt)) {
		return `NULL`;
	}

	// Builds inline SELECT expression for association label lookup with locale support
	let where = {};
	if (col.foreignKeys) {
		where = col.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `:${refRow}.${col.name}_${k}` };
			return acc;
		}, {});
	} else if (col.on) {
		where = col.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `:${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	const alt = col.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(col.target, col.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'SESSION_CONTEXT', args: [{ val: 'LOCALE' }] } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(col.target).columns(columns).where(where);
		return `COALESCE((${toSQL(textsQuery)}), (${toSQL(baseQuery)}))`;
	}

	const query = SELECT.one.from(col.target).columns(columns).where(where);
	return `(${toSQL(query)})`;
}

/**
 * Builds SQL expression for objectID (entity display name)
 * Uses @changelog annotation fields, falling back to entity name
 */
function buildObjectIDExpr(objectIDs, entity, rowRef) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = keys.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

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
 * Builds SQL expression for grandparent entity's objectID
 * Used when creating grandparent composition entries for deep linking
 */
function buildGrandParentObjectIDExpr(grandParentObjectIDs, grandParentEntity, parentEntityName, parentKeyBinding, grandParentKeyBinding, rowRef) {
	// Build WHERE clause to find the parent entity record (e.g., OrderItem from OrderItemNote's FK)
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhere = parentKeys.map((pk, i) => `${pk} = :${rowRef}.${parentKeyBinding[i]}`).join(' AND ');

	// Build WHERE clause to find the grandparent entity record from parent
	const grandParentKeys = utils.extractKeys(grandParentEntity.keys);
	const grandParentWhereSubquery = grandParentKeys.map((gk, i) => {
		const fkField = grandParentKeyBinding[i];
		return `${gk} = (SELECT ${fkField} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`;
	}).join(' AND ');

	const parts = [];
	for (const oid of grandParentObjectIDs) {
		const query = SELECT.one.from(grandParentEntity.name).columns(oid.name).where(grandParentWhereSubquery);
		// Since we're using a raw WHERE string, we need to construct this manually
		const selectSQL = `SELECT ${oid.name} FROM ${utils.transformName(grandParentEntity.name)} WHERE ${grandParentWhereSubquery}`;
		parts.push(`COALESCE(TO_NVARCHAR((${selectSQL})), '')`);
	}

	const concatLogic = parts.join(" || ', ' || ");
	const grandParentKeyExpr = grandParentKeyBinding.map((k) =>
		`TO_NVARCHAR((SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere}))`
	).join(" || '||' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${grandParentKeyExpr})`;
}

function buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName) {
	return `SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();`;
}

function buildParentLookupOrCreateSQL(compositionParentContext) {
	const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
	return `${buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName)}
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;`;
}

function buildCompositionOnlyBody(entityName, compositionParentContext, prefixSQL = '') {
	const { declares } = compositionParentContext;
	const prefix = prefixSQL ? `\n\t\t${prefixSQL}` : '';
	return `${declares}
	IF ${getSkipCheckCondition(entityName)} THEN${prefix}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
	END IF;`;
}


function buildTriggerContext(entity, objectIDs, rowRef, compositionParentInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	return {
		entityKeyExpr: keys.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || "),
		objectIDExpr: buildObjectIDExpr(objectIDs, entity, rowRef),
		parentLookupExpr: compositionParentInfo !== null ? 'parent_id' : null
	};
}

function buildInsertSQL(entity, columns, modification, ctx) {
	// Generate single UNION ALL query for all changed columns
	const unionQuery = columns.map((col) => {
		const whereCondition = getWhereCondition(col, modification);
		const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
		let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

		// For composition-of-one columns, add deduplication check to prevent duplicate entries
		// when child trigger has already created a composition entry for this transaction
		if (col.type === 'cds.Composition' && ctx.entityKeyExpr) {
			fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${entity.name}'
			AND entityKey = ${ctx.entityKeyExpr}
			AND attribute = '${col.name}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		)`;
		}

		const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'old');
		const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'new');
		const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old');
		const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new');

		return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY WHERE ${fullWhere}`;
	}).join('\nUNION ALL\n');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			${ctx.parentLookupExpr},
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'${entity.name}',
			${ctx.entityKeyExpr},
			${ctx.objectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'${modification}',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);`;
}

function wrapInSkipCheck(entityName, insertSQL, compositionParentContext = null) {
	if (compositionParentContext) {
		const { declares } = compositionParentContext;
		return `${declares}
	IF ${getSkipCheckCondition(entityName)} THEN
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
	}
	return `IF ${getSkipCheckCondition(entityName)} THEN
		${insertSQL}
	END IF;`;
}

function generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'new', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new', grandParentCompositionInfo)
		: null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'create', ctx);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

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

function generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'new', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new', grandParentCompositionInfo)
		: null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'update', ctx);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap((c) => {
		if (!c.target) return [c.name];
		if (c.foreignKeys) return c.foreignKeys.map((k) => `${c.name}_${k.replaceAll(/\./g, '_')}`);
		if (c.on) return c.on.map((m) => m.foreignKeyField);
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

function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, 'old', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', grandParentCompositionInfo)
		: null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		body = buildCompositionOnlyBody(entity.name, compositionParentContext);
	} else {
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		body = wrapInSkipCheck(entity.name, insertSQL, compositionParentContext);
	}

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

function generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map((k) => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");

	const ctx = buildTriggerContext(entity, objectIDs, 'old', compositionParentInfo);

	const deleteSQL = `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey = ${entityKey};`;

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo
		? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old', grandParentCompositionInfo)
		: null;

	// Special wrapping for delete - need variable declared if using composition
	let body;
	if (columns.length === 0 && compositionParentContext) {
		// Composition-only case: only insert composition parent entry, no child column inserts
		body = buildCompositionOnlyBody(entity.name, compositionParentContext, deleteSQL);
	} else if (compositionParentContext) {
		// Mixed case: both composition parent entry and child column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		const { declares } = compositionParentContext;
		body = `${declares}
	IF ${getSkipCheckCondition(entity.name)} THEN
		${deleteSQL}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
	} else {
		// No composition: standard delete with column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		body = wrapInSkipCheck(entity.name, `${deleteSQL}\n\t\t${insertSQL}`);
	}

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
	const rootEntityKeyExpr = binding.map((k) => `TO_NVARCHAR(:${refRow}.${k})`).join(" || '||' || ");

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

/**
 * Builds context for composition of one parent changelog entry.
 * In composition of one, the parent entity has FK to the child (e.g., BookStores.registry_ID -> BookStoreRegistry.ID)
 * So we need to do a reverse lookup: find the parent record that has FK pointing to this child.
 */
function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	// Build the FK field names on the parent that point to this child
	// For composition of one, CAP generates <compositionName>_<childKey> fields
	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);

	// Build WHERE clause to find the parent entity that has this child
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = :${rowRef}.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeyExpr = parentKeys.map((pk) =>
		`TO_NVARCHAR((SELECT ${pk} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}))`
	).join(" || '||' || ");

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) =>
			`(SELECT ${oid.name} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`
		);
		rootObjectIDExpr = oidSelects.length > 1
			? oidSelects.join(" || ', ' || ")
			: oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

	// Add parent_modification to declares for dynamic determination
	const declares = 'DECLARE parent_id NVARCHAR(36); DECLARE parent_modification NVARCHAR(10);';

	// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
	// Note: For composition of one, we check if a composition entry already exists for this transaction
	// to avoid duplicates when both parent UPDATE and child DELETE triggers fire
	const insertSQL = `
		SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO parent_modification
			FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND modification = 'create'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				parent_id,
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				parent_modification,
				CURRENT_UPDATE_TRANSACTION()
			FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY
			WHERE EXISTS (
				SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
			)
			AND NOT EXISTS (
				SELECT 1 FROM SAP_CHANGELOG_CHANGES
				WHERE entity = '${parentEntityName}'
				AND entityKey = ${parentKeyExpr}
				AND attribute = '${compositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND transactionID = CURRENT_UPDATE_TRANSACTION()
			);`;

	return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
}

/**
 * Builds context for composition parent changelog entry (used in merged child triggers).
 * When grandParentCompositionInfo is provided:
 * 1. First creates a grandparent composition entry (e.g., Order.orderItems) for the current transaction if needed
 * 2. Then creates the parent composition entry (e.g., OrderItem.notes) linking to the grandparent entry
 * This ensures changes bubble up to the root entity in each transaction.
 * 
 * Returns:
 * - declares: DECLARE statements (must be at beginning of trigger body)
 * - insertSQL: The logic to check/create grandparent and create parent entries
 * - parentEntityName, compositionFieldName, parentKeyExpr: For use in wrapInSkipCheck
 */
function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef, grandParentCompositionInfo = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef);
	}

	const parentKeyExpr = parentKeyBinding.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef);

	let declares = 'DECLARE parent_id NVARCHAR(36);';
	let insertSQL;

	if (grandParentCompositionInfo) {
		// When we have grandparent info, we need to:
		// 1. Create grandparent entry (Order.orderItems) for current transaction if not exists
		// 2. Create parent entry (OrderItem.notes) linking to the grandparent entry
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build grandparent key expression by looking up from parent entity
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = :${rowRef}.${parentKeyBinding[i]}`).join(' AND ');
		const grandParentKeyExpr = grandParentKeyBinding.map((k) => `TO_NVARCHAR((SELECT ${k} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere}))`).join(" || '||' || ");

		// Build grandparent objectID expression
		const grandParentEntity = model.definitions[grandParentEntityName];
		const grandParentObjectIDs = utils.getObjectIDs(grandParentEntity, model);
		const grandParentObjectIDExpr = grandParentObjectIDs?.length > 0
			? buildGrandParentObjectIDExpr(grandParentObjectIDs, grandParentEntity, parentEntityName, parentKeyBinding, grandParentKeyBinding, rowRef)
			: grandParentKeyExpr;

		// Add grandparent_id to declares
		declares = 'DECLARE parent_id NVARCHAR(36);\n\tDECLARE grandparent_id NVARCHAR(36);';

		insertSQL = `SELECT MAX(ID) INTO grandparent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${grandParentEntityName}'
			AND entityKey = ${grandParentKeyExpr}
			AND attribute = '${grandParentCompositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF grandparent_id IS NULL THEN
			grandparent_id := SYSUUID;
			INSERT INTO SAP_CHANGELOG_CHANGES
				(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES (
					grandparent_id,
					NULL,
					'${grandParentCompositionFieldName}',
					'${grandParentEntityName}',
					${grandParentKeyExpr},
					${grandParentObjectIDExpr},
					CURRENT_TIMESTAMP,
					SESSION_CONTEXT('APPLICATIONUSER'),
					'cds.Composition',
					'update',
					CURRENT_UPDATE_TRANSACTION()
				);
		END IF;
		
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (
				parent_id,
				grandparent_id,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				'${modification}',
				CURRENT_UPDATE_TRANSACTION()
			);`;
	} else {
		// Add parent_modification to declares for dynamic determination
		declares = 'DECLARE parent_id NVARCHAR(36);\n\tDECLARE parent_modification NVARCHAR(10);';

		// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
		// This handles both deep insert (parent created in same tx) and independent insert (parent already existed)
		insertSQL = `-- Determine modification: 'create' if parent was created in this transaction, otherwise 'update'
		SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO parent_modification
			FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND modification = 'create'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (
				parent_id,
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${rootObjectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				parent_modification,
				CURRENT_UPDATE_TRANSACTION()
			);`;
	}

	return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
}

/**
 * Finds composition parent info for an entity (checks if root entity has a @changelog annotation on a composition field pointing to this entity)
 */
function getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations) {
	if (!rootEntity) return null;

	for (const [elemName, elem] of Object.entries(rootEntity.elements)) {
		if (elem.type !== 'cds.Composition' || elem.target !== entity.name) continue;

		// Check if this composition has @changelog annotation
		const changelogAnnotation = rootMergedAnnotations?.elementAnnotations?.[elemName] ?? elem['@changelog'];
		if (!changelogAnnotation) continue;

		// Found a tracked composition - get the FK binding from child to parent
		const parentKeyBinding = utils.getCompositionParentBinding(entity, rootEntity);
		if (!parentKeyBinding) continue;

		// Handle both array bindings (composition of many) and object bindings (composition of one)
		const isCompositionOfOne = parentKeyBinding.type === 'compositionOfOne';
		if (!isCompositionOfOne && parentKeyBinding.length === 0) continue;

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding,
			isCompositionOfOne
		};
	}

	return null;
}

/**
 * Gets grandparent composition info for deep linking of changelog entries.
 * This is used when we need to link a composition's changelog entry to its parent's composition changelog entry.
 */
function getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField) {
	if (!grandParentEntity || !grandParentCompositionField) return null;

	// Check if the grandparent's composition field has @changelog annotation
	const elem = grandParentEntity.elements?.[grandParentCompositionField];
	if (!elem || elem.type !== 'cds.Composition' || elem.target !== rootEntity.name) return null;

	const changelogAnnotation = grandParentMergedAnnotations?.elementAnnotations?.[grandParentCompositionField] ?? elem['@changelog'];
	if (!changelogAnnotation) return null;

	// Get FK binding from rootEntity to grandParentEntity
	const grandParentKeyBinding = utils.getCompositionParentBinding(rootEntity, grandParentEntity);
	if (!grandParentKeyBinding || grandParentKeyBinding.length === 0) return null;

	return {
		grandParentEntityName: grandParentEntity.name,
		grandParentCompositionFieldName: grandParentCompositionField,
		grandParentKeyBinding
	};
}

function generateHANATriggers(csn, entity, rootEntity = null, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	model = csn;
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);

	const objectIDs = utils.getObjectIDs(entity, model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, model, rootMergedAnnotations?.entityAnnotation);

	const keys = utils.extractKeys(entity.keys);
	if (keys.length === 0 && trackedColumns.length > 0) return triggers;

	// Check if this entity is a composition target with @changelog on the composition field
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(
		rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField
	);

	// Skip if no tracked columns and not a composition target with tracked composition
	if (trackedColumns.length === 0 && !compositionParentInfo) return triggers;

	// Generate triggers - either for tracked columns or for composition-only tracking
	if (!config?.disableCreateTracking) {
		triggers.push(generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
	}
	if (!config?.disableUpdateTracking) {
		triggers.push(generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
	}
	if (!config?.disableDeleteTracking) {
		const generateDeleteTriggerFunc = config?.preserveDeletes ? generateDeleteTriggerPreserve : generateDeleteTrigger;
		triggers.push(generateDeleteTriggerFunc(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo));
	}

	return triggers;
}

module.exports = { generateHANATriggers };
