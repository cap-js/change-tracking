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

	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
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
	return keys.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
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
		return binding.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
	}
	return 'NULL';
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
function buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, rowRef, compositionParentInfo = null) {
	return {
		entityKeyExpr: buildEntityKeyExpr(entity, rowRef),
		rootEntityKeyExpr: buildRootEntityKeyExpr(entity, rootEntity, rowRef),
		objectIDExpr: buildObjectIDExpr(objectIDs, entity, rowRef),
		rootObjectIDExpr: buildRootObjectIDExpr(rootObjectIDs, entity, rootEntity, rowRef),
		rootEntityValue: rootEntity ? `'${rootEntity.name}'` : 'NULL',
		parentLookupExpr: compositionParentInfo !== null ? 'parent_id' : null
	};
}

/**
 * Generates INSERT SQL for changelog entries from UNION query
 */
function buildInsertSQL(entity, columns, modification, ctx) {
	const unionQuery = columns.map((col) => buildColumnSubquery(col, modification, entity)).join('\nUNION ALL\n');

	return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification, transactionID)
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
 * When compositionParentContext is provided, handles "check-then-insert" logic for composition parent:
 * 1. Uses SELECT INTO with MAX to check for existing parent entry (MAX returns NULL if none found)
 * 2. Only inserts parent entry if none exists (IF parent_id IS NULL)
 * This ensures only ONE composition parent entry per transaction, even with multiple child inserts.
 */
function wrapInSkipCheck(entityName, insertSQL, compositionParentContext = null) {
	if (compositionParentContext) {
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		return `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entityName)} THEN
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
		${insertSQL}
	END IF;`;
	}
	return `IF ${getSkipCheckCondition(entityName)} THEN
		${insertSQL}
	END IF;`;
}

/**
 * Generates CREATE trigger for INSERT events
 * When compositionParentInfo is provided, this trigger will also create the composition changelog entry first.
 */
function generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'new', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'create', 'new') : null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		body = `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entity.name)} THEN
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
	END IF;`;
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

/**
 * Generates UPDATE trigger
 */
function generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'new', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'update', 'new') : null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		body = `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entity.name)} THEN
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
	END IF;`;
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

/**
 * Generates DELETE trigger (preserves history)
 */
function generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'old', compositionParentInfo);

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old') : null;

	// Handle composition-only triggers (no tracked columns, only composition parent entry)
	let body;
	if (columns.length === 0 && compositionParentContext) {
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		body = `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entity.name)} THEN
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
	END IF;`;
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

/**
 * Generates DELETE trigger (clears history first)
 */
function generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map((k) => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");

	const ctx = buildTriggerContext(entity, objectIDs, rootEntity, rootObjectIDs, 'old', compositionParentInfo);

	const deleteSQL = `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey = ${entityKey};`;

	// Build context for composition parent entry if this is a tracked composition target
	const compositionParentContext = compositionParentInfo ? buildCompositionParentContext(compositionParentInfo, rootObjectIDs, 'delete', 'old') : null;

	// Special wrapping for delete - need variable declared if using composition
	let body;
	if (columns.length === 0 && compositionParentContext) {
		// Composition-only case: only insert composition parent entry, no child column inserts
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		body = `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entity.name)} THEN
		${deleteSQL}
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
	END IF;`;
	} else if (compositionParentContext) {
		// Mixed case: both composition parent entry and child column inserts
		const insertSQL = buildInsertSQL(entity, columns, 'delete', ctx);
		const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr } = compositionParentContext;
		body = `DECLARE parent_id NVARCHAR(36);
	IF ${getSkipCheckCondition(entity.name)} THEN
		${deleteSQL}
		SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
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
 * Builds context for composition parent changelog entry (used in merged child triggers).
 */
function buildCompositionParentContext(compositionParentInfo, rootObjectIDs, modification, rowRef) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const parentKeyExpr = parentKeyBinding.map((k) => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, rowRef);

	const insertSQL = `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		VALUES (
			parent_id,
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

	return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
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
		if (!parentKeyBinding || parentKeyBinding.length === 0) continue;

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding
		};
	}

	return null;
}

function generateHANATriggers(csn, entity, rootEntity = null, mergedAnnotations = null, rootMergedAnnotations = null) {
	model = csn;
	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);

	const objectIDs = utils.getObjectIDs(entity, model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, model, rootMergedAnnotations?.entityAnnotation);

	const keys = utils.extractKeys(entity.keys);
	if (keys.length === 0 && trackedColumns.length > 0) return triggers;

	// Check if this entity is a composition target with @changelog on the composition field
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Skip if no tracked columns and not a composition target with tracked composition
	if (trackedColumns.length === 0 && !compositionParentInfo) return triggers;

	// Generate triggers - either for tracked columns or for composition-only tracking
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

	return triggers;
}

module.exports = { generateHANATriggers };
