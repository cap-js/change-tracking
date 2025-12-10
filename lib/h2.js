const cds = require('@sap/cds');
const utils = require('./utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
let SQLiteCQN2SQL;

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

function _toSQLite(query) {
    if (!SQLiteCQN2SQL) {
        const SQLiteService = require('@cap-js/sqlite');
        SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model });
    }
    const sqlCQN = cqn4sql(query, cds.model);
    let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
    return unquoteOldNew(sql);
}

// REVISIT: currently just a workaround
function unquoteOldNew(sql) {
	const regex = /'((?:old|new)\.\w+)'/g;
	return sql.replace(regex, '$1');
}

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

function generateH2Trigger(csn, entity, rootEntity) {
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
        const changeCheck = `!Objects.equals(newRow.getObject("${col.name}"), oldRow.getObject("${col.name}"))`;

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

function _getEntityKeys(entity) {
    let keys = [];
    for (const [name, element] of Object.entries(entity.elements)) {
        if (!element.key) continue;
        keys.push(name);
    }
    return keys;
}

function _generateKeyCalculationJava(entity, rootEntity, ref) {
    // extract keys for entity (entity.keys is undefined)
    let keys = _getEntityKeys(entity);
    const entityKeyExp = keys.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');

    let rootKeys = _getEntityKeys(rootEntity || {});
    const rootKeyExp = rootKeys.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');

    return `
        String entityName = "${entity.name}";
        String rootEntityName = "${rootEntity ? rootEntity.name : ''}";
        String entityKey = ${entityKeyExp};
        String objectID = entityKey;
        String rootEntityKey = ${rootKeyExp || null};
        String rootObjectID = rootEntityKey;
    `;
}

function _prepareValueExpression(col, rowVar) {
    if (col.target && col.alt){
        const sql = handleAssocLookup(col, rowVar, entityKey);
        return {
            sqlExpr: sql,
            bindings: []
        }
    } 
    // REVISIT
    if (col.type === 'cds.Boolean') {
        const val = `${rowVar}.getString("${col.name}")`;
        return {
            sqlExpr: `CASE WHEN ? IN ('1', 'TRUE', 'true') THEN 'true' WHEN ? IN ('0', 'FALSE', 'false') THEN 'false' ELSE NULL END`,
            bindings: [val, val]
        };
    }

    if (col.type === 'cds.Association' || col.type === 'cds.Composition') {
        return {
            sqlExpr: '?',
            bindings: [`${rowVar}.getString("${col.name}_${col.foreignKeys[0]}")`]
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

module.exports = { generateH2Trigger };