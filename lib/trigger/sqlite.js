const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;

function _getSkipCheckCondition(entityName) {
	const entitySkipVar = getEntitySkipVarName(entityName);
	return `(COALESCE(session_context('${CT_SKIP_VAR}'), 'false') != 'true' AND COALESCE(session_context('${entitySkipVar}'), 'false') != 'true')`;
}

function _getElementSkipCondition(entityName, elementName) {
	const varName = getElementSkipVarName(entityName, elementName);
	return `COALESCE(session_context('${varName}'), 'false') != 'true'`;
}

function _toSQLite(query) {
	if (!SQLiteCQN2SQL) {
		const SQLiteService = require('@cap-js/sqlite');
		SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model });
	}
	const sqlCQN = cqn4sql(query, cds.model);
	let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
	return removeSingleQuotes(sql);
}

function removeSingleQuotes(sql) {
	return sql.replace(/'((?:old|new)\.\w+)'/g, '$1');
}


function generateSQLiteTriggers(entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
	const triggers = [];
	const { columns: trackedColumns, compositionsOfMany } = utils.extractTrackedColumns(entity, cds.model, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, cds.model, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, cds.model, rootMergedAnnotations?.entityAnnotation);

	// Generate regular column triggers
	if (trackedColumns.length > 0) {
		if (!config?.disableCreateTracking) {
			triggers.push(_generateCreateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		}

		if (!config?.disableUpdateTracking) {
			triggers.push(_generateUpdateTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs));
		}

		if (!config?.disableDeleteTracking) {
			let deleteTrigger = config?.preserveDeletes
				? _generateDeleteTriggerPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs)
				: _generateDeleteTrigger(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);
			triggers.push(deleteTrigger);
		}
	}

	// Generate composition of many triggers (triggers on target entity that log changes to this entity)
	for (const comp of compositionsOfMany) {
		const targetEntity = cds.model.definitions[comp.target];
		if (!targetEntity) continue;

		if (!config?.disableCreateTracking) {
			triggers.push(_generateCompOfManyCreateTrigger(targetEntity, entity, comp, objectIDs));
		}
		if (!config?.disableUpdateTracking) {
			triggers.push(_generateCompOfManyUpdateTrigger(targetEntity, entity, comp, objectIDs));
		}
		if (!config?.disableDeleteTracking) {
			triggers.push(_generateCompOfManyDeleteTrigger(targetEntity, entity, comp, objectIDs));
		}
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

function _considerLargeString(val) {
	return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN SUBSTR(${val}, 1, 4997) || '...' ELSE ${val} END`;
}

/**
 * Returns WHERE condition for a column based on modification type
 * - CREATE/DELETE: checks if value is not null
 * - UPDATE: checks if value changed (using IS NOT comparison)
 */
function _getWhereCondition(col, modification) {
	if (modification === 'update') {
		// Check if value changed
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map(fk => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
		} else if (col.target && col.on?.length) {
			return col.on.map(m => `old.${m.foreignKeyField} IS NOT new.${m.foreignKeyField}`).join(' OR ');
		}
		return `old.${col.name} IS NOT new.${col.name}`;
	} else {
		// CREATE or DELETE: check value is not null
		const rowRef = modification === 'create' ? 'new' : 'old';
		if (col.target && col.foreignKeys?.length) {
			return col.foreignKeys.map(fk => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
		} else if (col.target && col.on?.length) {
			return col.on.map(m => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
		}
		return `${rowRef}.${col.name} IS NOT NULL`;
	}
}

/**
 * Returns the value expression for a column
 */
function _getValueExpression(col, refRow, entityKey) {
	if (col.target && col.alt) {
		// Association lookup using inline SELECT
		return handleAssocLookup(col, refRow, entityKey);
	} else if (col.type === 'cds.Boolean') {
		return `CASE ${refRow}.${col.name} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
	} else if (col.target && col.foreignKeys?.length) {
		// Concatenate foreign keys for managed associations
		return col.foreignKeys.map(fk => `${refRow}.${col.name}_${fk}`).join(" || '||' || ");
	} else if (col.target && col.on?.length) {
		// Concatenate foreign key fields for unmanaged associations
		return col.on.map(m => `${refRow}.${m.foreignKeyField}`).join(" || '||' || ");
	} else {
		// Scalar value
		let raw = `${refRow}.${col.name}`;
		if (col.type === 'cds.String') {
			raw = _considerLargeString(raw);
		}
		return raw;
	}
}

/**
 * Generates a single UNION member subquery for a column
 */
function _generateColumnSubquery(col, modification, entity, entityKey) {
	const whereCondition = _getWhereCondition(col, modification);
	const oldValExp = _getValueExpression(col, 'old', entityKey);
	const newValExp = _getValueExpression(col, 'new', entityKey);

	const valueFrom = modification === 'create' ? 'NULL' : oldValExp;
	const valueTo = modification === 'delete' ? 'NULL' : newValExp;

	// Add element-level skip condition
	const elementSkipCondition = _getElementSkipCondition(entity.name, col.name);
	const fullWhereCondition = `(${whereCondition}) AND ${elementSkipCondition}`;

	return `SELECT '${col.name}' AS attribute, ${valueFrom} AS valueChangedFrom, ${valueTo} AS valueChangedTo, '${col.type}' AS valueDataType WHERE ${fullWhereCondition}`;
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	// fallback to entity name when no @changelog annotation
	if (objectIDs.length === 0) return `'${entityName}'`;
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
	if (rootObjectIDs.length === 0) return `'${rootEntity.name}'`

	const binding = utils.getRootBinding(childEntity, rootEntity)
	if (!binding) return null

	// Handle composition of one (backlink scenario)
	if (binding.type === 'compositionOfOne') {
		// Build WHERE: <compositionName>_<childKey> = refRow.<childKey>
		const where = {}
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${refRow}.${childKey}` }
		}

		// Prepare subselects for each root objectID candidate
		for (const oid of rootObjectIDs) {
			const q = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where)
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

	// Standard case: child has FK to root
	if (!Array.isArray(binding) || binding.length === 0) return null

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
	
	// Handle composition of one
	if (binding.type === 'compositionOfOne') {
		const rootKeys = utils.extractKeys(rootEntity.keys)
		// Build WHERE: <compositionName>_<childKey> = refRow.<childKey>
		const where = {}
		for (const childKey of binding.childKeys) {
			where[`${binding.compositionName}_${childKey}`] = { val: `${refRow}.${childKey}` }
		}
		// Select root keys concatenated
		const columns = rootKeys.length === 1 
			? rootKeys[0] 
			: utils.buildConcatXpr(rootKeys)
		const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where)
		return `(${_toSQLite(query)})`
	}
	
	// Standard case: direct FK binding on child
	return binding.map(k => `${refRow}.${k}`).join(" || '||' || ")
}

function _generateCreateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'create', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_create AFTER INSERT
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateUpdateTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'new');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'new') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'update', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	// Build OF clause for targeted update trigger
	const ofColumns = columns.flatMap(c => {
		if (!c.target) return [c.name];
		// use foreignKeys for managed associations and on for unmanaged
		if (c.foreignKeys) return c.foreignKeys.map(k => `${c.name}_${k}`);
		if (c.on) return c.on.map(m => `${c.name}_${m.foreignKeyField}`);
		return [];
	});
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateDeleteTriggerPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'old');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'old') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// Build UNION ALL subqueries for each column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

function _generateDeleteTrigger(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
	const keys = utils.extractKeys(entity.keys);
	const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const rootEntityKey = _rootKeyFromChild(entity, rootEntity, 'old');
	const rootObjectID = rootEntity
		? _getRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'old') ?? rootEntityKey
		: null;
	const rootEntityValue = rootEntity ? `'${rootEntity.name}'` : 'NULL';

	// First delete existing changelogs for this entity
	const deleteSQL = `DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};`;

	// Then insert delete changelog entries for each tracked column
	const unionMembers = columns.map(col => _generateColumnSubquery(col, 'delete', entity, entityKey));
	const unionQuery = unionMembers.join('\nUNION ALL\n');

	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		SELECT
			hex(randomblob(16)),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			'${entity.name}',
			${entityKey},
			${objectID},
			${rootEntityValue},
			${rootEntityKey ?? 'NULL'},
			${rootObjectID ?? 'NULL'},
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete'
		FROM (
			${unionQuery}
		);`;

	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct_delete AFTER DELETE
    ON ${utils.transformName(entity.name)}
    WHEN ${_getSkipCheckCondition(entity.name)}
    BEGIN
        ${deleteSQL}
        ${insertSQL}
    END;`;
}

// ============================================================================
// Composition of Many Trigger Generators
// ============================================================================

/**
 * Build objectID expression for composition of many from the target entity's row
 * @param {Array} altPaths - Array of field paths on target entity (e.g., ['title'])
 * @param {string} refRow - 'new' or 'old'
 * @returns {string} SQL expression for objectID
 */
function _getCompOfManyObjectID(altPaths, refRow) {
	if (!altPaths || altPaths.length === 0) return 'NULL';
	
	if (altPaths.length === 1) {
		return `${refRow}.${altPaths[0]}`;
	}
	
	// Concatenate multiple paths
	return altPaths.map(p => `${refRow}.${p}`).join(" || ', ' || ");
}

/**
 * Build rootObjectID select for composition of many
 * Looks up the root entity's objectID via FK from target
 */
function _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) return `'${rootEntity.name}'`;
	
	// Build WHERE: rootKey = refRow.<FK>
	const rootKeys = utils.extractKeys(rootEntity.keys);
	if (rootKeys.length !== binding.length) return `'${rootEntity.name}'`;
	
	const where = {};
	for (let i = 0; i < rootKeys.length; i++) {
		where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
	}
	
	// Clone rootObjectIDs to avoid mutating the original
	const oids = rootObjectIDs.map(o => ({ ...o }));
	
	// Build subselects for each rootObjectID
	for (const oid of oids) {
		const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
		oid.selectSQL = _toSQLite(q);
	}
	
	const unions = oids.map(oid => `SELECT (${oid.selectSQL}) AS value`).join('\nUNION ALL\n');
	
	return `(
    SELECT GROUP_CONCAT(value, ', ')
    FROM (
      ${unions}
    )
  )`;
}

/**
 * Generate CREATE trigger for composition of many
 * Fires on INSERT to target entity (Books), logs change with:
 *   entity = ROOT entity (BookStores), entityKey = target's key (bookID)
 *   valueChangedTo = target's objectID (e.g., book title)
 *   rootEntity = root (BookStores), rootEntityKey = root's key via FK
 */
function _generateCompOfManyCreateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_ct_comp_${compInfo.name}_create`;
	
	// Get FK from target to root (e.g., Books.bookStore_ID -> BookStores.ID)
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// entityKey = target entity's own key (the book's ID)
	const targetKeys = utils.extractKeys(targetEntity.keys);
	const entityKey = targetKeys.map(k => `new.${k}`).join(" || '||' || ");
	
	// rootEntityKey = root's key via FK on target
	const rootEntityKey = binding.map(k => `new.${k}`).join(" || '||' || ");
	
	// objectID = value from target row based on alt paths (e.g., new.title)
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'new');
	
	// rootObjectID = lookup from root entity
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');
	
	// valueChangedTo = the objectID (title) for create operations
	const valueChangedTo = objectID;
	
	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		VALUES (
			hex(randomblob(16)),
			'${compInfo.name}',
			NULL,
			${valueChangedTo},
			'${rootEntity.name}',
			${entityKey},
			${objectID},
			'${rootEntity.name}',
			${rootEntityKey},
			${rootObjectID},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'create'
		);`;

	return `CREATE TRIGGER ${triggerName} AFTER INSERT
    ON ${targetTableName}
    WHEN ${_getSkipCheckCondition(targetEntity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

/**
 * Generate UPDATE trigger for composition of many
 */
function _generateCompOfManyUpdateTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_ct_comp_${compInfo.name}_update`;
	
	// Get FK from target to root
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// entityKey = target entity's own key
	const targetKeys = utils.extractKeys(targetEntity.keys);
	const entityKey = targetKeys.map(k => `new.${k}`).join(" || '||' || ");
	
	// rootEntityKey = root's key via FK on target
	const rootEntityKey = binding.map(k => `new.${k}`).join(" || '||' || ");
	
	// objectID = value from target row based on alt paths
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'new');
	const oldObjectID = _getCompOfManyObjectID(compInfo.alt, 'old');
	
	// rootObjectID = lookup from root entity
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'new');
	
	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		VALUES (
			hex(randomblob(16)),
			'${compInfo.name}',
			${oldObjectID},
			${objectID},
			'${rootEntity.name}',
			${entityKey},
			${objectID},
			'${rootEntity.name}',
			${rootEntityKey},
			${rootObjectID},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update'
		);`;

	return `CREATE TRIGGER ${triggerName} AFTER UPDATE
    ON ${targetTableName}
    WHEN ${_getSkipCheckCondition(targetEntity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

/**
 * Generate DELETE trigger for composition of many
 */
function _generateCompOfManyDeleteTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
	const targetTableName = utils.transformName(targetEntity.name);
	const triggerName = `${targetTableName}_ct_comp_${compInfo.name}_delete`;
	
	// Get FK from target to root
	const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
	if (!binding || binding.length === 0) return null;
	
	// entityKey = target entity's own key (use 'old' for delete)
	const targetKeys = utils.extractKeys(targetEntity.keys);
	const entityKey = targetKeys.map(k => `old.${k}`).join(" || '||' || ");
	
	// rootEntityKey = root's key via FK on target
	const rootEntityKey = binding.map(k => `old.${k}`).join(" || '||' || ");
	
	// objectID = value from target row based on alt paths
	const objectID = _getCompOfManyObjectID(compInfo.alt, 'old');
	
	// rootObjectID = lookup from root entity
	const rootObjectID = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'old');
	
	const insertSQL = `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, rootEntity, rootEntityKey, rootObjectID, createdAt, createdBy, valueDataType, modification)
		VALUES (
			hex(randomblob(16)),
			'${compInfo.name}',
			${objectID},
			NULL,
			'${rootEntity.name}',
			${entityKey},
			${objectID},
			'${rootEntity.name}',
			${rootEntityKey},
			${rootObjectID},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'delete'
		);`;

	return `CREATE TRIGGER ${triggerName} AFTER DELETE
    ON ${targetTableName}
    WHEN ${_getSkipCheckCondition(targetEntity.name)}
    BEGIN
        ${insertSQL}
    END;`;
}

module.exports = {
	generateSQLiteTriggers
};
