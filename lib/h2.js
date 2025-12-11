const cds = require('@sap/cds');
const utils = require('./utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;
let model;

function _generateJavaMethod(createBody, updateBody, deleteBody) {
    return `
    import org.h2.tools.TriggerAdapter;
    import java.sql.Connection;
    import java.sql.ResultSet;
    import java.sql.PreparedStatement;
    import java.sql.SQLException;
    import java.util.Objects;

    @CODE
    TriggerAdapter create() {
        return new TriggerAdapter() {
            @Override
            public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
                boolean isInsert = oldRow == null;
                boolean isDelete = newRow == null;
                boolean isUpdate = !isInsert && !isDelete;

                if (isInsert) {
                    ${createBody}
                } else if (isUpdate) {
                    ${updateBody}
                } else if (isDelete) {
                    ${deleteBody}
                }
            }
        };
    }`;
}

function _toSQL(query) {
    if (!SQLiteCQN2SQL) {
        const SQLiteService = require('@cap-js/sqlite');
        SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: model });
    }
    const sqlCQN = cqn4sql(query, model);
    let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
    return sql;
}

function handleAssocLookup(column, refRow, entityKey) {
    let bindings = [];
    let where = {};

    if (column.foreignKeys) {
        where = column.foreignKeys.reduce((acc, k) => {
            acc[k] = { ref: ['?'], param: true };
            return acc;
        }, {});

        // The Java code to get the value
        bindings = column.foreignKeys.map(fk => `${refRow}.getString("${column.name}_${fk}")`);
    } else if (column.on) {
        where = column.on.reduce((acc, k) => {
            acc[k] = { ref: ['?'], param: true };
            return acc;
        }, {});

        bindings = column.on.map(assoc => `${refRow}.getString("${assoc}")`);
    }

    // Build the select columns / Drop the first part of column.alt (association name)
    const alt = column.alt.map(s => s.split('.').slice(1).join('.'));
    const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

    // Build the query
    const query = SELECT.one.from(column.target).columns(columns).where(where);

    // Return the SQL expression and bindings
    return {
        sql: `(${_toSQL(query)})`, // Returns string like: (SELECT ... WHERE ID = ?)
        bindings: bindings            // Returns array like: ['newRow.getString("ID")']
    };
}

function generateH2Trigger(csn, entity, rootEntity) {
    model = csn;
    const trackedColumns = utils.extractTrackedColumns(entity, csn);
    if (trackedColumns.length === 0) return [];

    const objectIDs = utils.getObjectIDs(entity, csn);
    const rootObjectIDs = rootEntity ? utils.getObjectIDs(rootEntity) : [];

    // Generate the Java code for each section
    const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs) : '';
    const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs) : '';
    let deleteBody = '';
    if (!config?.disableDeleteTracking) {
        deleteBody = _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);
    }

    // Define the full Create Trigger SQL
    return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct
            AFTER INSERT, UPDATE, DELETE ON ${utils.transformName(entity.name)}
            FOR EACH ROW
            AS $$
            ${_generateJavaMethod(createBody, updateBody, deleteBody)}
            $$;;`;
}

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'newRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference);

    const columnBlocks = columns.map(col => {
        // Prepare Value Expression
        const { sqlExpr, bindings } = _prepareValueExpression(col, reference);

        // SQL Statement
        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', NULL, ${sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`;

        // Bindings: NewVal Bindings + Standard Metadata Bindings
        const allBindings = [
            ...bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        return _wrapInTryCatch(insertSQL, allBindings);
    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'newRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference);

    const columnBlocks = columns.map(col => {
        // Prepare new and old Value
        const newRes = _prepareValueExpression(col, 'newRow');
        const oldRes = _prepareValueExpression(col, 'oldRow');

        // Check column values from ResultSet for Change Logic
        let checkCols = [col.name];
        if (col.foreignKeys && col.foreignKeys.length > 0) {
            checkCols = col.foreignKeys.map(fk => `${col.name}_${fk}`);
        }

        // Generate the Java condition: (col1_new != col1_old || col2_new != col2_old)
        const changeCheck = checkCols.map(dbCol => 
            `!Objects.equals(newRow.getObject("${dbCol}"), oldRow.getObject("${dbCol}"))`
        ).join(' || ');

        // SQL Statement
        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`;

        // Bindings: OldVal + NewVal + Metadata
        const allBindings = [
            ...oldRes.bindings,
            ...newRes.bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        return `if (${changeCheck}) {
            ${_wrapInTryCatch(insertSQL, allBindings)}
        }`;
    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'oldRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference);

    const columnBlocks = columns.map(col => {
        // Prepare Old Value
        const { sqlExpr, bindings } = _prepareValueExpression(col, reference);

        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

        const allBindings = [
            ...bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        return _wrapInTryCatch(insertSQL, allBindings);
    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateKeyCalculationJava(entity, rootEntity, ref) {
    // extract keys for entity (entity.keys is undefined)
    let keys = utils.extractKeys(entity.keys);
    const entityKeyExp = keys.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');

    let rootKeys = rootEntity ? utils.extractKeys(rootEntity.keys) : [];
    const rootKeyExp = rootKeys.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');

    const objectIDs = utils.getObjectIDs(entity, model);
    const objectIDBlock = _generateObjectIDCalculation(objectIDs, entity, ref);

    return `
        String entityName = "${entity.name}";
        String rootEntityName = "${rootEntity ? rootEntity.name : ''}";
        String entityKey = ${entityKeyExp};
        String rootEntityKey = ${rootKeyExp || null};
        ${objectIDBlock}
        String rootObjectID = rootEntityKey;
    `;
}

function _prepareValueExpression(col, rowVar) {
    if (col.target && col.alt) {
        const { sql, bindings } = handleAssocLookup(col, rowVar);
        return { sqlExpr: sql, bindings: bindings };
    }
    // REVISIT
    if (col.type === 'cds.Boolean') {
        const val = `${rowVar}.getString("${col.name}")`;
        return {
            sqlExpr: `CASE WHEN ? IN ('1', 'TRUE', 'true') THEN 'true' WHEN ? IN ('0', 'FALSE', 'false') THEN 'false' ELSE NULL END`,
            bindings: [val, val]
        };
    }

    if ((col.type === 'cds.Association' || col.type === 'cds.Composition') && col.foreignKeys) {
        if (col.foreignKeys.length === 1) {
            // Single foreign key
            return {
                sqlExpr: '?',
                bindings: [`${rowVar}.getString("${col.name}_${col.foreignKeys[0]}")`]
            };
        } else {
            // Composite key handling (concatenation)
            const expr = col.foreignKeys.map(() => '?').join(" || ' ' || ");
            const binds = col.foreignKeys.map(fk => `${rowVar}.getString("${col.name}_${fk}")`);
            return { sqlExpr: expr, bindings: binds };
        }
    }

    // TODO: Add your handleAssocLookup logic here if needed
    // For now, defaulting to scalar string
    return {
        sqlExpr: '?',
        bindings: [`${rowVar}.getString("${col.name}")`]
    };
}

function _wrapInTryCatch(sql, bindings) {
    // Escapes quotes for Java String
    const cleanSql = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');

    const setParams = bindings.map((b, i) => `stmt.setString(${i + 1}, ${b});`).join('\n                ');

    return `try (PreparedStatement stmt = conn.prepareStatement("${cleanSql}")) {
                ${setParams}
                stmt.executeUpdate();
            }`;
}

function _generateObjectIDCalculation(objectIDs, entity, refRow) {
    if (!objectIDs || objectIDs.length === 0) {
        return `String objectID = entityKey;`; // Fallback to Entity Key
    }

    // Build SQL Query for the ObjectID string
    const parts = [];
    const bindings = [];
    const keys = utils.extractKeys(entity.keys);

    for (const oid of objectIDs) {
        if (oid.included) {
            parts.push(`SELECT CAST(? AS VARCHAR) AS val`); 
            bindings.push(`${refRow}.getString("${oid.name}")`);
        } else {
            // Sub-select needed (Lookup)
            const where = keys.reduce((acc, k) => {
                acc[k] = { ref: ['?'], param: true };
                return acc;
            }, {});
            
            const query = SELECT.one.from(entity.name).columns(oid.name).where(where);
            const sql = `(${_toSQL(query)})`;
            
            parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
            
            // Add bindings for the WHERE clause of this sub-select
            keys.forEach(k => bindings.push(`${refRow}.getString("${k}")`));
        }
    }

    // Combine parts into one query that returns a single string
    // H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
    const unionSql = parts.join(' UNION ALL ');
    const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

    // Return Java Code Block
    return `
        String objectID = entityKey;
        try (PreparedStatement stmtOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsOID = stmtOID.executeQuery()) {
                if (rsOID.next()) {
                    String res = rsOID.getString(1);
                    if (res != null) objectID = res;
                }
            }
        }`;
}

module.exports = { generateH2Trigger };