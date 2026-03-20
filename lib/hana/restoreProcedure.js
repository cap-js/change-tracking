const utils = require('../utils/change-tracking.js');
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { compositeKeyExpr } = require('./sql-expressions.js');

/**
 * Generates a HANA stored procedure that restores parent backlinks for composition changes.
 *
 * The procedure:
 * 1. Finds all change entries for composition child entities that have no parent_ID set
 * 2. Uses the child data table to resolve the parent entity key via FK lookup
 * 3. Creates a parent composition entry (valueDataType='cds.Composition') if one doesn't exist
 * 4. Updates child entries to set parent_ID pointing to the parent composition entry
 * 5. Links composition entries to their grandparent composition entries (for deep hierarchies)
 *
 */
function generateRestoreBacklinksProcedure(runtimeCSN, hierarchy, entities) {
	const compositions = _collectCompositionInfo(runtimeCSN, hierarchy, entities);
	if (compositions.length === 0) return null;

	const blocks = compositions.map((comp) => _generateCompositionBlock(comp));

	const procedureSQL = `PROCEDURE "SAP_CHANGELOG_RESTORE_BACKLINKS" ()
	LANGUAGE SQLSCRIPT
	SQL SECURITY INVOKER
AS
BEGIN
${blocks.join('\n')}
END`;

	return {
		name: 'SAP_CHANGELOG_RESTORE_BACKLINKS',
		sql: procedureSQL,
		suffix: '.hdbprocedure'
	};
}

function _collectCompositionInfo(runtimeCSN, hierarchy, entities) {
	const result = [];

	for (const [childEntityName, hierarchyInfo] of hierarchy) {
		const { parent: parentEntityName, compositionField } = hierarchyInfo;
		if (!parentEntityName || !compositionField) continue;

		const childEntity = runtimeCSN.definitions[childEntityName];
		const parentEntity = runtimeCSN.definitions[parentEntityName];
		if (!childEntity || !parentEntity) continue;

		// Check if this entity is actually tracked (in our entities list)
		const isTracked = entities.some((e) => e.dbEntityName === childEntityName);
		if (!isTracked) continue;

		// Get the FK binding from child to parent
		const parentMergedAnnotations = entities.find((e) => e.dbEntityName === parentEntityName)?.mergedAnnotations;
		const compositionParentInfo = getCompositionParentInfo(childEntity, parentEntity, parentMergedAnnotations);
		if (!compositionParentInfo) continue;

		const { parentKeyBinding } = compositionParentInfo;

		// Skip composition of one - they have reverse FK direction and different handling
		if (parentKeyBinding.type === 'compositionOfOne') continue;

		const childKeys = utils.extractKeys(childEntity.keys);
		const parentKeys = utils.extractKeys(parentEntity.keys);
		const rootObjectIDs = utils.getObjectIDs(parentEntity, runtimeCSN, parentMergedAnnotations?.entityAnnotation);

		// Collect grandparent info for deep hierarchies (e.g., Level2 -> Level1 -> Root)
		const grandParentEntityName = hierarchyInfo?.grandParent ?? null;
		const grandParentEntity = grandParentEntityName ? runtimeCSN.definitions[grandParentEntityName] : null;
		const grandParentMergedAnnotations = grandParentEntityName ? entities.find((e) => e.dbEntityName === grandParentEntityName)?.mergedAnnotations : null;
		const grandParentCompositionField = hierarchyInfo?.grandParentCompositionField ?? null;
		const grandParentCompositionInfo = getGrandParentCompositionInfo(parentEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

		result.push({
			childEntityName,
			parentEntityName,
			compositionField,
			childTableName: utils.transformName(childEntityName),
			parentTableName: utils.transformName(parentEntityName),
			fkFields: parentKeyBinding, // FK fields on child pointing to parent (e.g., ['up__ID'] or ['incident_ID'])
			childKeys,
			parentKeys,
			rootObjectIDs,
			grandParentCompositionInfo
		});
	}

	return result;
}

/**
 * Builds the JOIN condition between Changes.entityKey and the child data table.
 * Handles both v2 format (HIERARCHY_COMPOSITE_ID for multi-key) and v1 migrated format (single key only).
 */
function _buildChildKeyJoinCondition(childKeys, alias, changesAlias) {
	const compositeExpr = compositeKeyExpr(childKeys.map((k) => `${alias}.${k}`));

	// Single key: straightforward join
	if (childKeys.length <= 1) {
		return `${changesAlias}.ENTITYKEY = ${compositeExpr}`;
	}

	// Composite keys: support both v2 format (HIERARCHY_COMPOSITE_ID) and v1 migrated format (single ID only)
	// v1 migrated data may have stored only the last key segment as entityKey
	const lastKey = childKeys[childKeys.length - 1];
	return `(${changesAlias}.ENTITYKEY = ${compositeExpr} OR ${changesAlias}.ENTITYKEY = ${alias}.${lastKey})`;
}

/**
 * Generates the SQL block for a single composition relationship.
 */
function _generateCompositionBlock(comp) {
	const { childEntityName, parentEntityName, compositionField, childTableName, parentTableName, fkFields, childKeys, parentKeys, rootObjectIDs, grandParentCompositionInfo } = comp;

	// Build JOIN condition handling both v2 composite keys and v1 migrated simple keys
	const childKeyJoinStep1 = _buildChildKeyJoinCondition(childKeys, 'child_data', 'c');
	const childKeyJoinStep2 = _buildChildKeyJoinCondition(childKeys, 'child_data', 'c2');

	// Expression to compute the parent's entity key from the child data table's FK columns
	const parentKeyFromChild = compositeKeyExpr(fkFields.map((fk) => `child_data.${fk}`));

	// ObjectID expression for the parent composition entry
	// Only use objectIDs that are direct columns on the parent table (not association paths requiring JOINs)
	const simpleObjectIDs = rootObjectIDs?.filter((oid) => !oid.name.includes('.')) ?? [];
	let objectIDExpr;
	if (simpleObjectIDs.length > 0) {
		const parts = simpleObjectIDs.map((oid) => `COALESCE(TO_NVARCHAR((SELECT ${oid.name} FROM ${parentTableName} WHERE ${parentKeys.map((pk) => `${pk} = grp.PARENT_ENTITYKEY`).join(' AND ')})), '')`);
		const concatExpr = parts.length > 1 ? parts.join(" || ', ' || ") : parts[0];
		objectIDExpr = `COALESCE(NULLIF(${concatExpr}, ''), grp.PARENT_ENTITYKEY)`;
	} else {
		objectIDExpr = 'grp.PARENT_ENTITYKEY';
	}

	// Modification: 'create' if the parent entity was created in the same tx, 'update' otherwise
	const modificationExpr = `CASE WHEN EXISTS (
				SELECT 1 FROM SAP_CHANGELOG_CHANGES
				WHERE entity = '${parentEntityName}'
				AND entityKey = grp.PARENT_ENTITYKEY
				AND modification = 'create'
				AND transactionID = grp.TRANSACTIONID
			) THEN 'create' ELSE 'update' END`;

	let block = `
	-- ============================================================================
	-- Restore backlinks: ${childEntityName} -> ${parentEntityName}.${compositionField}
	-- ============================================================================

	-- Step 1: Create parent composition entries where missing
	INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
	SELECT
		SYSUUID,
		NULL,
		'${compositionField}',
		'${parentEntityName}',
		grp.PARENT_ENTITYKEY,
		${objectIDExpr},
		grp.MIN_CREATEDAT,
		grp.CREATEDBY,
		'cds.Composition',
		${modificationExpr},
		grp.TRANSACTIONID
	FROM (
		SELECT
			${parentKeyFromChild} AS PARENT_ENTITYKEY,
			c.TRANSACTIONID,
			MIN(c.CREATEDAT) AS MIN_CREATEDAT,
			MIN(c.CREATEDBY) AS CREATEDBY
		FROM SAP_CHANGELOG_CHANGES c
		INNER JOIN ${childTableName} child_data
			ON ${childKeyJoinStep1}
		WHERE c.entity = '${childEntityName}'
		AND c.parent_ID IS NULL
		AND c.valueDataType != 'cds.Composition'
		AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES p
			WHERE p.entity = '${parentEntityName}'
			AND p.attribute = '${compositionField}'
			AND p.valueDataType = 'cds.Composition'
			AND p.transactionID = c.transactionID
			AND p.entityKey = ${parentKeyFromChild}
		)
		GROUP BY ${parentKeyFromChild}, c.TRANSACTIONID, c.CREATEDBY
	) grp;

	-- Step 2: Link orphaned child entries to their parent composition entry
	MERGE INTO SAP_CHANGELOG_CHANGES AS c
	USING (
		SELECT c2.ID AS CHILD_ID, p.ID AS PARENT_ID
		FROM SAP_CHANGELOG_CHANGES c2
		INNER JOIN ${childTableName} child_data
			ON ${childKeyJoinStep2}
		INNER JOIN SAP_CHANGELOG_CHANGES p
			ON p.entity = '${parentEntityName}'
			AND p.attribute = '${compositionField}'
			AND p.valueDataType = 'cds.Composition'
			AND p.transactionID = c2.transactionID
			AND p.entityKey = ${parentKeyFromChild}
		WHERE c2.entity = '${childEntityName}'
		AND c2.parent_ID IS NULL
		AND c2.valueDataType != 'cds.Composition'
	) AS matched
	ON c.ID = matched.CHILD_ID
	WHEN MATCHED THEN UPDATE SET c.parent_ID = matched.PARENT_ID;`;

	// Link composition entries to their grandparent composition entries (for deep hierarchies)
	if (grandParentCompositionInfo) {
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		// Build expression to resolve the grandparent entity key from the parent data table's FK columns
		const grandParentKeyFromParent = compositeKeyExpr(grandParentKeyBinding.map((fk) => `parent_data.${fk}`));

		block += `

	-- Step 3: Link composition entries to their grandparent composition entries
	MERGE INTO SAP_CHANGELOG_CHANGES AS comp
	USING (
		SELECT comp2.ID AS COMP_ID, gp.ID AS GRANDPARENT_ID
		FROM SAP_CHANGELOG_CHANGES comp2
		INNER JOIN ${parentTableName} parent_data
			ON comp2.ENTITYKEY = ${compositeKeyExpr(parentKeys.map((pk) => `parent_data.${pk}`))}
		INNER JOIN SAP_CHANGELOG_CHANGES gp
			ON gp.entity = '${grandParentEntityName}'
			AND gp.attribute = '${grandParentCompositionFieldName}'
			AND gp.valueDataType = 'cds.Composition'
			AND gp.transactionID = comp2.transactionID
			AND gp.entityKey = ${grandParentKeyFromParent}
		WHERE comp2.entity = '${parentEntityName}'
		AND comp2.attribute = '${compositionField}'
		AND comp2.valueDataType = 'cds.Composition'
		AND comp2.parent_ID IS NULL
	) AS matched
	ON comp.ID = matched.COMP_ID
	WHEN MATCHED THEN UPDATE SET comp.parent_ID = matched.GRANDPARENT_ID;`;
	}

	return block;
}

module.exports = { generateRestoreBacklinksProcedure };
