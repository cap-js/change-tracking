const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');

let SQLiteCQN2SQL;
let model;

function _generateJavaMethod(createBody, updateBody, deleteBody, entityName) {
    const entitySkipVar = getEntitySkipVarName(entityName);
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
            private boolean shouldSkipChangeTracking(Connection conn) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @${CT_SKIP_VAR}")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            String value = rs.getString(1);
                            if ("true".equals(value)) return true;
                        }
                    }
                }
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @${entitySkipVar}")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            String value = rs.getString(1);
                            if ("true".equals(value)) return true;
                        }
                    }
                }
                return false;
            }

            private boolean shouldSkipElement(Connection conn, String varName) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @" + varName)) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            String value = rs.getString(1);
                            if ("true".equals(value)) return true;
                        }
                    }
                }
                return false;
            }

            @Override
            public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
                if (shouldSkipChangeTracking(conn)) {
                    return;
                }

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

function generateH2Trigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
    model = csn;
    const { columns: trackedColumns, compositionsOfMany } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
    if (trackedColumns.length === 0 && compositionsOfMany.length === 0) return null;

    const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
    const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

    const triggers = [];

    // Generate main entity trigger if there are tracked columns
    if (trackedColumns.length > 0) {
        // Generate the Java code for each section
        const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs) : '';
        const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs) : '';
        let deleteBody = '';
        if (!config?.disableDeleteTracking) {
            deleteBody = config?.preserveDeletes
                ? _generateDeleteBodyPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs)
                : _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs);
        }

        // Define the full Create Trigger SQL
        triggers.push(`CREATE TRIGGER ${utils.transformName(entity.name)}_ct
            AFTER INSERT, UPDATE, DELETE ON ${utils.transformName(entity.name)}
            FOR EACH ROW
            AS $$
            ${_generateJavaMethod(createBody, updateBody, deleteBody, entity.name)}
            $$;;`);
    }

    // Generate composition of many triggers
    for (const comp of compositionsOfMany) {
        const targetEntity = model.definitions[comp.target];
        if (!targetEntity) continue;

        const compTrigger = _generateCompOfManyTrigger(targetEntity, entity, comp, objectIDs);
        if (compTrigger) {
            triggers.push(compTrigger);
        }
    }

    return triggers.length === 1 ? triggers[0] : (triggers.length > 0 ? triggers : null);
}

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'newRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs);

    const columnBlocks = columns.map(col => {
        // Prepare Value Expression
        const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
        const labelRes = _prepareLabelExpression(col, reference); // label expression 

        // SQL Statement
        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`;

        // Bindings: NewVal Bindings + Standard Metadata Bindings
        const allBindings = [
            ...bindings,
            ...labelRes.bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

        // Element skip check variable name
        const elementSkipVar = getElementSkipVarName(entity.name, col.name);

        // Null Check Wrapper + Element Skip Check
        const valExpression = bindings.map(b => b).join(' != null && ') + ' != null';
        return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;

    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'newRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs);

    const columnBlocks = columns.map(col => {
        // Prepare new and old Value
        const newRes = _prepareValueExpression(col, 'newRow');
        const oldRes = _prepareValueExpression(col, 'oldRow');
        // Prepare new and old Label (lookup values if col.alt exists)
        const newLabelRes = _prepareLabelExpression(col, 'newRow');
        const oldLabelRes = _prepareLabelExpression(col, 'oldRow');

        // Check column values from ResultSet for Change Logic
        let checkCols = [col.name];
        if (col.foreignKeys && col.foreignKeys.length > 0) {
            checkCols = col.foreignKeys.map(fk => `${col.name}_${fk}`);
        } else if (col.on && col.on.length > 0) {
            checkCols = col.on.map(m => m.foreignKeyField);
        }

        // Generate the Java condition: (col1_new != col1_old || col2_new != col2_old)
        const changeCheck = checkCols.map(dbCol =>
            `!Objects.equals(newRow.getObject("${dbCol}"), oldRow.getObject("${dbCol}"))`
        ).join(' || ');

        // SQL Statement
        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`;

        // Bindings: OldVal + NewVal + Metadata
        const allBindings = [
            ...oldRes.bindings,
            ...newRes.bindings,
            ...oldLabelRes.bindings,
            ...newLabelRes.bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        // Element skip check variable name
        const elementSkipVar = getElementSkipVarName(entity.name, col.name);

        return `if ((${changeCheck}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${_wrapInTryCatch(insertSQL, allBindings)}
        }`;
    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'oldRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs);
    
    // First delete existing changelogs for this entity
    const deleteSQL = `DELETE FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ?`;
    const deleteBlock = _wrapInTryCatch(deleteSQL, ['entityName', 'entityKey']);

    // Then insert delete changelog entries for each tracked column
    const columnBlocks = columns.map(col => {
        // Prepare Old Value (raw FK value)
        const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
        // Prepare Old Label (lookup value if col.alt exists)
        const labelRes = _prepareLabelExpression(col, reference);

        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

        const allBindings = [
            ...bindings,
            ...labelRes.bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

        // Element skip check variable name
        const elementSkipVar = getElementSkipVarName(entity.name, col.name);

        // Null Check Wrapper + Element Skip Check
        const valExpression = bindings.map(b => b).join(' != null && ') + ' != null';
        return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;
    }).join('\n');

    return `${keysCalc}
        ${deleteBlock}
        ${columnBlocks}`;
}

function _generateDeleteBodyPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs) {
    const reference = 'oldRow';
    const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs);

    const columnBlocks = columns.map(col => {
        // Prepare Old Value (raw FK value)
        const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
        // Prepare Old Label (lookup value if col.alt exists)
        const labelRes = _prepareLabelExpression(col, reference);

        const insertSQL = `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

        const allBindings = [
            ...bindings,
            ...labelRes.bindings,
            'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
        ];

        const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

        // Element skip check variable name
        const elementSkipVar = getElementSkipVarName(entity.name, col.name);

        // Null Check Wrapper + Element Skip Check
        const valExpression = bindings.map(b => b).join(' != null && ') + ' != null';
        return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;
    }).join('\n');

    return `${keysCalc}\n${columnBlocks}`;
}

function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs) {
    // extract keys for entity (entity.keys is undefined)
    let keys = utils.extractKeys(entity.keys);
    const entityKeyExp = keys.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');

    let rootKeyExp = 'null';
    let rootKeyBlock = '';
    
    if (rootEntity) {
        const binding = utils.getRootBinding(entity, rootEntity);
        if (binding) {
            // Handle composition of one (backlink scenario)
            if (binding.type === 'compositionOfOne') {
                const rootKeys = utils.extractKeys(rootEntity.keys);
                const childKeys = binding.childKeys;
                
                // Build WHERE clause: <compositionName>_<childKey> = ?
                const whereClause = childKeys.map(ck => `${binding.compositionName}_${ck} = ?`).join(' AND ');
                const selectColumns = rootKeys.join(" || '||' || ");
                const selectSQL = `SELECT ${selectColumns} FROM ${utils.transformName(binding.rootEntityName)} WHERE ${whereClause}`;
                const bindings = childKeys.map(ck => `${ref}.getString("${ck}")`);
                
                rootKeyBlock = `
        try (PreparedStatement stmtRK = conn.prepareStatement("${selectSQL.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtRK.setString(${i + 1}, ${b});`).join('\n            ')}
            try (ResultSet rsRK = stmtRK.executeQuery()) {
                if (rsRK.next()) {
                    rootEntityKey = rsRK.getString(1);
                }
            }
        }`;
            } else if (Array.isArray(binding)) {
                // Standard case: direct FK binding on child
                rootKeyExp = binding.map(k => `${ref}.getString("${k}")`).join(' + "||" + ');
            }
        }
    }

    const objectIDs = utils.getObjectIDs(entity, model);
    const objectIDBlock = _generateObjectIDCalculation(objectIDs, entity, ref);
    const rootObjectIDBlock = _generateRootObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity);

    return `
        String entityName = "${entity.name}";
        String rootEntityName = "${rootEntity ? rootEntity.name : ''}";
        String entityKey = ${entityKeyExp};
        String rootEntityKey = ${rootKeyExp};
        ${rootKeyBlock}
        ${objectIDBlock}
        ${rootObjectIDBlock}
    `;
}

function _prepareValueExpression(col, rowVar) {
    // REVISIT
    if (col.type === 'cds.Boolean') {
        const val = `${rowVar}.getString("${col.name}")`;
        return {
            sqlExpr: `CASE WHEN ? IN ('1', 'TRUE', 'true') THEN 'true' WHEN ? IN ('0', 'FALSE', 'false') THEN 'false' ELSE NULL END`,
            bindings: [val, val]
        };
    }

    if (col.target && col.foreignKeys) {
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

    if (col.target && col.on) {
        if (col.on.length === 1) {
            return {
                sqlExpr: '?',
                bindings: [`${rowVar}.getString("${col.on[0].foreignKeyField}")`]
            };
        } else {
            const expr = col.on.map(() => '?').join(" || ' ' || ");
            const binds = col.on.map(m => `${rowVar}.getString("${m.foreignKeyField}")`);
            return { sqlExpr: expr, bindings: binds };
        }
    }

    // Scalar value
    return {
        sqlExpr: '?',
        bindings: [`${rowVar}.getString("${col.name}")`]
    };
}

// Returns label expression for a column
function _prepareLabelExpression(col, rowVar) {
    if (col.target && col.alt) {
        const { sql, bindings } = handleAssocLookup(col, rowVar);
        return { sqlExpr: sql, bindings: bindings };
    }
    // No label for scalars or associations without @changelog override
    return { sqlExpr: 'NULL', bindings: [] };
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
    // fallback to entity name (will be translated via i18nKeys in ChangeView)
    if (!objectIDs || objectIDs.length === 0) {
        return `String objectID = "${entity.name}";`;
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

function _generateRootObjectIDCalculation(rootObjectIDs, rootEntity, refRow, childEntity) {
    if (!rootObjectIDs || rootObjectIDs.length === 0) {
        const rootEntityName = rootEntity ? rootEntity.name : '';
        return `String rootObjectID = "${rootEntityName}";`;
    }

    // Build SQL Query for the RootObjectID string
    const parts = [];
    const bindings = [];
    
    // Check for composition of one scenario
    const binding = childEntity ? utils.getRootBinding(childEntity, rootEntity) : null;
    const isCompositionOfOne = binding && binding.type === 'compositionOfOne';
    
    for (const oid of rootObjectIDs) {
        if (oid.included && !isCompositionOfOne) {
            parts.push(`SELECT CAST(? AS VARCHAR) AS val`);
            bindings.push(`${refRow}.getString("${oid.name}")`);
        } else {
            // Sub-select needed (Lookup)
            let where;
            if (isCompositionOfOne) {
                // For composition of one, use the backlink pattern
                where = binding.childKeys.reduce((acc, ck) => {
                    acc[`${binding.compositionName}_${ck}`] = { ref: ['?'], param: true };
                    return acc;
                }, {});
            } else {
                const rootKeys = utils.extractKeys(rootEntity.keys);
                where = rootKeys.reduce((acc, k) => {
                    acc[k] = { ref: ['?'], param: true };
                    return acc;
                }, {});
            }

            const targetEntity = isCompositionOfOne ? binding.rootEntityName : rootEntity.name;
            const query = SELECT.one.from(targetEntity).columns(oid.name).where(where);
            const sql = `(${_toSQL(query)})`;

            parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);

            // Add bindings for the WHERE clause of this sub-select
            if (isCompositionOfOne) {
                binding.childKeys.forEach(ck => bindings.push(`${refRow}.getString("${ck}")`));
            } else {
                const rootKeys = utils.extractKeys(rootEntity.keys);
                rootKeys.forEach(k => bindings.push(`${refRow}.getString("${k}")`));
            }
        }
    }

    // Combine parts into one query that returns a single string
    // H2 Syntax: SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (...)
    const unionSql = parts.join(' UNION ALL ');
    const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

    // Return Java Code Block
    return `
        String rootObjectID = rootEntityKey;
        try (PreparedStatement stmtROID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtROID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsROID = stmtROID.executeQuery()) {
                if (rsROID.next()) {
                    String res = rsROID.getString(1);
                    if (res != null) rootObjectID = res;
                }
            }
        }`;
}


function _generateCompOfManyJavaMethod(createBody, updateBody, deleteBody, entityName) {
    const entitySkipVar = getEntitySkipVarName(entityName);
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
            private boolean shouldSkipChangeTracking(Connection conn) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @${CT_SKIP_VAR}")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            String value = rs.getString(1);
                            if ("true".equals(value)) return true;
                        }
                    }
                }
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @${entitySkipVar}")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            String value = rs.getString(1);
                            if ("true".equals(value)) return true;
                        }
                    }
                }
                return false;
            }

            @Override
            public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
                if (shouldSkipChangeTracking(conn)) {
                    return;
                }

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


function _generateCompOfManyTrigger(targetEntity, rootEntity, compInfo, rootObjectIDs) {
    // Get FK from target to root (e.g., Books.bookStore_ID -> BookStores.ID)
    const binding = utils.getCompositionParentBinding(targetEntity, rootEntity);
    if (!binding || binding.length === 0) return null;

    const targetTableName = utils.transformName(targetEntity.name);
    const triggerName = `${targetTableName}_ct_comp_${compInfo.name}`;

    // Generate bodies for each operation
    const createBody = !config?.disableCreateTracking 
        ? _generateCompOfManyCreateBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) 
        : '';
    const updateBody = !config?.disableUpdateTracking 
        ? _generateCompOfManyUpdateBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) 
        : '';
    const deleteBody = !config?.disableDeleteTracking 
        ? _generateCompOfManyDeleteBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) 
        : '';

    return `CREATE TRIGGER ${triggerName}
            AFTER INSERT, UPDATE, DELETE ON ${targetTableName}
            FOR EACH ROW
            AS $$
            ${_generateCompOfManyJavaMethod(createBody, updateBody, deleteBody, targetEntity.name)}
            $$;;`;
}


function _generateCompOfManyKeyCalcJava(targetEntity, rootEntity, compInfo, binding, rootObjectIDs, refRow) {
    // entityKey = target entity's own key
    const targetKeys = utils.extractKeys(targetEntity.keys);
    const entityKeyExp = targetKeys.map(k => `${refRow}.getString("${k}")`).join(' + "||" + ');
    
    // rootEntityKey = root's key via FK on target
    const rootEntityKeyExp = binding.map(k => `${refRow}.getString("${k}")`).join(' + "||" + ');
    
    // objectID = value from target row based on alt paths
    const objectIDExp = compInfo.alt && compInfo.alt.length > 0
        ? compInfo.alt.map(p => `${refRow}.getString("${p}")`).join(' + ", " + ')
        : 'null';
    
    // rootObjectID = lookup from root entity
    const rootObjectIDBlock = _generateCompOfManyRootObjectIDCalc(rootEntity, rootObjectIDs, binding, refRow);

    return `
        String entityName = "${rootEntity.name}";
        String rootEntityName = "${rootEntity.name}";
        String entityKey = ${entityKeyExp};
        String rootEntityKey = ${rootEntityKeyExp};
        String objectID = ${objectIDExp};
        ${rootObjectIDBlock}
    `;
}

function _generateCompOfManyRootObjectIDCalc(rootEntity, rootObjectIDs, binding, refRow) {
    if (!rootObjectIDs || rootObjectIDs.length === 0) {
        return `String rootObjectID = "${rootEntity.name}";`;
    }

    const rootKeys = utils.extractKeys(rootEntity.keys);
    if (rootKeys.length !== binding.length) {
        return `String rootObjectID = rootEntityKey;`;
    }

    // Build WHERE: rootKey = ?
    const where = rootKeys.reduce((acc, k) => {
        acc[k] = { ref: ['?'], param: true };
        return acc;
    }, {});

    const parts = [];
    const bindings = [];
    
    for (const oid of rootObjectIDs) {
        const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
        const sql = `(${_toSQL(query)})`;
        parts.push(`SELECT CAST(${sql} AS VARCHAR) AS val`);
        
        // Add bindings for each root key
        for (let i = 0; i < binding.length; i++) {
            bindings.push(`${refRow}.getString("${binding[i]}")`);
        }
    }

    const unionSql = parts.join(' UNION ALL ');
    const finalSql = `SELECT GROUP_CONCAT(val SEPARATOR ', ') FROM (${unionSql}) AS tmp`;

    return `
        String rootObjectID = rootEntityKey;
        try (PreparedStatement stmtROID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtROID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsROID = stmtROID.executeQuery()) {
                if (rsROID.next()) {
                    String res = rsROID.getString(1);
                    if (res != null) rootObjectID = res;
                }
            }
        }`;
}

function _generateCompOfManyCreateBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) {
    const keysCalc = _generateCompOfManyKeyCalcJava(targetEntity, rootEntity, compInfo, binding, rootObjectIDs, 'newRow');

    const insertSQL = `INSERT INTO sap_changelog_Changes 
        (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
        VALUES 
        (RANDOM_UUID(), '${compInfo.name}', NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'create', TRANSACTION_ID())`;

    const tryBlock = _wrapInTryCatch(insertSQL, [
        'objectID',
        'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
    ]);

    return `${keysCalc}
        ${tryBlock}`;
}

function _generateCompOfManyUpdateBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) {
    const keysCalc = _generateCompOfManyKeyCalcJava(targetEntity, rootEntity, compInfo, binding, rootObjectIDs, 'newRow');

    // Get old objectID
    const oldObjectIDExp = compInfo.alt && compInfo.alt.length > 0
        ? compInfo.alt.map(p => `oldRow.getString("${p}")`).join(' + ", " + ')
        : 'null';

    const insertSQL = `INSERT INTO sap_changelog_Changes 
        (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
        VALUES 
        (RANDOM_UUID(), '${compInfo.name}', ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'update', TRANSACTION_ID())`;

    const tryBlock = _wrapInTryCatch(insertSQL, [
        'oldObjectID', 'objectID',
        'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
    ]);

    return `${keysCalc}
        String oldObjectID = ${oldObjectIDExp};
        ${tryBlock}`;
}

function _generateCompOfManyDeleteBody(targetEntity, rootEntity, compInfo, binding, rootObjectIDs) {
    const keysCalc = _generateCompOfManyKeyCalcJava(targetEntity, rootEntity, compInfo, binding, rootObjectIDs, 'oldRow');

    const insertSQL = `INSERT INTO sap_changelog_Changes 
        (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
        VALUES 
        (RANDOM_UUID(), '${compInfo.name}', ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'delete', TRANSACTION_ID())`;

    const tryBlock = _wrapInTryCatch(insertSQL, [
        'objectID',
        'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'
    ]);

    return `${keysCalc}
        ${tryBlock}`;
}

module.exports = { generateH2Trigger };