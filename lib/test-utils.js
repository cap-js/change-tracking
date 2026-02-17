const cds = require('@sap/cds');

function _collectEntities() {
	const { isChangeTracked, getBaseEntity, analyzeCompositions } = require('./utils/entity-collector.js');
	
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

async function regenerateTriggers(entityName) {
	const kind = cds.env.requires?.db?.kind;
	if (kind !== 'sqlite') {
		throw new Error(`regenerateTriggers() currently only supports SQLite (got: ${kind})`);
	}

	const { generateSQLiteTriggers } = require('./trigger/sqlite.js');
	const { getEntitiesForTriggerGeneration } = require('./utils/entity-collector.js');

	const { collectedEntities, hierarchyMap } = _collectEntities();
	const allEntities = getEntitiesForTriggerGeneration(cds.model.definitions, collectedEntities);

	// Filter to specific entity if provided
	const entities = entityName
		? allEntities.filter(e => e.dbEntityName === entityName)
		: allEntities;

	// Build trigger name pattern for dropping
	const triggerPattern = entityName
		? `%${entityName.replace(/\./g, '_')}_ct_%`
		: '%_ct_%';

	const existingTriggers = await cds.db.run(
		`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '${triggerPattern}'`
	);

	for (const { name } of existingTriggers) {
		await cds.db.run(`DROP TRIGGER IF EXISTS "${name}"`);
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

module.exports = { regenerateTriggers };
