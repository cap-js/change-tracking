const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const { CT_SKIP_VAR, getEntitySkipVarName, getElementSkipVarName } = require('../utils/session-variables.js');
const { createTriggerCQN2SQL } = require('../TriggerCQN2SQL.js');

let SQLiteCQN2SQL;
let model;

function _generateJavaMethod(createBody, updateBody, deleteBody, entityName, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const entitySkipVar = getEntitySkipVarName(entityName);

	// Extract values for use in template strings
	const parentEntityName = compositionParentInfo?.parentEntityName ?? '';
	const compositionFieldName = compositionParentInfo?.compositionFieldName ?? '';
	const grandParentEntityName = grandParentCompositionInfo?.grandParentEntityName ?? '';
	const grandParentCompositionFieldName = grandParentCompositionInfo?.grandParentCompositionFieldName ?? '';

	// Add grandparent entry helper method when grandParentCompositionInfo exists
	// Note: grandparent entries always use 'update' modification since they represent changes to an existing parent's composition
	const grandParentHelper = grandParentCompositionInfo
		? `
            private String ensureGrandParentCompositionEntry(Connection conn, String grandParentKey, String grandParentObjectID) throws SQLException {
                String grandParentId = null;
                long transactionId = getTransactionId(conn);
                
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${grandParentEntityName}");
                    stmt.setString(2, grandParentKey);
                    stmt.setString(3, "${grandParentCompositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            grandParentId = rs.getString(1);
                        }
                    }
                }
                
                if (grandParentId == null) {
                    grandParentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', 'update', ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, grandParentId);
                        stmt.setString(2, "${grandParentCompositionFieldName}");
                        stmt.setString(3, "${grandParentEntityName}");
                        stmt.setString(4, grandParentKey);
                        stmt.setString(5, grandParentObjectID);
                        stmt.setLong(6, transactionId);
                        stmt.executeUpdate();
                    }
                }
                
                return grandParentId;
            }
`
		: '';

	// Add parent ID helper method if needed
	const parentIdHelper = compositionParentInfo
		? `
            private String ensureCompositionParentEntry(Connection conn, String parentEntityKey, String objectID, String modification${grandParentCompositionInfo ? ', String parentChangelogId' : ''}) throws SQLException {
                String parentId = null;
                long transactionId = getTransactionId(conn);
                
                String checkSQL = "SELECT ID FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = ?";
                try (PreparedStatement stmt = conn.prepareStatement(checkSQL)) {
                    stmt.setString(1, "${parentEntityName}");
                    stmt.setString(2, parentEntityKey);
                    stmt.setString(3, "${compositionFieldName}");
                    stmt.setLong(4, transactionId);
                    try (ResultSet rs = stmt.executeQuery()) {
                        if (rs.next()) {
                            parentId = rs.getString(1);
                        }
                    }
                }
                
                if (parentId == null) {
                    ${
											grandParentCompositionInfo
												? ''
												: `
                    String effectiveModification = modification;
                    if ("create".equals(modification)) {
                        String parentCreatedCheckSQL = "SELECT COUNT(*) FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND MODIFICATION = 'create' AND TRANSACTIONID = ?";
                        try (PreparedStatement checkStmt = conn.prepareStatement(parentCreatedCheckSQL)) {
                            checkStmt.setString(1, "${parentEntityName}");
                            checkStmt.setString(2, parentEntityKey);
                            checkStmt.setLong(3, transactionId);
                            try (ResultSet rs = checkStmt.executeQuery()) {
                                if (rs.next() && rs.getInt(1) == 0) {
                                    effectiveModification = "update";
                                }
                            }
                        }
                    }
                    modification = effectiveModification;`
										}
                    parentId = java.util.UUID.randomUUID().toString();
                    String insertSQL = "INSERT INTO sap_changelog_Changes (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), 'cds.Composition', ?, ?)";
                    try (PreparedStatement stmt = conn.prepareStatement(insertSQL)) {
                        stmt.setString(1, parentId);
                        stmt.setString(2, ${grandParentCompositionInfo ? 'parentChangelogId' : 'null'});
                        stmt.setString(3, "${compositionFieldName}");
                        stmt.setString(4, "${parentEntityName}");
                        stmt.setString(5, parentEntityKey);
                        stmt.setString(6, objectID);
                        stmt.setString(7, modification);
                        stmt.setLong(8, transactionId);
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

            private boolean hasExistingCompositionEntry(Connection conn, String entityName, String entityKey, String attribute) throws SQLException {
                String sql = "SELECT 1 FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ? AND ATTRIBUTE = ? AND VALUEDATATYPE = 'cds.Composition' AND TRANSACTIONID = TRANSACTION_ID()";
                try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                    stmt.setString(1, entityName);
                    stmt.setString(2, entityKey);
                    stmt.setString(3, attribute);
                    try (ResultSet rs = stmt.executeQuery()) {
                        return rs.next();
                    }
                }
            }
${grandParentHelper}${parentIdHelper}
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

function generateH2Trigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	model = csn;
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
	if (!shouldGenerateTriggers) return null;

	// Generate the Java code for each section
	const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo) : '';
	const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo) : '';
	let deleteBody = '';
	if (!config?.disableDeleteTracking) {
		deleteBody = config?.preserveDeletes
			? _generateDeleteBodyPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo)
			: _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);
	}

	// Define the full Create Trigger SQL
	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct
            AFTER INSERT, UPDATE, DELETE ON ${utils.transformName(entity.name)}
            FOR EACH ROW
            AS $$
            ${_generateJavaMethod(createBody, updateBody, deleteBody, entity.name, compositionParentInfo, grandParentCompositionInfo)}
            $$;;`;
}

function _generateCreateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const reference = 'newRow';

	// Set modification type for grandparent entry creation (must be before keysCalc which uses it)
	const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "create";' : '';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);

	// Composition parent handling - with deep linking support when grandParentCompositionInfo exists
	let parentIdSetup = '';
	if (compositionParentInfo) {
		if (grandParentCompositionInfo) {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "create", parentChangelogId);`;
		} else {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "create");`;
		}
	}

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
	}

	const columnBlocks = columns
		.map((col) => {
			// Prepare Value Expression
			const { sqlExpr, bindings } = _prepareValueExpression(col, reference);
			const labelRes = _prepareLabelExpression(col, reference); // label expression

			// SQL Statement - include PARENT_ID if composition parent info exists
			const insertSQL = compositionParentInfo
				? `INSERT INTO sap_changelog_Changes 
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', NULL, ${sqlExpr}, NULL, ${labelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'create', TRANSACTION_ID())`;

			// Bindings: ParentId (if applicable) + NewVal Bindings + Standard Metadata Bindings
			const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'];

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

	return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateUpdateBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const reference = 'newRow';

	// Set modification type for grandparent entry creation (must be before keysCalc which uses it)
	const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "update";' : '';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);

	// Composition parent handling - with deep linking support when grandParentCompositionInfo exists
	let parentIdSetup = '';
	if (compositionParentInfo) {
		if (grandParentCompositionInfo) {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "update", parentChangelogId);`;
		} else {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "update");`;
		}
	}

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
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
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${oldRes.sqlExpr}, ${newRes.sqlExpr}, ${oldLabelRes.sqlExpr}, ${newLabelRes.sqlExpr}, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'update', TRANSACTION_ID())`;

			// Bindings: ParentId (if applicable) + OldVal + NewVal + Metadata
			const allBindings = compositionParentInfo
				? ['parentId', ...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', 'objectID']
				: [...oldRes.bindings, ...newRes.bindings, ...oldLabelRes.bindings, ...newLabelRes.bindings, 'entityName', 'entityKey', 'objectID'];

			// Element skip check variable name
			const elementSkipVar = getElementSkipVarName(entity.name, col.name);

			// For composition-of-one columns, add deduplication check to prevent duplicate entries
			// when child trigger has already created a composition entry for this transaction
			const compositionCheck = col.type === 'cds.Composition' ? ` && !hasExistingCompositionEntry(conn, entityName, entityKey, "${col.name}")` : '';

			return `if ((${changeCheck}) && !shouldSkipElement(conn, "${elementSkipVar}")${compositionCheck}) {
            ${_wrapInTryCatch(insertSQL, allBindings)}
        }`;
		})
		.join('\n');

	return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateDeleteBody(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const reference = 'oldRow';

	// Set modification type for grandparent entry creation (must be before keysCalc which uses it)
	const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "delete";' : '';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);

	// First delete existing changelogs for this entity
	const deleteSQL = `DELETE FROM sap_changelog_Changes WHERE ENTITY = ? AND ENTITYKEY = ?`;
	const deleteBlock = _wrapInTryCatch(deleteSQL, ['entityName', 'entityKey']);

	// Composition parent handling - with deep linking support when grandParentCompositionInfo exists
	let parentIdSetup = '';
	if (compositionParentInfo) {
		if (grandParentCompositionInfo) {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete", parentChangelogId);`;
		} else {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");`;
		}
	}

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${modificationTypeSetup}\n${keysCalc}\n${deleteBlock}\n${parentIdSetup}`;
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
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

			const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'];

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

	return `${modificationTypeSetup}
        ${keysCalc}
        ${deleteBlock}
        ${parentIdSetup}
        ${columnBlocks}`;
}

function _generateDeleteBodyPreserve(entity, columns, objectIDs, rootEntity, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	const reference = 'oldRow';

	// Set modification type for grandparent entry creation (must be before keysCalc which uses it)
	const modificationTypeSetup = grandParentCompositionInfo ? 'String modificationType = "delete";' : '';
	const keysCalc = _generateKeyCalculationJava(entity, rootEntity, reference, rootObjectIDs, compositionParentInfo, grandParentCompositionInfo);

	// Composition parent handling - with deep linking support when grandParentCompositionInfo exists
	let parentIdSetup = '';
	if (compositionParentInfo) {
		if (grandParentCompositionInfo) {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete", parentChangelogId);`;
		} else {
			parentIdSetup = `String parentId = ensureCompositionParentEntry(conn, parentEntityKey, parentObjectID, "delete");`;
		}
	}

	// Handle composition-only triggers (no tracked columns)
	if (columns.length === 0 && compositionParentInfo) {
		return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}`;
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
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), ?, '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`
				: `INSERT INTO sap_changelog_Changes 
            (ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID) 
            VALUES 
            (RANDOM_UUID(), '${col.name}', ${sqlExpr}, NULL, ${labelRes.sqlExpr}, NULL, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_USER(), '${col.type}', 'delete', TRANSACTION_ID())`;

			const allBindings = compositionParentInfo ? ['parentId', ...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'] : [...bindings, ...labelRes.bindings, 'entityName', 'entityKey', 'objectID'];

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

	return `${modificationTypeSetup}\n${keysCalc}\n${parentIdSetup}\n${columnBlocks}`;
}

function _generateKeyCalculationJava(entity, rootEntity, ref, rootObjectIDs, compositionParentInfo = null, grandParentCompositionInfo = null) {
	// extract keys for entity (entity.keys is undefined)
	let keys = utils.extractKeys(entity.keys);
	const entityKeyExp = keys.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');

	const objectIDs = utils.getObjectIDs(entity, model);
	const objectIDBlock = _generateObjectIDCalculation(objectIDs, entity, ref);

	// Add parent key calculation for composition parent linking
	let parentKeyBlock = '';
	let parentObjectIDBlock = '';
	let parentChangelogLookupBlock = '';
	if (compositionParentInfo) {
		const { parentKeyBinding } = compositionParentInfo;

		// Handle composition of one (parent has FK to child - need reverse lookup)
		if (parentKeyBinding.type === 'compositionOfOne') {
			const { compositionName, childKeys } = parentKeyBinding;
			const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
			const parentKeys = utils.extractKeys(parentEntity.keys);

			// Build FK field names and WHERE clause for reverse lookup
			const parentFKFields = childKeys.map((k) => `${compositionName}_${k}`);
			const whereClause = parentFKFields.map((fk) => `${fk} = ?`).join(' AND ');
			const selectColumns = parentKeys.join(" || '||' || ");
			const selectSQL = `SELECT ${selectColumns} FROM ${utils.transformName(compositionParentInfo.parentEntityName)} WHERE ${whereClause}`;
			const bindings = childKeys.map((ck) => `${ref}.getString("${ck}")`);

			parentKeyBlock = `String parentEntityKey = null;
        try (PreparedStatement stmtPK = conn.prepareStatement("${selectSQL.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPK.setString(${i + 1}, ${b});`).join('\n            ')}
            try (ResultSet rsPK = stmtPK.executeQuery()) {
                if (rsPK.next()) {
                    parentEntityKey = rsPK.getString(1);
                }
            }
        }`;
		} else {
			// Standard composition of many: child has FK to parent
			const parentKeyExp = parentKeyBinding.map((k) => `${ref}.getString("${k}")`).join(' + "||" + ');
			parentKeyBlock = `String parentEntityKey = ${parentKeyExp};`;
		}

		// Compute parent objectID (the display name of the composition parent entity)
		const parentObjectIDCalcBlock = _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, ref, entity);
		parentObjectIDBlock = parentObjectIDCalcBlock;

		if (grandParentCompositionInfo && !parentKeyBinding.type) {
			const { grandParentKeyBinding } = grandParentCompositionInfo;
			const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
			const parentKeys = utils.extractKeys(parentEntity.keys);

			// Build SQL to look up grandparent key from parent entity
			const grandParentKeyLookupSQL = grandParentKeyBinding.map((k) => k).join(" || '||' || ");
			const parentTableName = utils.transformName(compositionParentInfo.parentEntityName);
			const parentWhereClause = parentKeys.map((pk) => `${pk} = ?`).join(' AND ');

			parentChangelogLookupBlock = `
        String parentChangelogId = null;
        String grandParentKeySQL = "SELECT ${grandParentKeyLookupSQL} FROM ${parentTableName} WHERE ${parentWhereClause}";
        String grandParentKey = null;
        try (PreparedStatement gpKeyStmt = conn.prepareStatement(grandParentKeySQL)) {
            ${parentKeyBinding.map((k, i) => `gpKeyStmt.setString(${i + 1}, ${ref}.getString("${k}"));`).join('\n')}
            try (ResultSet gpKeyRs = gpKeyStmt.executeQuery()) {
                if (gpKeyRs.next()) {
                    grandParentKey = gpKeyRs.getString(1);
                }
            }
        }
        if (grandParentKey != null) {
            parentChangelogId = ensureGrandParentCompositionEntry(conn, grandParentKey, parentObjectID);
        }`;
		}
	}

	return `
        String entityName = "${entity.name}";
        String entityKey = ${entityKeyExp};
        ${objectIDBlock}
        ${parentKeyBlock}
        ${parentObjectIDBlock}
        ${parentChangelogLookupBlock}
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

/**
 * Generates Java code to compute the composition parent's objectID (display name).
 * This is used when a child entity has a tracked composition parent — the parent's
 * changelog entry needs a meaningful objectID rather than just the key.
 */
function _generateParentObjectIDCalculation(rootObjectIDs, rootEntity, refRow, childEntity) {
	if (!rootObjectIDs || rootObjectIDs.length === 0) {
		const rootEntityName = rootEntity ? rootEntity.name : '';
		return `String parentObjectID = "${rootEntityName}";`;
	}

	// Build SQL Query for the parent's ObjectID string
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
        String parentObjectID = entityKey;
        try (PreparedStatement stmtPOID = conn.prepareStatement("${finalSql.replace(/"/g, '\\"')}")) {
            ${bindings.map((b, i) => `stmtPOID.setString(${i + 1}, ${b});`).join('\n            ')}
            
            try (ResultSet rsPOID = stmtPOID.executeQuery()) {
                if (rsPOID.next()) {
                    String res = rsPOID.getString(1);
                    if (res != null) parentObjectID = res;
                }
            }
        }`;
}

module.exports = { generateH2Trigger };
