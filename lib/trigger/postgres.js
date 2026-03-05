const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('./TriggerCQN2SQL');

let PostgresCQN2SQL;
let model;

function toSQL(query) {
	if (!PostgresCQN2SQL) {
		const Service = require('@cap-js/postgres');
		const TriggerCQN2SQL = createTriggerCQN2SQL(Service.CQN2SQL);
		PostgresCQN2SQL = new TriggerCQN2SQL({ model });
	}
	const sqlCQN = cqn4sql(query, model);
	return PostgresCQN2SQL.SELECT(sqlCQN);
}

function getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(current_setting('${CT_SKIP_VAR}', true), 'false') != 'true' AND COALESCE(current_setting('${entitySkipVar}', true), 'false') != 'true')`;
}

function getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(current_setting('${varName}', true), 'false') != 'true'`;
}

/**
 * Truncates large strings: CASE WHEN LENGTH(val) > 5000 THEN LEFT(val, 4997) || '...' ELSE val END
 */
function wrapLargeString(val) {
	return `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns SQL expression for a column's raw value
 */
function getValueExpr(col, refRow) {
	if (col.type === 'cds.Boolean') {
		return `CASE WHEN ${refRow}.${col.name} IS TRUE THEN 'true' WHEN ${refRow}.${col.name} IS FALSE THEN 'false' ELSE NULL END`;
	}
	if (col.target && col.foreignKeys) {
		if (col.foreignKeys.length > 1) {
			return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}::TEXT`).join(" || ' ' || ");
		}
		return `${refRow}.${col.name}_${col.foreignKeys[0]}::TEXT`;
	}
	if (col.target && col.on) {
		return col.on.map((m) => `${refRow}.${m.foreignKeyField}::TEXT`).join(" || ' ' || ");
	}
	// Apply truncation for String and LargeString types
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') {
		return wrapLargeString(`${refRow}.${col.name}::TEXT`);
	}
	return `${refRow}.${col.name}::TEXT`;
}

/**
 * Returns SQL WHERE condition for detecting column changes
 */
function getWhereCondition(col, modification) {
	if (modification === 'update') {
		const checkCols = col.foreignKeys ? col.foreignKeys.map((fk) => `${col.name}_${fk}`) : col.on ? col.on.map((m) => m.foreignKeyField) : [col.name];
		return checkCols.map((c) => `NEW.${c} IS DISTINCT FROM OLD.${c}`).join(' OR ');
	}
	// CREATE or DELETE: check value is not null
	const rowRef = modification === 'create' ? 'NEW' : 'OLD';
	if (col.foreignKeys) {
		return col.foreignKeys.map((fk) => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
	}
	if (col.on) {
		return col.on.map((m) => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
	}
	return `${rowRef}.${col.name} IS NOT NULL`;
}

/**
 * Builds scalar subselect for association label lookup with locale support
 */
function buildAssocLookup(column, refRow) {
	let where = {};
	if (column.foreignKeys) {
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${column.name}_${k}` };
			return acc;
		}, {});
	} else if (column.on) {
		where = column.on.reduce((acc, mapping) => {
			acc[mapping.targetKey] = { val: `${refRow}.${mapping.foreignKeyField}` };
			return acc;
		}, {});
	}

	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check for localization
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);
	if (localizedInfo) {
		const textsWhere = { ...where, locale: { func: 'current_setting', args: [{ val: 'cap.locale' }, { val: true }] } };
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
function getLabelExpr(col, refRow) {
	if (col.target && col.alt) {
		return buildAssocLookup(col, refRow);
	}
	return 'NULL';
}

/**
 * Builds PL/pgSQL statement for objectID assignment
 */
function buildObjectIDAssignment(objectIDs, entity, keys, recVar, targetVar) {
	if (!objectIDs || objectIDs.length === 0) {
		return `${targetVar} := '${entity.name}';`;
	}

	const parts = [];
	for (const oid of objectIDs) {
		if (oid.included) {
			parts.push(`${recVar}.${oid.name}::TEXT`);
		} else {
			const where = keys.reduce((acc, k) => {
				acc[k] = { val: `${recVar}.${k}` };
				return acc;
			}, {});
			const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
			parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
		}
	}

	const fallback = targetVar === 'object_id' ? 'entity_key' : 'root_entity_key';
	return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := ${fallback};
    END IF;
    `;
}

/**
 * Builds PL/pgSQL statement for root objectID assignment
 */
function buildRootObjectIDAssignment(rootObjectIDs, childEntity, rootEntity, recVar, targetVar) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		return `${targetVar} := '${rootEntity.name}';`;
	}

	const binding = utils.getRootBinding(childEntity, rootEntity);
	if (!binding) return `${targetVar} := root_entity_key;`;

	let where = {};

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${recVar}.${childKey}` };
		}

		const parts = [];
		for (const oid of rootObjectIDs) {
			const query = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where);
			parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
		}

		return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := root_entity_key;
    END IF;
    `;
	}

	// Standard case: child has FK to root
	if (!Array.isArray(binding) || binding.length === 0) {
		return `${targetVar} := root_entity_key;`;
	}

	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) {
		return `${targetVar} := root_entity_key;`;
	}

	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${recVar}.${binding[i]}` };
	}

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
	}

	return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := root_entity_key;
    END IF;
    `;
}

/**
 * Builds root entity key expression
 */
function buildRootKeyExpr(entity, rootEntity, recVar) {
	if (!rootEntity) return 'NULL';

	const binding = utils.getRootBinding(entity, rootEntity);
	if (!binding) return 'NULL';

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		const rootKeys = utils.extractKeys(rootEntity.keys);
		const where = {};
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${recVar}.${childKey}` };
		}
		const columns = rootKeys.length === 1 ? rootKeys[0] : utils.buildConcatXpr(rootKeys);
		const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where);
		return `(${toSQL(query)})`;
	}

	if (Array.isArray(binding)) {
		return `concat_ws('||', ${binding.map((k) => `${recVar}.${k}`).join(', ')})`;
	}

	return 'NULL';
}

function buildColumnSubquery(col, modification, entity) {
	const whereCondition = getWhereCondition(col, modification);
	const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
	let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

	// For composition-of-one columns, add deduplication check to prevent duplicate entries
	// when child trigger has already created a composition entry for this transaction
	if (col.type === 'cds.Composition') {
		fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM sap_changelog_changes
			WHERE entity = '${entity.name}'
			AND entitykey = entity_key
			AND attribute = '${col.name}'
			AND valuedatatype = 'cds.Composition'
			AND transactionid = transaction_id
		)`;
	}

	const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'OLD');
	const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'NEW');
	const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'OLD');
	const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'NEW');

	return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${col.type}' AS valueDataType WHERE ${fullWhere}`;
}

/**
 * Generates INSERT SQL for changelog entries from UNION query
 */
function buildInsertSQL(columns, modification, entity, hasCompositionParent = false) {
	const unionQuery = columns.map((col) => buildColumnSubquery(col, modification, entity)).join('\n            UNION ALL\n            ');
	const parentIdValue = hasCompositionParent ? 'comp_parent_id' : 'NULL';

	return `INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                ${parentIdValue},
                attribute,
                valueChangedFrom,
                valueChangedTo,
                valueChangedFromLabel,
                valueChangedToLabel,
                entity_name,
                entity_key,
                object_id,
                root_entity_name,
                root_entity_key,
                root_object_id,
                now(),
                user_id,
                valueDataType,
                '${modification}',
                transaction_id
            FROM (
            ${unionQuery}
            ) AS changes;`;
}

/**
 * Generates INSERT block for a modification type (with config check)
 */
function buildInsertBlock(columns, modification, entity, hasCompositionParent = false) {
	if (!config || (modification === 'create' && config.disableCreateTracking) || (modification === 'update' && config.disableUpdateTracking) || (modification === 'delete' && config.disableDeleteTracking)) {
		return '';
	}

	if (modification === 'delete' && !config?.preserveDeletes) {
		const keys = utils.extractKeys(entity.keys);
		const entityKey = keys.map((k) => `OLD.${k}::TEXT`).join(" || '||' || ");
		const deleteSQL = `DELETE FROM sap_changelog_changes WHERE entity = '${entity.name}' AND entitykey = ${entityKey};`;
		return `${deleteSQL}\n            ${buildInsertSQL(columns, modification, entity, hasCompositionParent)}`;
	}

	return buildInsertSQL(columns, modification, entity, hasCompositionParent);
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
		if (!parentKeyBinding) continue;

		// Handle composition of one (parent has FK to child - reverse lookup needed)
		if (parentKeyBinding.type === 'compositionOfOne') {
			return {
				parentEntityName: rootEntity.name,
				compositionFieldName: elemName,
				parentKeyBinding // Pass the full object for special handling
			};
		}

		// Handle composition of many (child has FK to parent - normal case)
		if (parentKeyBinding.length === 0) continue;

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding
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

function buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
	const { compositionName, childKeys } = parentKeyBinding;

	const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
	const parentEntity = model.definitions[parentEntityName];
	const parentKeys = utils.extractKeys(parentEntity.keys);
	const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = rec.${childKeys[i]}`).join(' AND ');

	// Build the parent key expression via subquery (reverse lookup)
	const parentKeyExpr = `CONCAT_WS('||', ${parentKeys.map((pk) => `(SELECT ${pk}::TEXT FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`).join(', ')})`;

	// Build rootObjectID expression for the parent entity
	let rootObjectIDExpr;
	if (rootObjectIDs?.length > 0) {
		const oidSelects = rootObjectIDs.map((oid) => `(SELECT ${oid.name}::TEXT FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
		rootObjectIDExpr = oidSelects.length > 1 ? `CONCAT_WS(', ', ${oidSelects.join(', ')})` : oidSelects[0];
	} else {
		rootObjectIDExpr = parentKeyExpr;
	}

	// Build the composition parent block with dynamic modification determination
	return `SELECT CASE WHEN COUNT(*) > 0 THEN 'create' ELSE 'update' END INTO comp_parent_modification
                FROM sap_changelog_changes
                WHERE entity = '${parentEntityName}'
                AND entitykey = ${parentKeyExpr}
                AND modification = 'create'
                AND transactionid = transaction_id;
            
            IF EXISTS (SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}) THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND attribute = '${compositionFieldName}'
                    AND valuedatatype = 'cds.Composition'
                    AND transactionid = transaction_id;
                IF comp_parent_id IS NULL THEN
                    comp_parent_id := gen_random_uuid();
                    INSERT INTO sap_changelog_changes
                        (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                        VALUES (
                            comp_parent_id,
                            NULL,
                            '${compositionFieldName}',
                            '${parentEntityName}',
                            ${parentKeyExpr},
                            ${rootObjectIDExpr},
                            now(),
                            user_id,
                            'cds.Composition',
                            comp_parent_modification,
                            transaction_id
                        );
                END IF;
            END IF;`;
}

function buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, modification, grandParentCompositionInfo = null) {
	const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;

	// Handle composition of one (parent has FK to child - need reverse lookup)
	if (parentKeyBinding.type === 'compositionOfOne') {
		return buildCompositionOfOneParentBlock(compositionParentInfo, rootObjectIDs);
	}

	const parentKeyExpr = `CONCAT_WS('||', ${parentKeyBinding.map((k) => `rec.${k}::TEXT`).join(', ')})`;

	// Build rootObjectID expression for the parent entity
	const rootEntity = model.definitions[parentEntityName];
	const rootObjectIDExpr = buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, parentKeyBinding, 'rec');

	let grandparentBlock = '';
	let grandparentLookupExpr = 'NULL';

	if (grandParentCompositionInfo) {
		// When we have grandparent info, we need to:
		// 1. Create grandparent entry (Order.orderItems) for current transaction if not exists
		// 2. Create parent entry (OrderItem.notes) linking to the grandparent entry
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build WHERE clause to find the parent entity record
		const parentEntity = model.definitions[parentEntityName];
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const parentWhere = parentKeys.map((pk, i) => `${pk} = rec.${parentKeyBinding[i]}`).join(' AND ');

		// Build the grandparent key expression from the parent record
		const grandParentKeyExpr = `CONCAT_WS('||', ${grandParentKeyBinding.map((k) => `(SELECT ${k}::TEXT FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhere})`).join(', ')})`;

		// Create grandparent entry if not exists in this transaction
		grandparentBlock = `-- First ensure grandparent entry exists for this transaction
            SELECT id INTO comp_grandparent_id FROM sap_changelog_changes WHERE entity = '${grandParentEntityName}'
                AND entitykey = ${grandParentKeyExpr}
                AND attribute = '${grandParentCompositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_grandparent_id IS NULL THEN
                comp_grandparent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_grandparent_id,
                        NULL,
                        '${grandParentCompositionFieldName}',
                        '${grandParentEntityName}',
                        ${grandParentKeyExpr},
                        ${grandParentKeyExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;`;

		grandparentLookupExpr = 'comp_grandparent_id';
	}

	// Determine modification dynamically: 'create' if parent was just created, 'update' otherwise
	// This handles both deep insert (parent created in same tx) and independent insert (parent already existed)
	const modificationExpr = grandParentCompositionInfo
		? `'${modification}'` // When grandparent exists, use provided modification
		: `CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END`;

	// PL/pgSQL block that checks for existing parent entry and creates one if needed
	return `${grandparentBlock}
            SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                AND entitykey = ${parentKeyExpr}
                AND attribute = '${compositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        ${grandparentLookupExpr},
                        '${compositionFieldName}',
                        '${parentEntityName}',
                        ${parentKeyExpr},
                        ${rootObjectIDExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        ${modificationExpr},
                        transaction_id
                    );
            END IF;`;
}

/**
 * Extracts database column names from tracked columns (for UPDATE OF clause)
 */
function extractTrackedDbColumns(columns) {
	const dbCols = [];
	for (const col of columns) {
		if (col.foreignKeys && col.foreignKeys.length > 0) {
			col.foreignKeys.forEach((fk) => dbCols.push(`${col.name}_${fk}`.toLowerCase()));
		} else if (col.on && col.on.length > 0) {
			col.on.forEach((m) => dbCols.push(m.foreignKeyField.toLowerCase()));
		} else {
			dbCols.push(col.name.toLowerCase());
		}
	}
	return [...new Set(dbCols)];
}

/**
 * Generates the PL/pgSQL function body for the main change tracking trigger
 */
function buildFunctionBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const keys = utils.extractKeys(entity.keys);
	const entityKeyExpr = `concat_ws('||', ${keys.map((k) => `rec.${k}`).join(', ')})`;
	const rootKeyExpr = buildRootKeyExpr(entity, rootEntity, 'rec');

	const objectIDAssignment = buildObjectIDAssignment(objectIDs, entity, keys, 'rec', 'object_id');
	const rootObjectIDAssignment = rootEntity ? buildRootObjectIDAssignment(rootObjectIDs, entity, rootEntity, 'rec', 'root_object_id') : 'root_object_id := NULL;';

	const hasCompositionParent = compositionParentInfo !== null;
	const createBlock = columns.length > 0 ? buildInsertBlock(columns, 'create', entity, hasCompositionParent) : '';
	const updateBlock = columns.length > 0 ? buildInsertBlock(columns, 'update', entity, hasCompositionParent) : '';
	const deleteBlock = columns.length > 0 ? buildInsertBlock(columns, 'delete', entity, hasCompositionParent) : '';

	// Build composition parent blocks if needed
	const createParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'create', grandParentCompositionInfo) : '';
	const updateParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'update', grandParentCompositionInfo) : '';
	const deleteParentBlock = compositionParentInfo ? buildCompositionParentBlock(compositionParentInfo, rootObjectIDs, 'delete', grandParentCompositionInfo) : '';

	return `
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT ${getSkipCheckCondition(entity.name)} THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := ${entityKeyExpr};
            root_entity_key := ${rootKeyExpr};
            ${objectIDAssignment}
            ${rootObjectIDAssignment}

            IF (TG_OP = 'INSERT') THEN
                ${createParentBlock}
                ${createBlock}
            ELSIF (TG_OP = 'UPDATE') THEN
                ${updateParentBlock}
                ${updateBlock}
            ELSIF (TG_OP = 'DELETE') THEN
                ${deleteParentBlock}
                ${deleteBlock}
            END IF;
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

	const parts = [];
	for (const oid of rootObjectIDs) {
		const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		parts.push(`COALESCE((${toSQL(query)})::TEXT, '')`);
	}

	const concatLogic = `CONCAT_WS(', ', ${parts.join(', ')})`;
	const rootEntityKeyExpr = `CONCAT_WS('||', ${binding.map((k) => `${refRow}.${k}::TEXT`).join(', ')})`;

	return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function generatePostgresTriggers(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	model = csn;
	PostgresCQN2SQL = null;

	const triggers = [];
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
	if (!shouldGenerateTriggers) return triggers;

	const tableName = entity.name.replace(/\./g, '_').toLowerCase();
	const triggerName = `${tableName}_tr_change`;
	const functionName = `${tableName}_func_change`;

	const funcBody = buildFunctionBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);

	// Include comp_parent_id, comp_parent_modification and comp_grandparent_id variable declarations if needed
	const parentIdDecl = compositionParentInfo ? 'comp_parent_id UUID := NULL;' : '';
	const parentModificationDecl = compositionParentInfo?.parentKeyBinding?.type === 'compositionOfOne' ? 'comp_parent_modification TEXT;' : '';
	const grandparentIdDecl = grandParentCompositionInfo ? 'comp_grandparent_id UUID := NULL;' : '';

	const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := '${entity.name}';
        root_entity_name TEXT := ${rootEntity ? `'${rootEntity.name}'` : 'NULL'};
        entity_key TEXT;
        object_id TEXT;
        root_entity_key TEXT := NULL;
        root_object_id TEXT := NULL;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        ${parentIdDecl}
        ${parentModificationDecl}
        ${grandparentIdDecl}
    BEGIN
        ${funcBody}
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;`;

	triggers.push(createFunction);

	const trackedDbColumns = extractTrackedDbColumns(trackedColumns);
	const updateOfClause = trackedDbColumns.length > 0 ? `UPDATE OF ${trackedDbColumns.join(', ')}` : 'UPDATE';
	const createTrigger = `CREATE OR REPLACE TRIGGER ${triggerName}
    AFTER INSERT OR ${updateOfClause} OR DELETE ON "${tableName}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `;

	triggers.push(createTrigger);

	return triggers;
}

module.exports = { generatePostgresTriggers };
