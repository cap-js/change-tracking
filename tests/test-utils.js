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

function _resolveEntities(entityNames, allEntities, hierarchyMap) {
	const entities = entityNames ? allEntities.filter((e) => entityNames.includes(e.dbEntityName)) : allEntities;

	return entities.flatMap(({ dbEntityName, mergedAnnotations }) => {
		const entity = cds.model.definitions[dbEntityName];
		if (!entity) return [];
		const rootEntityName = hierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName ? allEntities.find((d) => d.dbEntityName === rootEntityName)?.mergedAnnotations : null;
		return [{ entity, rootEntity, mergedAnnotations, rootMergedAnnotations }];
	});
}

async function _regenerateSQLiteTriggers(entityNames, allEntities, hierarchyMap) {
	const { generateSQLiteTrigger } = require('../lib/trigger/sqlite.js');

	// Drop existing triggers
	const pattern = entityNames
		? entityNames.map((n) => `name LIKE '%${n.replace(/\./g, '_')}_ct_%'`).join(' OR ')
		: `name LIKE '%_ct_%'`;
	const existing = await cds.db.run(`SELECT name FROM sqlite_master WHERE type='trigger' AND (${pattern})`);
	await Promise.all(existing.map(({ name }) => cds.db.run(`DROP TRIGGER IF EXISTS "${name}"`)));

	// Generate and execute new triggers
	const triggers = _resolveEntities(entityNames, allEntities, hierarchyMap).flatMap(({ entity, rootEntity, mergedAnnotations, rootMergedAnnotations }) => {
		const result = generateSQLiteTrigger(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		return result ? [].concat(result) : [];
	});

	await Promise.all(triggers.map((t) => cds.db.run(t)));
}

async function _regeneratePostgresTriggers(entityNames, allEntities, hierarchyMap) {
	const { generatePostgresTriggers } = require('../lib/trigger/postgres.js');

	const triggers = _resolveEntities(entityNames, allEntities, hierarchyMap).flatMap(({ entity, rootEntity, mergedAnnotations, rootMergedAnnotations }) =>
		generatePostgresTriggers(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations)
	);

	await Promise.all(triggers.map((t) => cds.db.run(t)));
}

async function _regenerateH2Triggers(entityNames, allEntities, hierarchyMap) {
	const { generateH2Trigger } = require('../lib/trigger/h2.js');

	for (const { entity, rootEntity, mergedAnnotations, rootMergedAnnotations } of _resolveEntities(entityNames, allEntities, hierarchyMap)) {
		const tableName = entity.name.replace(/\./g, '_').toUpperCase();
		await cds.db.run(`DROP TRIGGER IF EXISTS "${tableName}_CT_TRIGGER"`);

		const triggerSQL = generateH2Trigger(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		if (triggerSQL) await cds.db.run(triggerSQL);
	}
}

async function _regenerateHANATriggers(entityNames, allEntities, hierarchyMap) {
	const { generateHANATriggers } = require('../lib/trigger/hdi.js');
	require('../lib/utils/change-tracking.js');

	for (const { entity, rootEntity, mergedAnnotations, rootMergedAnnotations } of _resolveEntities(entityNames, allEntities, hierarchyMap)) {
		const triggers = generateHANATriggers(cds.model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
		for (const trigger of triggers) {
			await cds.db.run(`CREATE OR REPLACE ${trigger.sql}`);
		}
	}
}

const _generators = {
	sqlite: _regenerateSQLiteTriggers,
	postgres: _regeneratePostgresTriggers,
	h2: _regenerateH2Triggers,
	hana: _regenerateHANATriggers,
};

async function regenerateTriggers(entityNames) {
	const kind = cds.env.requires?.db?.kind;
	const generator = _generators[kind];
	if (!generator) throw new Error(`regenerateTriggers() does not support database kind '${kind}'`);

	const { getEntitiesForTriggerGeneration } = require('../lib/utils/entity-collector.js');
	const { collectedEntities, hierarchyMap } = _collectEntities();
	const allEntities = getEntitiesForTriggerGeneration(cds.model.definitions, collectedEntities);
	const normalizedEntityNames = entityNames ? [].concat(entityNames) : null;

	await generator(normalizedEntityNames, allEntities, hierarchyMap);
}

module.exports = { regenerateTriggers };
