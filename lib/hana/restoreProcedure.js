const utils = require('../utils/change-tracking.js');
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { toSQL } = require('./sql-expressions.js');

/**
 * Generates a HANA procedure that restores parent backlinks for composition changes
 *
 * The procedure:
 * 1. Finds all change entries for composition child entities that have no parent_ID set
 * 2. Uses the child data table to resolve the parent entity key via FK lookup
 * 3. Creates a parent composition entry if one doesn't exist
 * 4. Updates child entries to set parent_ID pointing to the parent composition entry
 * 5. Links composition entries to their grandparent composition entries (for deep hierarchies)
 *
 */
function generateRestoreBacklinksProcedure(runtimeCSN, hierarchy, entities) {
	const compositions = _collectCompositionInfo(runtimeCSN, hierarchy, entities);
	if (compositions.length === 0) return null;

	const blocks = compositions.map((comp) => _generateCompositionBlock(comp, runtimeCSN));

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

		// Collect child entity's objectIDs for restoring objectID on orphaned child entries
		const childMergedAnnotations = entities.find((e) => e.dbEntityName === childEntityName)?.mergedAnnotations;
		const childObjectIDs = utils.getObjectIDs(childEntity, runtimeCSN, childMergedAnnotations?.entityAnnotation);

		// Collect grandparent info for deep hierarchies (e.g., Level2 -> Level1 -> Root)
		const grandParentEntityName = hierarchyInfo?.grandParent ?? null;
		const grandParentEntity = grandParentEntityName ? runtimeCSN.definitions[grandParentEntityName] : null;
		const grandParentMergedAnnotations = grandParentEntityName ? entities.find((e) => e.dbEntityName === grandParentEntityName)?.mergedAnnotations : null;
		const grandParentCompositionField = hierarchyInfo?.grandParentCompositionField ?? null;
		const grandParentCompositionInfo = getGrandParentCompositionInfo(parentEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

		// If there's a grandparent, collect its keys, table name, and objectIDs for entry creation
		let grandParentKeys, grandParentObjectIDs;
		if (grandParentCompositionInfo && grandParentEntity) {
			grandParentKeys = utils.extractKeys(grandParentEntity.keys);
			grandParentObjectIDs = utils.getObjectIDs(grandParentEntity, runtimeCSN, grandParentMergedAnnotations?.entityAnnotation);
		}

		result.push({
			childEntityName,
			parentEntityName,
			compositionField,
			fkFields: parentKeyBinding,
			childKeys,
			parentKeys,
			rootObjectIDs,
			childObjectIDs,
			grandParentCompositionInfo,
			grandParentKeys,
			grandParentObjectIDs
		});
	}

	return result;
}

/**
 * Builds the JOIN condition between Changes.entityKey and the child data table.
 * Handles both v2 format (HIERARCHY_COMPOSITE_ID for multi-key) and v1 migrated format (single key only).
 * Uses CQN cast expressions for proper HANA keyword quoting.
 */
function _buildChildKeyJoinCQN(childKeys, childAlias, changesAlias) {
	const castKey = childKeys.length <= 1
		? { ref: [childAlias, childKeys[0]], cast: { type: 'cds.String' } }
		: { func: 'HIERARCHY_COMPOSITE_ID', args: childKeys.map((k) => ({ ref: [childAlias, k] })) };

	const on = [{ ref: [changesAlias, 'entityKey'] }, '=', castKey];

	// Composite keys: also support v1 migrated format (single ID only)
	if (childKeys.length > 1) {
		const lastKey = childKeys[childKeys.length - 1];
		on.push('or', { ref: [changesAlias, 'entityKey'] }, '=', { ref: [childAlias, lastKey], cast: { type: 'cds.String' } });
	}
	return on;
}

/**
 * Builds a CQN cast expression for an entity key from a table alias, producing TO_NVARCHAR / HIERARCHY_COMPOSITE_ID.
 */
function _buildEntityKeyCQN(keys, alias) {
	if (keys.length <= 1) {
		return { ref: [alias, keys[0]], cast: { type: 'cds.String' } };
	}
	return { func: 'HIERARCHY_COMPOSITE_ID', args: keys.map((k) => ({ ref: [alias, k] })) };
}

/**
 * Builds a CQN expression for the child objectID using @changelog fields.
 * When all fields are NULL, falls back to the entity key.
 * When some fields are NULL, shows '<empty>' for missing values.
 */
function _buildObjectIdCQN(objectIDs, entityKeys, alias) {
	const fallbackKeyCQN = _buildEntityKeyCQN(entityKeys, alias);
	if (!objectIDs || objectIDs.length === 0) {
		return fallbackKeyCQN;
	}

	const parts = objectIDs.map((oid) => ({
		func: 'coalesce',
		args: [{ ref: [alias, oid.name], cast: { type: 'cds.String' } }, { val: '<empty>' }]
	}));

	let concatXpr;
	if (parts.length === 1) {
		concatXpr = parts[0];
	} else {
		const xpr = [];
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) {
				xpr.push('||', { val: ', ' }, '||');
			}
			xpr.push(parts[i]);
		}
		concatXpr = { xpr };
	}

	// Build: col1 IS NULL AND col2 IS NULL AND ...
	const allNullXpr = [];
	for (let i = 0; i < objectIDs.length; i++) {
		if (i > 0) allNullXpr.push('and');
		allNullXpr.push({ ref: [alias, objectIDs[i].name] }, 'is', 'null');
	}

	// CASE WHEN all NULL THEN entityKey ELSE concat-with-empty END
	return { xpr: ['case', 'when', ...allNullXpr, 'then', fallbackKeyCQN, 'else', concatXpr, 'end'] };
}

/**
 * Builds a CQN expression for a parent/grandparent objectID using scalar subqueries.
 * When all subqueries return NULL, falls back to the key reference.
 * When some return NULL, shows '<empty>' for missing values.
 * Produces: CASE WHEN (SELECT col1 ...) IS NULL AND (SELECT col2 ...) IS NULL AND ...
 *           THEN keyRef
 *           ELSE COALESCE((SELECT col1 ...), '<empty>') || ', ' || ... END
 * The keyRefSQL is a raw SQL reference (e.g., 'grp.PARENT_ENTITYKEY') to an outer query alias.
 */
function _buildParentObjectIdCQN(objectIDs, entityName, entityKeys, keyRefSQL) {
	if (!objectIDs || objectIDs.length === 0) {
		return null;
	}

	// For single-key entities, use a simple CQN WHERE: { key: rawSQLRef }
	// For multi-key entities, use a CQN xpr WHERE comparing HIERARCHY_COMPOSITE_ID(keys) = rawRef
	let where;
	if (entityKeys.length <= 1) {
		where = { [entityKeys[0]]: { val: keyRefSQL, literal: 'sql' } };
	} else {
		where = [
			{ func: 'HIERARCHY_COMPOSITE_ID', args: entityKeys.map((k) => ({ ref: [k] })) },
			'=',
			{ val: keyRefSQL, literal: 'sql' }
		];
	}

	const subqueries = objectIDs.map((oid) => SELECT.from(entityName).columns(oid.name).where(where));

	// Build concat expression: COALESCE(subquery, '<empty>') || ', ' || ...
	const parts = subqueries.map((q) => ({
		func: 'coalesce',
		args: [{ xpr: [q], cast: { type: 'cds.String' } }, { val: '<empty>' }]
	}));

	let concatXpr;
	if (parts.length === 1) {
		concatXpr = parts[0];
	} else {
		const xpr = [];
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) xpr.push('||', { val: ', ' }, '||');
			xpr.push(parts[i]);
		}
		concatXpr = { xpr };
	}

	// Build: subquery1 IS NULL AND subquery2 IS NULL AND ...
	const allNullXpr = [];
	for (let i = 0; i < subqueries.length; i++) {
		if (i > 0) allNullXpr.push('and');
		allNullXpr.push({ xpr: [subqueries[i]] }, 'is', 'null');
	}

	// CASE WHEN all NULL THEN keyRef ELSE concat-with-empty END
	return { xpr: ['case', 'when', ...allNullXpr, 'then', { val: keyRefSQL, literal: 'sql' }, 'else', concatXpr, 'end'] };
}

/**
 * Generates the SQL block for a single composition relationship.
 * Uses CQN query construction with toSQL() for proper HANA reserved keyword quoting.
 */
function _generateCompositionBlock(comp, model) {
	const {
		childEntityName,
		parentEntityName,
		compositionField,
		fkFields,
		childKeys,
		parentKeys,
		rootObjectIDs,
		childObjectIDs,
		grandParentCompositionInfo,
		grandParentKeys,
		grandParentObjectIDs
	} = comp;

	const changesEntity = 'sap.changelog.Changes';

	// -- Step 1: Build the grouped SELECT subquery for creating parent composition entries --
	const parentKeyFromChildCQN = _buildEntityKeyCQN(fkFields, 'child_data');

	const step1InnerFrom = {
		join: 'inner',
		args: [{ ref: [changesEntity], as: 'c' }, { ref: [childEntityName], as: 'child_data' }],
		on: _buildChildKeyJoinCQN(childKeys, 'child_data', 'c')
	};

	const step1Query = {
		SELECT: {
			from: step1InnerFrom,
			columns: [
				{ ...parentKeyFromChildCQN, as: 'PARENT_ENTITYKEY' },
				{ ref: ['c', 'transactionID'], as: 'TRANSACTIONID' },
				{ func: 'min', args: [{ ref: ['c', 'createdAt'] }], as: 'MIN_CREATEDAT' },
				{ func: 'min', args: [{ ref: ['c', 'createdBy'] }], as: 'CREATEDBY' }
			],
			where: [
				{ ref: ['c', 'entity'] }, '=', { val: childEntityName },
				'and', { ref: ['c', 'parent_ID'] }, 'is', 'null',
				'and', { ref: ['c', 'valueDataType'] }, '<>', { val: 'cds.Composition' },
				'and', 'not', 'exists', {
					SELECT: {
						from: { ref: [changesEntity], as: 'p' },
						columns: [{ val: 1 }],
						where: [
							{ ref: ['p', 'entity'] }, '=', { val: parentEntityName },
							'and', { ref: ['p', 'attribute'] }, '=', { val: compositionField },
							'and', { ref: ['p', 'valueDataType'] }, '=', { val: 'cds.Composition' },
							'and', { ref: ['p', 'transactionID'] }, '=', { ref: ['c', 'transactionID'] },
							'and', { ref: ['p', 'entityKey'] }, '=', parentKeyFromChildCQN
						]
					}
				}
			],
			groupBy: [parentKeyFromChildCQN, { ref: ['c', 'transactionID'] }, { ref: ['c', 'createdBy'] }]
		}
	};

	const step1SQL = toSQL(step1Query, model);

	// ObjectID expression for the parent composition entry (uses scalar subqueries against parent table)
	const simpleObjectIDs = rootObjectIDs?.filter((oid) => !oid.name.includes('.')) ?? [];
	const parentObjectIdCQN = _buildParentObjectIdCQN(simpleObjectIDs, parentEntityName, parentKeys, 'grp.PARENT_ENTITYKEY');
	let objectIDExpr;
	if (simpleObjectIDs.length > 0) {
		// Generate SQL for just the objectID expression by wrapping it in a dummy SELECT
		const objectIdQuery = { SELECT: { from: { ref: [changesEntity], as: 'dummy' }, columns: [{ ...parentObjectIdCQN, as: 'val' }] } };
		const objectIdSQL = toSQL(objectIdQuery, model);
		// Extract expression between SELECT and FROM
		const match = objectIdSQL.match(/SELECT\s+(.+?)\s+as\s+val\s+FROM/i);
		objectIDExpr = match ? match[1] : 'grp.PARENT_ENTITYKEY';
	} else {
		objectIDExpr = 'grp.PARENT_ENTITYKEY';
	}

	// Modification expression
	const modificationExpr = `CASE WHEN EXISTS (
				SELECT 1 FROM SAP_CHANGELOG_CHANGES
				WHERE entity = '${parentEntityName}'
				AND entityKey = grp.PARENT_ENTITYKEY
				AND modification = 'create'
				AND transactionID = grp.TRANSACTIONID
			) THEN 'create' ELSE 'update' END`;

	// -- Step 2: Build the MERGE USING SELECT for linking orphaned child entries --
	const childObjectIdCQN = _buildObjectIdCQN(
		childObjectIDs?.filter((oid) => !oid.name.includes('.')) ?? [],
		childKeys,
		'child_data'
	);

	const step2From = {
		join: 'inner',
		args: [
			{
				join: 'inner',
				args: [{ ref: [changesEntity], as: 'c2' }, { ref: [childEntityName], as: 'child_data' }],
				on: _buildChildKeyJoinCQN(childKeys, 'child_data', 'c2')
			},
			{ ref: [changesEntity], as: 'p' }
		],
		on: [
			{ ref: ['p', 'entity'] }, '=', { val: parentEntityName },
			'and', { ref: ['p', 'attribute'] }, '=', { val: compositionField },
			'and', { ref: ['p', 'valueDataType'] }, '=', { val: 'cds.Composition' },
			'and', { ref: ['p', 'transactionID'] }, '=', { ref: ['c2', 'transactionID'] },
			'and', { ref: ['p', 'entityKey'] }, '=', _buildEntityKeyCQN(fkFields, 'child_data')
		]
	};

	const step2Query = {
		SELECT: {
			from: step2From,
			columns: [
				{ ref: ['c2', 'ID'], as: 'CHILD_ID' },
				{ ref: ['p', 'ID'], as: 'PARENT_ID' },
				{ ...childObjectIdCQN, as: 'CHILD_OBJECTID' }
			],
			where: [
				{ ref: ['c2', 'entity'] }, '=', { val: childEntityName },
				'and', { ref: ['c2', 'parent_ID'] }, 'is', 'null',
				'and', { ref: ['c2', 'valueDataType'] }, '<>', { val: 'cds.Composition' }
			]
		}
	};

	const step2SQL = toSQL(step2Query, model);

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
	FROM (${step1SQL}) grp;

	-- Step 2: Link orphaned child entries to their parent composition entry and restore objectID
	MERGE INTO SAP_CHANGELOG_CHANGES AS c
	USING (${step2SQL}) AS matched
	ON c.ID = matched.CHILD_ID
	WHEN MATCHED THEN UPDATE SET c.parent_ID = matched.PARENT_ID, c.objectID = matched.CHILD_OBJECTID;`;

	// Create grandparent composition entries and link to them (for deep hierarchies)
	if (grandParentCompositionInfo) {
		const { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding } = grandParentCompositionInfo;

		const gpKeyFromParentCQN = _buildEntityKeyCQN(grandParentKeyBinding, 'parent_data');

		// Grandparent objectID expression
		const simpleGPObjectIDs = grandParentObjectIDs?.filter((oid) => !oid.name.includes('.')) ?? [];
		const gpObjectIdCQN = _buildParentObjectIdCQN(simpleGPObjectIDs, grandParentEntityName, grandParentKeys, 'grp2.GP_ENTITYKEY');
		let gpObjectIDExpr;
		if (simpleGPObjectIDs.length > 0) {
			const gpObjectIdQuery = { SELECT: { from: { ref: [changesEntity], as: 'dummy' }, columns: [{ ...gpObjectIdCQN, as: 'val' }] } };
			const gpObjectIdSQL = toSQL(gpObjectIdQuery, model);
			const match = gpObjectIdSQL.match(/SELECT\s+(.+?)\s+as\s+val\s+FROM/i);
			gpObjectIDExpr = match ? match[1] : 'grp2.GP_ENTITYKEY';
		} else {
			gpObjectIDExpr = 'grp2.GP_ENTITYKEY';
		}

		const gpModificationExpr = `CASE WHEN EXISTS (
					SELECT 1 FROM SAP_CHANGELOG_CHANGES
					WHERE entity = '${grandParentEntityName}'
					AND entityKey = grp2.GP_ENTITYKEY
					AND modification = 'create'
					AND transactionID = grp2.TRANSACTIONID
				) THEN 'create' ELSE 'update' END`;

		// Step 3a inner grouped SELECT
		const parentKeyExprCQN = _buildEntityKeyCQN(parentKeys, 'parent_data');

		const step3aQuery = {
			SELECT: {
				from: {
					join: 'inner',
					args: [{ ref: [changesEntity], as: 'comp2' }, { ref: [parentEntityName], as: 'parent_data' }],
					on: [{ ref: ['comp2', 'entityKey'] }, '=', parentKeyExprCQN]
				},
				columns: [
					{ ...gpKeyFromParentCQN, as: 'GP_ENTITYKEY' },
					{ ref: ['comp2', 'transactionID'], as: 'TRANSACTIONID' },
					{ func: 'min', args: [{ ref: ['comp2', 'createdAt'] }], as: 'MIN_CREATEDAT' },
					{ func: 'min', args: [{ ref: ['comp2', 'createdBy'] }], as: 'CREATEDBY' }
				],
				where: [
					{ ref: ['comp2', 'entity'] }, '=', { val: parentEntityName },
					'and', { ref: ['comp2', 'attribute'] }, '=', { val: compositionField },
					'and', { ref: ['comp2', 'valueDataType'] }, '=', { val: 'cds.Composition' },
					'and', { ref: ['comp2', 'parent_ID'] }, 'is', 'null',
					'and', 'not', 'exists', {
						SELECT: {
							from: { ref: [changesEntity], as: 'gp' },
							columns: [{ val: 1 }],
							where: [
								{ ref: ['gp', 'entity'] }, '=', { val: grandParentEntityName },
								'and', { ref: ['gp', 'attribute'] }, '=', { val: grandParentCompositionFieldName },
								'and', { ref: ['gp', 'valueDataType'] }, '=', { val: 'cds.Composition' },
								'and', { ref: ['gp', 'transactionID'] }, '=', { ref: ['comp2', 'transactionID'] },
								'and', { ref: ['gp', 'entityKey'] }, '=', gpKeyFromParentCQN
							]
						}
					}
				],
				groupBy: [gpKeyFromParentCQN, { ref: ['comp2', 'transactionID'] }, { ref: ['comp2', 'createdBy'] }]
			}
		};

		const step3aSQL = toSQL(step3aQuery, model);

		// Step 3b MERGE USING SELECT
		const step3bQuery = {
			SELECT: {
				from: {
					join: 'inner',
					args: [
						{
							join: 'inner',
							args: [{ ref: [changesEntity], as: 'comp2' }, { ref: [parentEntityName], as: 'parent_data' }],
							on: [{ ref: ['comp2', 'entityKey'] }, '=', parentKeyExprCQN]
						},
						{ ref: [changesEntity], as: 'gp' }
					],
					on: [
						{ ref: ['gp', 'entity'] }, '=', { val: grandParentEntityName },
						'and', { ref: ['gp', 'attribute'] }, '=', { val: grandParentCompositionFieldName },
						'and', { ref: ['gp', 'valueDataType'] }, '=', { val: 'cds.Composition' },
						'and', { ref: ['gp', 'transactionID'] }, '=', { ref: ['comp2', 'transactionID'] },
						'and', { ref: ['gp', 'entityKey'] }, '=', gpKeyFromParentCQN
					]
				},
				columns: [
					{ ref: ['comp2', 'ID'], as: 'COMP_ID' },
					{ ref: ['gp', 'ID'], as: 'GRANDPARENT_ID' }
				],
				where: [
					{ ref: ['comp2', 'entity'] }, '=', { val: parentEntityName },
					'and', { ref: ['comp2', 'attribute'] }, '=', { val: compositionField },
					'and', { ref: ['comp2', 'valueDataType'] }, '=', { val: 'cds.Composition' },
					'and', { ref: ['comp2', 'parent_ID'] }, 'is', 'null'
				]
			}
		};

		const step3bSQL = toSQL(step3bQuery, model);

		block += `

	-- Step 3a: Create grandparent composition entries where missing
	INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
	SELECT
		SYSUUID,
		NULL,
		'${grandParentCompositionFieldName}',
		'${grandParentEntityName}',
		grp2.GP_ENTITYKEY,
		${gpObjectIDExpr},
		grp2.MIN_CREATEDAT,
		grp2.CREATEDBY,
		'cds.Composition',
		${gpModificationExpr},
		grp2.TRANSACTIONID
	FROM (${step3aSQL}) grp2;

	-- Step 3b: Link composition entries to their grandparent composition entries
	MERGE INTO SAP_CHANGELOG_CHANGES AS comp
	USING (${step3bSQL}) AS matched
	ON comp.ID = matched.COMP_ID
	WHEN MATCHED THEN UPDATE SET comp.parent_ID = matched.GRANDPARENT_ID;`;
	}

	return block;
}

module.exports = { generateRestoreBacklinksProcedure };
