const cds = require('@sap/cds');

function _collectEntities() {
	const { isChangeTracked, getBaseEntity, analyzeCompositions } = require('../lib/utils/entity-collector.js');
	
	const collectedEntities = new Map();
	const hierarchyMap = analyzeCompositions(cds.model);

	for (const name in cds.model.definitions) {
		const entity = cds.model.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
		if (isServiceEntity && isChangeTracked(entity)) {
			const baseInfo = getBaseEntity(entity, cds.model);
			if (!baseInfo) continue;
			const { baseRef: dbEntityName } = baseInfo;

			if (!collectedEntities.has(dbEntityName)) collectedEntities.set(dbEntityName, []);
			collectedEntities.get(dbEntityName).push(name);
		}
	}

	return { collectedEntities, hierarchyMap };
}

async function _regenerateSQLiteTriggers(entityNames, allEntities, hierarchyMap) {
	const { generateSQLiteTriggers } = require('../lib/trigger/sqlite.js');

	// Filter to specific entities if provided
	const entities = entityNames
		? allEntities.filter(e => entityNames.includes(e.dbEntityName))
		: allEntities;

	// Build trigger name patterns for dropping
	if (entityNames) {
		for (const entityName of entityNames) {
			const triggerPattern = `%${entityName.replace(/\./g, '_')}_ct_%`;
			const existingTriggers = await cds.db.run(
				`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '${triggerPattern}'`
			);
			for (const { name } of existingTriggers) {
				await cds.db.run(`DROP TRIGGER IF EXISTS "${name}"`);
			}
		}
	} else {
		const existingTriggers = await cds.db.run(
			`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_ct_%'`
		);
		for (const { name } of existingTriggers) {
			await cds.db.run(`DROP TRIGGER IF EXISTS "${name}"`);
		}
	}

	const triggers = [];

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = cds.model.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName
			? allEntities.find(d => d.dbEntityName === rootEntityName)?.mergedAnnotations
			: null;
		const entityTriggers = generateSQLiteTriggers(entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		triggers.push(...entityTriggers);
	}

	await Promise.all(triggers.map(t => cds.db.run(t)));
}

async function _regeneratePostgresTriggers(entityNames, allEntities, hierarchyMap) {
	const { generatePostgresTriggers } = require('../lib/trigger/postgres.js');

	// Filter to specific entities if provided
	const entities = entityNames
		? allEntities.filter(e => entityNames.includes(e.dbEntityName))
		: allEntities;


	// Collect all drop and create statements
	const allDrops = [];
	const allCreates = [];

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = cds.model.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName
			? allEntities.find(d => d.dbEntityName === rootEntityName)?.mergedAnnotations
			: null;

		const { creates, drops } = generatePostgresTriggers(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		allDrops.push(...drops);
		allCreates.push(...creates);
	}

	// Execute drops first, then creates
	for (const sql of allDrops) {
		await cds.db.run(sql);
	}
	for (const sql of allCreates) {
		await cds.db.run(sql);
	}
}

async function _regenerateH2Triggers(entityNames, allEntities, hierarchyMap) {
	const { generateH2Trigger } = require('../lib/trigger/h2.js');

	// Filter to specific entities if provided
	const entities = entityNames
		? allEntities.filter(e => entityNames.includes(e.dbEntityName))
		: allEntities;

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = cds.model.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName
			? allEntities.find(d => d.dbEntityName === rootEntityName)?.mergedAnnotations
			: null;

		// Drop existing trigger first
		const tableName = dbEntityName.replace(/\./g, '_').toUpperCase();
		const triggerName = `${tableName}_CT_TRIGGER`;
		await cds.db.run(`DROP TRIGGER IF EXISTS "${triggerName}"`);

		// Generate and execute new trigger
		const triggerSQL = generateH2Trigger(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		if (triggerSQL) {
			await cds.db.run(triggerSQL);
		}
	}
}

async function _regenerateHANATriggers(entityNames, allEntities, hierarchyMap) {
	const { generateHANATriggers } = require('../lib/trigger/hdi.js');
	const utils = require('../lib/utils/change-tracking.js');

	// Filter to specific entities if provided
	const entities = entityNames
		? allEntities.filter(e => entityNames.includes(e.dbEntityName))
		: allEntities;

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = cds.model.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName
			? allEntities.find(d => d.dbEntityName === rootEntityName)?.mergedAnnotations
			: null;
		

		// Generate and execute new triggers
		const triggers = generateHANATriggers(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		for (const trigger of triggers) {
			// HDI format has sql starting with "TRIGGER ...", prepend "CREATE OR REPLACE " for runtime execution
			const createSQL = `CREATE OR REPLACE ${trigger.sql}`;
			await cds.db.run(createSQL);
		}
	}
}

async function regenerateTriggers(entityNames) {
	const kind = cds.env.requires?.db?.kind;
	const { getEntitiesForTriggerGeneration } = require('../lib/utils/entity-collector.js');
	const { collectedEntities, hierarchyMap } = _collectEntities();
	const allEntities = getEntitiesForTriggerGeneration(cds.model.definitions, collectedEntities);

	// Normalize entityNames to array or null
	const normalizedEntityNames = entityNames
		? (Array.isArray(entityNames) ? entityNames : [entityNames])
		: null;

	switch (kind) {
		case 'sqlite':
			await _regenerateSQLiteTriggers(normalizedEntityNames, allEntities, hierarchyMap);
			break;
		case 'postgres':
			await _regeneratePostgresTriggers(normalizedEntityNames, allEntities, hierarchyMap);
			break;
		case 'h2':
			await _regenerateH2Triggers(normalizedEntityNames, allEntities, hierarchyMap);
			break;
		case 'hana':
			await _regenerateHANATriggers(normalizedEntityNames, allEntities, hierarchyMap);
			break;
		default:
			throw new Error(`regenerateTriggers() does not support database kind '${kind}'`);
	}
}

module.exports = { regenerateTriggers };
