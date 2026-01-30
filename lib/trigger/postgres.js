const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');

let PostgresCQN2SQL;
let _model;

function _toPostgres(query) {
    if (!PostgresCQN2SQL) {
        const Service = require('@cap-js/postgres');
        PostgresCQN2SQL = new Service.CQN2SQL({ model: _model });
    }
    const sqlCQN = cqn4sql(query, _model);
    let sql = PostgresCQN2SQL.SELECT(sqlCQN);
    return unquoteOldNew(sql);
}

function unquoteOldNew(sql) {
    // Postgres uses "NEW"."col" or NEW.col. 
    // This regex ensures we strip quotes around the table alias if our generator put them there
    // matching 'NEW.col' -> NEW.col
    const regex = /'((?:OLD|NEW)\.\w+)'/gi;
    return sql.replace(regex, '$1');
}

function generatePostgresTriggers(csn, entity, rootEntity) {
    _model = csn;
    PostgresCQN2SQL = null;

    const creates = [];
    const drops = [];
    const trackedColumns = utils.extractTrackedColumns(entity, csn);
    if (trackedColumns.length === 0) return { creates, drops };

    const objectIDs = utils.getObjectIDs(entity, csn);
    const rootObjectIDs = rootEntity ? utils.getObjectIDs(rootEntity, csn) : [];

    // single trigger function that handles Insert, Update, Delete
    // PostgreSQL folds unquoted identifiers to lowercase, so we must use lowercase table names
    const tableName = entity.name.replace(/\./g, '_').toLowerCase();
    const triggerName = `${tableName}_tr_change`;
    const functionName = `${tableName}_func_change`;

    const funcBody = _generateFunctionBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);

    // 1. Create the Function
    const createFunction = `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := '${entity.name}';
        root_entity_name TEXT := '${rootEntity ? rootEntity.name : ''}';
        entity_key TEXT;
        object_id TEXT;
        root_entity_key TEXT := NULL;
        root_object_id TEXT := NULL;
        user_id TEXT := coalesce(current_setting('$user_id', true), 'anonymous');
        transaction_id BIGINT := txid_current();
    BEGIN
        ${funcBody}
        RETURN NULL; -- Result is ignored for AFTER triggers
    END;
    $$ LANGUAGE plpgsql;`;

    creates.push(createFunction);

    // 2. Drop existing trigger if any (must run before CREATE TRIGGER)
    const dropTrigger = `DROP TRIGGER IF EXISTS ${triggerName} ON "${tableName}";`;
    drops.push(dropTrigger);

    // 3. Create the Trigger Binding
    const createTrigger = `CREATE TRIGGER ${triggerName}
    AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `;

    creates.push(createTrigger);

    return { creates, drops };
}

function _generateFunctionBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    // Key Calculation
    const keys = utils.extractKeys(entity.keys);
    const entityKeyExp = `concat_ws('||', ${keys.map(k => `rec.${k}`).join(', ')})`;

    // Root Key Logic
    let rootKeyExp = 'NULL';
    if (rootEntity) {
        const binding = utils.getRootBinding(entity, rootEntity);
        if (binding) {
            rootKeyExp = `concat_ws('||', ${binding.map(k => `rec.${k}`).join(', ')})`;
        }
    }

    // Object ID Logic
    const objectIDExp = _generateObjectIDSelect(objectIDs, entity, keys, 'rec', 'object_id');

    // Root Object ID Logic
    const rootObjectIDExp = rootEntity
        ? _generateRootObjectIDSelect(rootObjectIDs, entity, rootEntity, 'rec', 'root_object_id')
        : 'root_object_id := NULL;';

    // Generate Blocks
    const createBlock = _generateInsertBlock(columns);
    const updateBlock = _generateUpdateBlock(columns);
    const deleteBlock = _generateDeleteBlock(columns);

    return `
        DECLARE
            rec RECORD;
        BEGIN
            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            -- Assign Entity Keys
            entity_key := ${entityKeyExp};
            root_entity_key := ${rootKeyExp};
            -- Object ID Calculation
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

// Helper to prepare value expression based on column type
function _prepareVal(col, recordVar) {
    if (col.type === 'cds.Boolean') {
        // Postgres boolean to string
        return `CASE WHEN ${recordVar}.${col.name} IS TRUE THEN 'true' WHEN ${recordVar}.${col.name} IS FALSE THEN 'false' ELSE NULL END`;
    }

    if (col.target && col.alt) {
        // Association Lookup
        // We reuse the SQLite sub-select logic, but ensure variable is "rec"
        // handleAssocLookup returns (SELECT ... )
        const sql = handleAssocLookup(col, 'rec', 'placeholder');
        // The _toSQLite/Postgres generator usually handles alias quoting. 
        // We just need to ensure the parameters inside are valid.
        return sql;
    }

    if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.foreignKeys) {
        if (col.foreignKeys.length > 1) {
            return col.foreignKeys.map(fk => `${recordVar}.${col.name}_${fk}`).join(" || ' ' || ");
        }
        return `${recordVar}.${col.name}_${col.foreignKeys[0]}`;
    }

    // Default Scalar
    return `${recordVar}.${col.name}::TEXT`;
}

function _generateInsertBlock(columns) {
    return columns.map(col => {
        const val = _prepareVal(col, 'NEW');

        // Null check for insert: don't log if value is null
        // Logic: if it's a scalar, check col directly. If assoc, check foreign key.
        const checkCol = col.foreignKeys ? `${col.name}_${col.foreignKeys[0]}` : col.name;

        return `
        IF (NEW.${checkCol} IS NOT NULL) THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES 
            (gen_random_uuid(), '${col.name}', NULL, ${val}, entity_name, entity_key, object_id, root_entity_name, root_entity_key, root_object_id, now(), user_id, '${col.type}', 'create', transaction_id);
        END IF;`;
    }).join('\n');
}

function _generateUpdateBlock(columns) {
    return columns.map(col => {
        const newVal = _prepareVal(col, 'NEW');
        const oldVal = _prepareVal(col, 'OLD');

        // Determine columns to check for IS DISTINCT FROM (Postgres null-safe comparison)
        let checkCols = [col.name];
        if (col.foreignKeys) checkCols = col.foreignKeys.map(fk => `${col.name}_${fk}`);

        const distinctCheck = checkCols.map(c => `NEW.${c} IS DISTINCT FROM OLD.${c}`).join(' OR ');

        return `
        IF (${distinctCheck}) THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES 
            (gen_random_uuid(), '${col.name}', ${oldVal}, ${newVal}, entity_name, entity_key, object_id, root_entity_name, root_entity_key, root_object_id, now(), user_id, '${col.type}', 'update', transaction_id);
        END IF;`;
    }).join('\n');
}


function _generateDeleteBlock(columns) {
    return columns.map(col => {
        const val = _prepareVal(col, 'OLD');

        const checkCol = col.foreignKeys ? `${col.name}_${col.foreignKeys[0]}` : col.name;

        return `
        IF (OLD.${checkCol} IS NOT NULL) THEN
            INSERT INTO sap_changelog_changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            VALUES 
            (gen_random_uuid(), '${col.name}', ${val}, NULL, entity_name, entity_key, object_id, root_entity_name, root_entity_key, root_object_id, now(), user_id, '${col.type}', 'delete', transaction_id);
        END IF;`;
    }).join('\n');
}


function _generateObjectIDSelect(objectIDs, entity, keys, recVar, targetVar) {
    if (!objectIDs || objectIDs.length === 0) return `${targetVar} := entity_key;`;

    // In Postgres, it is possible to run a SELECT INTO variable
    // If objectID included, use record variable. If sub-select, generate SQL.

    const parts = [];

    for (const oid of objectIDs) {
        if (oid.included) {
            parts.push(`${recVar}.${oid.name}::TEXT`);
        } else {
            // Sub-select needed
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

    // Postgres concat_ws skips nulls, nice for formatting
    return `
    SELECT CONCAT_WS(', ', ${parts.join(', ')}) INTO ${targetVar};
    IF ${targetVar} = '' OR ${targetVar} IS NULL THEN
        ${targetVar} := ${targetVar === 'object_id' ? 'entity_key' : 'root_entity_key'};
    END IF;
    `;
}

function _generateRootObjectIDSelect(rootObjectIDs, childEntity, rootEntity, recVar, targetVar) {
    if (!rootObjectIDs || rootObjectIDs.length === 0) return `${targetVar} := root_entity_key;`;

    const binding = utils.getRootBinding(childEntity, rootEntity);
    if (!binding || binding.length === 0) return `${targetVar} := root_entity_key;`;

    const rootKeys = utils.extractKeys(rootEntity.keys);
    if (rootKeys.length !== binding.length) return `${targetVar} := root_entity_key;`;

    // Build WHERE clause: rootKey = rec.<childFK>
    const where = {};
    for (let i = 0; i < rootKeys.length; i++) {
        where[rootKeys[i]] = { val: `${recVar}.${binding[i]}` };
    }

    // All root object IDs must be fetched via subquery from the root entity
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
    // Similar to SQLite, but we want the SQL string compatible with Postgres
    // Postgres supports "rec.col", so we can use that in the WHERE clause directly.

    const where = column.foreignKeys
        ? column.foreignKeys.reduce((acc, k) => {
            acc[k] = { val: `${refRow}.${column.name}_${k}` };
            return acc;
        }, {})
        : column.on?.reduce((acc, k) => {
            // Assuming simple mapping again
            acc[k] = { val: `${refRow}.${k}` }; // e.g. rec.ID
            return acc;
        }, {});

    const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
    // Use Postgres concat operator || or concat() function
    // utils.buildConcatXpr usually produces standard SQL (||), which works in PG.
    const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

    const query = SELECT.one.from(column.target).columns(columns).where(where);

    let sql = `(${_toPostgres(query)})`;

    // IMPORTANT: Remove quotes around the record variables generated by cqn4sql
    // e.g. WHERE ID = 'rec.ID' -> WHERE ID = rec.ID
    sql = sql.replace(/'(rec\.\w+)'/g, '$1');

    return sql;
}

module.exports = { generatePostgresTriggers };