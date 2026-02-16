const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

let PostgresCQN2SQL;
let _model;

function _getSkipCheckCondition(entityName) {
    const entitySkipVar = getEntitySkipVarName(entityName);
    return `(COALESCE(current_setting('${CT_SKIP_VAR}', true), 'false') != 'true' AND COALESCE(current_setting('${entitySkipVar}', true), 'false') != 'true')`;
}

function _getElementSkipCondition(entityName, elementName) {
    const varName = getElementSkipVarName(entityName, elementName);
    return `COALESCE(current_setting('${varName}', true), 'false') != 'true'`;
}

function _toPostgres(query) {
    if (!PostgresCQN2SQL) {
        const Service = require('@cap-js/postgres');
        PostgresCQN2SQL = new Service.CQN2SQL({ model: _model });
    }
    const sqlCQN = cqn4sql(query, _model);
    let sql = PostgresCQN2SQL.SELECT(sqlCQN);
    return removeQuotes(sql);
}

function removeQuotes(sql) {
    // strip quotes around the table alias: 'NEW.col' -> NEW.col, 'rec.col' -> rec.col
    const regex = /'((?:OLD|NEW|rec)\\.\\w+)'/gi;
    return sql.replace(regex, '$1');
}

function _extractTrackedDbColumns(columns) {
    const dbCols = [];
    for (const col of columns) {
        if (col.foreignKeys && col.foreignKeys.length > 0) {
            col.foreignKeys.forEach(fk => dbCols.push(`${col.name}_${fk}`.toLowerCase()));
        } else if (col.on && col.on.length > 0) {
            col.on.forEach(m => dbCols.push(m.foreignKeyField.toLowerCase()));
        } else {
            dbCols.push(col.name.toLowerCase());
        }
    }
    return [...new Set(dbCols)];
}

function generatePostgresTriggers(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
    _model = csn;
    PostgresCQN2SQL = null;

    const creates = [];
    const drops = [];
    const { columns: trackedColumns, compositionsOfMany } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
    if (trackedColumns.length === 0 && compositionsOfMany.length === 0) return { creates, drops };

    const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
    const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

    // Generate regular column triggers
    if (trackedColumns.length > 0) {
        const tableName = entity.name.replace(/\./g, '_').toLowerCase();
        const triggerName = `${tableName}_tr_change`;
        const functionName = `${tableName}_func_change`;

        const funcBody = _generateFunctionBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);

        const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := '${entity.name}';
        root_entity_name TEXT := '${rootEntity ? rootEntity.name : ''}';
        entity_key TEXT;
        object_id TEXT;
        root_entity_key TEXT := NULL;
        root_object_id TEXT := NULL;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
    BEGIN
        ${funcBody}
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;`;

        creates.push(createFunction);

        const trackedDbColumns = _extractTrackedDbColumns(trackedColumns);
        const updateOfClause = trackedDbColumns.length > 0 ? `UPDATE OF ${trackedDbColumns.join(', ')}` : 'UPDATE';
        const createTrigger = `CREATE TRIGGER ${triggerName}
    AFTER INSERT OR ${updateOfClause} OR DELETE ON "${tableName}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `;

        creates.push(createTrigger);
        drops.push(`DROP TRIGGER IF EXISTS ${triggerName} ON "${tableName}";`);
    }

    // Generate composition of many triggers (triggers on target entity that log changes to this entity)
    for (const comp of compositionsOfMany) {
        const targetEntity = _model.definitions[comp.target];
        if (!targetEntity) continue;

        const compTriggers = _generateCompOfManyTriggers(targetEntity, entity, comp, objectIDs);
        if (compTriggers) {
            creates.push(...compTriggers.creates);
            drops.push(...compTriggers.drops);
        }
    }

    return { creates, drops };
}

function _generateFunctionBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const keys = utils.extractKeys(entity.keys);
    const entityKeyExp = `concat_ws('||', ${keys.map(k => `rec.${k}`).join(', ')})`;

    let rootKeyExp = 'NULL';
    if (rootEntity) {
        const binding = utils.getRootBinding(entity, rootEntity);
        if (binding) {
            // Handle composition of one (backlink scenario)
            if (binding.type === 'compositionOfOne') {
                const rootKeys = utils.extractKeys(rootEntity.keys);
                // Build WHERE: <compositionName>_<childKey> = rec.<childKey>
                const where = {};
                for (const childKey of binding.childKeys) {
                    where[`${binding.compositionName}_${childKey}`] = { val: `rec.${childKey}` };
                }
                // Select root keys concatenated
                const columns = rootKeys.length === 1 
                    ? rootKeys[0] 
                    : utils.buildConcatXpr(rootKeys);
                const query = SELECT.one.from(binding.rootEntityName).columns(columns).where(where);
                rootKeyExp = `(${_toPostgres(query)})`;
            } else if (Array.isArray(binding)) {
                rootKeyExp = `concat_ws('||', ${binding.map(k => `rec.${k}`).join(', ')})`;
            }
        }
    }

    const objectIDExp = _generateObjectIDSelect(objectIDs, entity, keys, 'rec', 'object_id');
    const rootObjectIDExp = rootEntity
        ? _generateRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'rec', 'root_object_id')
        : 'root_object_id := NULL;';

    const createBlock = _generateInsertBlock(columns, 'create', entity);
    const updateBlock = _generateInsertBlock(columns, 'update', entity);
    const deleteBlock = _generateInsertBlock(columns, 'delete', entity);

    return `
        DECLARE
            rec RECORD;
        BEGIN
            -- Check if change tracking should be skipped for this service or entity
            IF NOT ${_getSkipCheckCondition(entity.name)} THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := ${entityKeyExp};
            root_entity_key := ${rootKeyExp};
            ${objectIDExp}
            ${rootObjectIDExp}

            IF (TG_OP = 'INSERT') THEN
                ${createBlock}
            ELSIF (TG_OP = 'UPDATE') THEN
                ${updateBlock}
            ELSIF (TG_OP = 'DELETE') THEN
                ${deleteBlock}
            END IF;
        END;`;
}

function _generateColumnSubquery(col, modification, entity) {
    const whereCondition = _getWhereCondition(col, modification);
    const oldValExp = modification === 'create' ? 'NULL' : _prepareVal(col, 'OLD');
    const newValExp = modification === 'delete' ? 'NULL' : _prepareVal(col, 'NEW');

    // Add element-level skip condition
    const elementSkipCondition = _getElementSkipCondition(entity.name, col.name);
    const fullWhereCondition = `(${whereCondition}) AND ${elementSkipCondition}`;

    return `SELECT '${col.name}' AS attribute, ${oldValExp} AS valueChangedFrom, ${newValExp} AS valueChangedTo, '${col.type}' AS valueDataType WHERE ${fullWhereCondition}`;
}

function _getWhereCondition(col, modification) {
    if (modification === 'update') {
        let checkCols;
        if (col.foreignKeys) {
            checkCols = col.foreignKeys.map(fk => `${col.name}_${fk}`);
        } else if (col.on) {
            checkCols = col.on.map(m => m.foreignKeyField);
        } else {
            checkCols = [col.name];
        }
        return checkCols.map(c => `NEW.${c} IS DISTINCT FROM OLD.${c}`).join(' OR ');
    } else {
        const rowRef = modification === 'create' ? 'NEW' : 'OLD';
        if (col.foreignKeys) {
            return col.foreignKeys.map(fk => `${rowRef}.${col.name}_${fk} IS NOT NULL`).join(' OR ');
        } else if (col.on) {
            return col.on.map(m => `${rowRef}.${m.foreignKeyField} IS NOT NULL`).join(' OR ');
        }
        return `${rowRef}.${col.name} IS NOT NULL`;
    }
}

// Generates INSERT INTO ... SELECT FROM (UNION ALL ...) for all columns
function _generateInsertBlock(columns, modification, entity) {
    if (!config || (modification === 'create' && config.disableCreateTracking) ||
        (modification === 'update' && config.disableUpdateTracking) ||
        (modification === 'delete' && config.disableDeleteTracking)) {
        return '';
    }

    if (modification === 'delete' && !config?.preserveDeletes) {
        const keys = utils.extractKeys(entity.keys);
        const entityKey = keys.map(k => `OLD.${k}::TEXT`).join(" || '||' || ");
        
        // First delete existing changelogs, then insert delete logs
        const deleteSQL = `DELETE FROM sap_changelog_changes WHERE entity = '${entity.name}' AND entitykey = ${entityKey};`;
        
        const unionMembers = columns.map(col => _generateColumnSubquery(col, modification, entity));
        const unionQuery = unionMembers.join('\n            UNION ALL\n            ');
        
        const insertSQL = `INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                attribute,
                valueChangedFrom,
                valueChangedTo,
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
        
        return `${deleteSQL}\n            ${insertSQL}`;
    }

    const unionMembers = columns.map(col => _generateColumnSubquery(col, modification, entity));
    const unionQuery = unionMembers.join('\n            UNION ALL\n            ');

    return `INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                attribute,
                valueChangedFrom,
                valueChangedTo,
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

function _prepareVal(col, recordVar) {
    if (col.type === 'cds.Boolean') {
        return `CASE WHEN ${recordVar}.${col.name} IS TRUE THEN 'true' WHEN ${recordVar}.${col.name} IS FALSE THEN 'false' ELSE NULL END`;
    }

    if (col.target && col.alt) {
        return handleAssocLookup(col, recordVar);
    }

    if (col.target && col.foreignKeys) {
        if (col.foreignKeys.length > 1) {
            return col.foreignKeys.map(fk => `${recordVar}.${col.name}_${fk}::TEXT`).join(" || ' ' || ");
        }
        return `${recordVar}.${col.name}_${col.foreignKeys[0]}::TEXT`;
    }

    if (col.target && col.on) {
        return col.on.map(m => `${recordVar}.${m.foreignKeyField}::TEXT`).join(" || ' ' || ");
    }

    return `${recordVar}.${col.name}::TEXT`;
}

function _generateObjectIDSelect(objectIDs, entity, keys, recVar, targetVar) {
    // fallback to entity name when no @changelog annotation
    if (!objectIDs || objectIDs.length === 0) return `${targetVar} := '${entity.name}';`;

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
            let sql = `(${_toPostgres(query)})`;
            sql = sql.replace(/'(rec\.\w+)'/g, '$1');
            parts.push(`COALESCE((${sql})::TEXT, '')`);
        }
    }

    return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := ${targetVar === 'object_id' ? 'entity_key' : 'root_entity_key'};
    END IF;
    `;
}

function _generateRootObjectIDSelect(rootObjectIDs, childEntity, rootEntity, recVar, targetVar) {
    if (!rootObjectIDs || rootObjectIDs.length === 0) return `${targetVar} := '${rootEntity.name}';`;

    const binding = utils.getRootBinding(childEntity, rootEntity);
    if (!binding) return `${targetVar} := root_entity_key;`;

    // Handle composition of one (backlink scenario)
    if (binding.type === 'compositionOfOne') {
        // Build WHERE: <compositionName>_<childKey> = rec.<childKey>
        const where = {};
        for (const childKey of binding.childKeys) {
            where[`${binding.compositionName}_${childKey}`] = { val: `${recVar}.${childKey}` };
        }

        const parts = [];
        for (const oid of rootObjectIDs) {
            const query = SELECT.one.from(binding.rootEntityName).columns(oid.name).where(where);
            let sql = _toPostgres(query);
            sql = sql.replace(/'(rec\.\w+)'/g, '$1');
            parts.push(`COALESCE((${sql})::TEXT, '')`);
        }

        return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := root_entity_key;
    END IF;
    `;
    }

    // Standard case: child has FK to root
    if (!Array.isArray(binding) || binding.length === 0) return `${targetVar} := root_entity_key;`;

    const rootKeys = utils.extractKeys(rootEntity.keys);
    if (rootKeys.length !== binding.length) return `${targetVar} := root_entity_key;`;

    const where = {};
    for (let i = 0; i < rootKeys.length; i++) {
        where[rootKeys[i]] = { val: `${recVar}.${binding[i]}` };
    }

    const parts = [];
    for (const oid of rootObjectIDs) {
        const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
        let sql = _toPostgres(query);
        sql = sql.replace(/'(rec\.\w+)'/g, '$1');
        parts.push(`COALESCE((${sql})::TEXT, '')`);
    }

    return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := root_entity_key;
    END IF;
    `;
}

function handleAssocLookup(column, refRow) {
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

    const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
    const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

    const query = SELECT.one.from(column.target).columns(columns).where(where);

    let sql = `(${_toPostgres(query)})`;
    sql = sql.replace(/'(rec\.\w+)'/g, '$1');
    sql = sql.replace(/'((?:OLD|NEW)\.\w+)'/g, '$1');

    return sql;
}

function _getCompOfManyObjectID(altPaths, refRow) {
    if (!altPaths || altPaths.length === 0) return 'NULL';
    
    if (altPaths.length === 1) {
        return `${refRow}.${altPaths[0]}::TEXT`;
    }
    
    // Concatenate multiple paths
    return `CONCAT_WS(', ', ${altPaths.map(p => `${refRow}.${p}::TEXT`).join(', ')})`;
}

function _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow) {
    if (!rootObjectIDs || rootObjectIDs.length === 0) return `'${rootEntity.name}'`;
    
    // Build WHERE: rootKey = refRow.<FK>
    const rootKeys = utils.extractKeys(rootEntity.keys);
    if (rootKeys.length !== binding.length) return `'${rootEntity.name}'`;
    
    const where = {};
    for (let i = 0; i < rootKeys.length; i++) {
        where[rootKeys[i]] = { val: `${refRow}.${binding[i]}` };
    }
    
    const parts = [];
    for (const oid of rootObjectIDs) {
        const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
        let sql = _toPostgres(query);
        sql = sql.replace(/'((?:OLD|NEW|rec)\.\w+)'/gi, '$1');
        parts.push(`COALESCE((${sql})::TEXT, '')`);
    }
    
    const concatLogic = `CONCAT_WS(', ', ${parts.join(', ')})`;
    
    // Build fallback rootEntityKey expression
    const rootEntityKeyExpr = `CONCAT_WS('||', ${binding.map(k => `${refRow}.${k}::TEXT`).join(', ')})`;
    
    return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function _generateCompOfManyTriggers(targetEntity, rootEntity, compInfo, rootObjectIDs) {
    // Get FK from target to root (e.g., Books.bookStore_ID -> BookStores.ID)
    const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
    if (!binding || binding.length === 0) return null;

    const targetTableName = targetEntity.name.replace(/\./g, '_').toLowerCase();
    const triggerName = `${targetTableName}_tr_comp_${compInfo.name}`;
    const functionName = `${targetTableName}_func_comp_${compInfo.name}`;

    const targetKeys = utils.extractKeys(targetEntity.keys);
    const entityKeyExpr = `CONCAT_WS('||', ${targetKeys.map(k => `rec.${k}::TEXT`).join(', ')})`;
    const rootEntityKeyExpr = `CONCAT_WS('||', ${binding.map(k => `rec.${k}::TEXT`).join(', ')})`;

    const objectIDNew = _getCompOfManyObjectID(compInfo.alt, 'NEW');
    const objectIDOld = _getCompOfManyObjectID(compInfo.alt, 'OLD');
    const objectIDRec = _getCompOfManyObjectID(compInfo.alt, 'rec');
    
    // rootObjectID = lookup from root entity
    const rootObjectIDExpr = _getCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, 'rec');

    const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        rec RECORD;
        entity_key TEXT;
        root_entity_key TEXT;
        object_id TEXT;
        root_object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
    BEGIN
        -- Check if change tracking should be skipped
        IF NOT ${_getSkipCheckCondition(targetEntity.name)} THEN
            RETURN NULL;
        END IF;

        IF (TG_OP = 'DELETE') THEN
            rec := OLD;
        ELSE
            rec := NEW;
        END IF;

        entity_key := ${entityKeyExpr};
        root_entity_key := ${rootEntityKeyExpr};
        object_id := ${objectIDRec};
        root_object_id := ${rootObjectIDExpr};

        IF (TG_OP = 'INSERT') THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES (
                gen_random_uuid(),
                '${compInfo.name}',
                NULL,
                ${objectIDNew},
                '${rootEntity.name}',
                entity_key,
                object_id,
                '${rootEntity.name}',
                root_entity_key,
                root_object_id,
                now(),
                user_id,
                'cds.Composition',
                'create',
                transaction_id
            );
        ELSIF (TG_OP = 'UPDATE') THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES (
                gen_random_uuid(),
                '${compInfo.name}',
                ${objectIDOld},
                ${objectIDNew},
                '${rootEntity.name}',
                entity_key,
                object_id,
                '${rootEntity.name}',
                root_entity_key,
                root_object_id,
                now(),
                user_id,
                'cds.Composition',
                'update',
                transaction_id
            );
        ELSIF (TG_OP = 'DELETE') THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES (
                gen_random_uuid(),
                '${compInfo.name}',
                ${objectIDOld},
                NULL,
                '${rootEntity.name}',
                entity_key,
                object_id,
                '${rootEntity.name}',
                root_entity_key,
                root_object_id,
                now(),
                user_id,
                'cds.Composition',
                'delete',
                transaction_id
            );
        END IF;

        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;`;

    const createTrigger = `CREATE TRIGGER ${triggerName}
    AFTER INSERT OR UPDATE OR DELETE ON "${targetTableName}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `;

    return {
        creates: [createFunction, createTrigger],
        drops: [`DROP TRIGGER IF EXISTS ${triggerName} ON "${targetTableName}";`]
    };
}

module.exports = { generatePostgresTriggers };
