const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('./TriggerCQN2SQL');

let SQLiteCQN2SQL;
let model;

function _generateJavaMethod(createBody, updateBody, deleteBody, entityName, compositionParentInfo = null) {
	const entitySkipVar = getEntitySkipVarName(entityName);

	// Add parent ID helper method if needed
	const parentIdHelper = compositionParentInfo
		? `
            private String ensureCompositionParentEntry(Connection conn, String parentEntityKey, String objectID, String modification) throws SQLException {
                String parentId = null;
                long transactionId = getTransactionId(conn);
                
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${compositionParentInfo.parentEntityName}");
                    stmt.setString(2, parentEntityKey);
                    stmt.setString(3, "${compositionParentInfo.compositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            parentId = rs.getString(1);
                        }
                    }
                }
                
                if (parentId == null) {
                    parentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', ?, ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, parentId);
                        stmt.setString(2, "${compositionParentInfo.compositionFieldName}");
                        stmt.setString(3, "${compositionParentInfo.parentEntityName}");
                        stmt.setString(4, parentEntityKey);
                        stmt.setString(5, objectID);
                        stmt.setString(6, modification);
                        stmt.setLong(7, transactionId);
                        stmt.executeUpdate();
                    }
                }
                
                return parentId;
            }

            private long getTransactionId(Connection conn) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT TRANSACTION_ID()")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            return rs.getLong(1);
                        }
                    }
                }
                return 0;
            }
`
		: '';

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

            private String getLocale(Connection conn) throws SQLException {
                try (PreparedStatement stmt = conn.prepareStatement("SELECT @\\$user.locale")) {
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            return rs.getString(1);
                        }
                    }
                }
                return null;
            }
${parentIdHelper}
            @Override
            public void fire(Connection conn, ResultSet oldRow, ResultSet newRow) throws SQLException {
                if (shouldSkipChangeTracking(conn)) {
                    return;
                }
                String locale = getLocale(conn);

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
		const TriggerCQN2SQL = createTriggerCQN2SQL(SQLiteService.CQN2SQL);
		SQLiteCQN2SQL = new TriggerCQN2SQL({ model: model });
	}
	const sqlCQN = cqn4sql(query, model);
	return SQLiteCQN2SQL.SELECT(sqlCQN);
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

function handleAssocLookup(column, refRow) {
	let bindings = [];
	let where = {};

	if (column.foreignKeys) {
		where = column.foreignKeys.reduce((acc, k) => {
			acc[k] = { ref: ['?'], param: true };
			return acc;
		}, {});
		bindings = column.foreignKeys.map((fk) => `${refRow}.getString("${column.name}_${fk}")`);
	} else if (column.on) {
		where = column.on.reduce((acc, k) => {
			acc[k] = { ref: ['?'], param: true };
			return acc;
		}, {});
		bindings = column.on.map((assoc) => `${refRow}.getString("${assoc}")`);
	}

	const alt = column.alt.map((s) => s.split('.').slice(1).join('.'));
	const columns = alt.length === 1 ? alt[0] : utils.buildConcatXpr(alt);

	// Check if target entity has localized data
	const localizedInfo = utils.getLocalizedLookupInfo(column.target, column.alt, model);

	if (localizedInfo) {
		// Build locale-aware lookup: try .texts table first, fall back to base entity
		const textsWhere = { ...where, locale: { ref: ['?'], param: true } };
		const textsQuery = SELECT.one.from(localizedInfo.textsEntity).columns(columns).where(textsWhere);
		const baseQuery = SELECT.one.from(column.target).columns(columns).where(where);

		const textsSQL = _toSQL(textsQuery);
		const baseSQL = _toSQL(baseQuery);

		// Add locale binding (fetched from session variable @$user.locale)
		const textsBindings = [...bindings, 'locale'];
		const baseBindings = [...bindings];

		return {
			sql: `(SELECT COALESCE((${textsSQL}), (${baseSQL})))`,
			bindings: [...textsBindings, ...baseBindings],
			needsLocale: true
		};
	}

	const query = SELECT.one.from(column.target).columns(columns).where(where);

	return {
		sql: `(${_toSQL(query)})`,
		bindings: bindings
	};
}

function generateH2Trigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null) {
	model = csn;
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
	if (!shouldGenerateTriggers) return null;

	// Generate the Java code for each section
	const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo) : '';
	const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo) : '';
	let deleteBody = '';
	if (!config?.disableDeleteTracking) {
		deleteBody = config?.preserveDeletes
			? _generateDeleteBodyPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo)
			: _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo);
	}

	// Define the full Create Trigger SQL
	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct
            AFTER INSERT, UPDATE, DELETE ON ${utils.transformName(entity.name)}
            FOR EACH ROW
            AS $$
            ${_generateJavaMethod(createBody, updateBody, deleteBody, entity.name, compositionParentInfo)}
            $$;;`;
}

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const reference = 'newRow';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo);

	// Composition parent handling
	const parentIdSetup = compositionParentInfo ? `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "create");` : '';

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${keysCalc}\n${parentIdSetup}`;
	}

	const columnBlocks = columns
		.map((col) => {
			// Prepare Value Expression
			const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
			const labelRes = _prepareLabelExpression(col, reference); // label expression

			// SQL Statement - include PARENT_ID if composition parent info exists
			const insertSQL = compositionParentInfo
				? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`;

			// Bindings: ParentId (if applicable) + NewVal Bindings + Standard Metadata Bindings
			const allBindings = compositionParentInfo
				? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID']
				: [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'];

			const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

			// Element skip check variable name
			const elementSkipVar = getElementSkipVarName(entity.name, col.name);

			// Null Check Wrapper + Element Skip Check
			const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';
			return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;
		})
		.join('\n');

	return `${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const reference = 'newRow';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo);

	// Composition parent handling
	const parentIdSetup = compositionParentInfo ? `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "update");` : '';

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${keysCalc}\n${parentIdSetup}`;
	}

	const columnBlocks = columns
		.map((col) => {
			// Prepare new and old Value
			const newRes = _prepareValueExpression(col, 'newRow');
			const oldRes = _prepareValueExpression(col, 'oldRow');
			// Prepare new and old Label (lookup values if col.alt exists)
			const newLabelRes = _prepareLabelExpression(col, 'newRow');
			const oldLabelRes = _prepareLabelExpression(col, 'oldRow');

			// Check column values from ResultSet for Change Logic
			let checkCols = [col.name];
			if (col.foreignKeys && col.foreignKeys.length > 0) {
				checkCols = col.foreignKeys.map((fk) => `${col.name}_${fk}`);
			} else if (col.on && col.on.length > 0) {
				checkCols = col.on.map((m) => m.foreignKeyField);
			}

			// Generate the Java condition: (col1_new != col1_old || col2_new != col2_old)
			const changeCheck = checkCols.map((dbCol) => `!Objects.equals(newRow.getObject("${dbCol}"), oldRow.getObject("${dbCol}"))`).join(' || ');

			// SQL Statement - include PARENT_ID if composition parent info exists
			const insertSQL = compositionParentInfo
				? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`;

			// Bindings: ParentId (if applicable) + OldVal + NewVal + Metadata
			const allBindings = compositionParentInfo
				? ['parentId', ...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID']
				: [...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'];

			// Element skip check variable name
			const elementSkipVar = getElementSkipVarName(entity.name, col.name);

			return `if ((${changeCheck}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${_wrapInTryCatch(insertSQL, allBindings)}
        }`;
		})
		.join('\n');

	return `${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const reference = 'oldRow';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo);

	// First delete existing changelogs for this entity
	const deleteSQL = `DELETE FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ?`;
	const deleteBlock = _wrapInTryCatch(deleteSQL, ['entityName', 'entityKey']);

	// Composition parent handling
	const parentIdSetup = compositionParentInfo ? `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");` : '';

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${keysCalc}\n${deleteBlock}\n${parentIdSetup}`;
	}

	// Then insert delete changelog entries for each tracked column
	const columnBlocks = columns
		.map((col) => {
			// Prepare Old Value (raw FK value)
			const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
			// Prepare Old Label (lookup value if col.alt exists)
			const labelRes = _prepareLabelExpression(col, reference);

			// SQL Statement - include PARENT_ID if composition parent info exists
			const insertSQL = compositionParentInfo
				? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

			const allBindings = compositionParentInfo
				? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID']
				: [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'];

			const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

			// Element skip check variable name
			const elementSkipVar = getElementSkipVarName(entity.name, col.name);

			// Null Check Wrapper + Element Skip Check
			const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';
			return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;
		})
		.join('\n');

	return `${keysCalc}
        ${deleteBlock}
        ${parentIdSetup}
        ${columnBlocks}`;
}

function _generateDeleteBodyPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null) {
	const reference = 'oldRow';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo);

	// Composition parent handling
	const parentIdSetup = compositionParentInfo ? `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");` : '';

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${keysCalc}\n${parentIdSetup}`;
	}

	const columnBlocks = columns
		.map((col) => {
			// Prepare Old Value (raw FK value)
			const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
			// Prepare Old Label (lookup value if col.alt exists)
			const labelRes = _prepareLabelExpression(col, reference);

			// SQL Statement - include PARENT_ID if composition parent info exists
			const insertSQL = compositionParentInfo
				? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, ROOTENTITY, ROOTENTITYKEY, ROOTOBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

			const allBindings = compositionParentInfo
				? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID']
				: [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID', 'rootEntityName', 'rootEntityKey', 'rootObjectID'];

			const tryBlock = _wrapInTryCatch(insertSQL, allBindings);

			// Element skip check variable name
			const elementSkipVar = getElementSkipVarName(entity.name, col.name);

			// Null Check Wrapper + Element Skip Check
			const valExpression = bindings.map((b) => b).join(' != null && ') + ' != null';
			return `if ((${valExpression}) && !shouldSkipElement(conn, "${elementSkipVar}")) {
            ${tryBlock}
        }`;
		})
		.join('\n');

	return `${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs, compositionParentInfo = null) {
	// extract keys for entity (entity.keys is undefined)
	let keys = utils.extractKeys(entity.keys);
	const entityKeyExp = keys.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');

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
				const whereClause = childKeys.map((ck) => `${binding.compositionName}_${ck} = ?`).join(' AND ');
				const selectColumns = rootKeys.join(" || '||' || ");
				const selectSQL = `SELECT ${selectColumns} FROM ${utils.transformName(binding.rootEntityName)} WHERE ${whereClause}`;
				const bindings = childKeys.map((ck) => `${ref}.getString("${ck}")`);

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
				rootKeyExp = binding.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');
			}
		}
	}

	const objectIDs = utils.getObjectIDs(entity, model);
	const objectIDBlock = _generateObjectIDCalculation(objectIDs, entity, ref);
	const rootObjectIDBlock = _generateRootObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity);

	// Add parent key calculation for composition parent linking
	let parentKeyBlock = '';
	let parentObjectIDBlock = '';
	if (compositionParentInfo) {
		const parentKeyExp = compositionParentInfo.parentKeyBinding.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');
		parentKeyBlock = `String parentEntityKey = ${parentKeyExp};`;

		// Parent objectID is the root's objectID (since parent entity IS the root entity)
		parentObjectIDBlock = `String parentObjectID = rootObjectID;`;
	}

	return `
        String entityName = "${entity.name}";
        String rootEntityName = "${rootEntity ? rootEntity.name : ''}";
        String entityKey = ${entityKeyExp};
        String rootEntityKey = ${rootKeyExp};
        ${rootKeyBlock}
        ${objectIDBlock}
        ${rootObjectIDBlock}
        ${parentKeyBlock}
        ${parentObjectIDBlock}
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
			const binds = col.foreignKeys.map((fk) => `${rowVar}.getString("${col.name}_${fk}")`);
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
			const binds = col.on.map((m) => `${rowVar}.getString("${m.foreignKeyField}")`);
			return { sqlExpr: expr, bindings: binds };
		}
	}

	// Scalar value - apply truncation for String and LargeString types
	if (col.type === 'cds.String' || col.type === 'cds.LargeString') {
		return {
			sqlExpr: "CASE WHEN LENGTH(?) > 5000 THEN LEFT(?, 4997) || '...' ELSE ? END",
			bindings: [`${rowVar}.getString("${col.name}")`, `${rowVar}.getString("${col.name}")`, `${rowVar}.getString("${col.name}")`]
		};
	}

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
			keys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
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
				binding.childKeys.forEach((ck) => bindings.push(`${refRow}.getString("${ck}")`));
			} else {
				const rootKeys = utils.extractKeys(rootEntity.keys);
				rootKeys.forEach((k) => bindings.push(`${refRow}.getString("${k}")`));
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

module.exports = { generateH2Trigger };
