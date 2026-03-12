const cds = require('@sap/cds');

function _collectEntities() {
	const { collectEntities } = require('../lib/utils/entity-collector.js');
	return collectEntities(cds.context?.model ?? cds.model);
}

function _resolveEntities(entityNames, allEntities, hierarchyMap) {
	const model = cds.context?.model ?? cds.model;
	const entities = entityNames ? allEntities.filter((e) => entityNames.includes(e.dbEntityName)) : allEntities;

	return entities.flatMap(({ dbEntityName, mergedAnnotations }) => {
		const entity = model.definitions[dbEntityName];
		if (!entity) return [];
		const hierarchyInfo = hierarchyMap.get(dbEntityName);
		const rootEntityName = hierarchyInfo?.parent ?? null;
		const rootEntity = rootEntityName ? model.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName ? allEntities.find((d) => d.dbEntityName === rootEntityName)?.mergedAnnotations : null;

		// Get grandparent info for deep linking
		const grandParentEntityName = hierarchyInfo?.grandParent ?? null;
		const grandParentContext = {
			grandParentEntity: grandParentEntityName ? model.definitions[grandParentEntityName] : null,
			grandParentMergedAnnotations: grandParentEntityName ? allEntities.find((d) => d.dbEntityName === grandParentEntityName)?.mergedAnnotations : null,
			grandParentCompositionField: hierarchyInfo?.grandParentCompositionField ?? null
		};

		return [{ entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext }];
	});
}

async function _regenerateSQLiteTriggers(entityNames, allEntities, hierarchyMap) {
	const model = cds.context?.model ?? cds.model;
	const { generateSQLiteTrigger } = require('../lib/sqlite/triggers.js');

	// Drop existing triggers
	const pattern = entityNames ? entityNames.map((n) => `name LIKE '%${n.replace(/\./g, '_')}_ct_%'`).join(' OR ') : `name LIKE '%_ct_%'`;
	const existing = await cds.db.run(`SELECT name FROM sqlite_master WHERE type='trigger' AND (${pattern})`);
	await Promise.all(existing.map(({ name }) => cds.db.run(`DROP TRIGGER IF EXISTS "${name}"`)));

	// Generate and execute new triggers
	const triggers = _resolveEntities(entityNames, allEntities, hierarchyMap).flatMap(({ entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext }) => {
		const result = generateSQLiteTrigger(model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext);
		return result ? [].concat(result) : [];
	});

	await Promise.all(triggers.map((t) => cds.db.run(t)));
}

async function _regeneratePostgresTriggers(entityNames, allEntities, hierarchyMap) {
	const model = cds.context?.model ?? cds.model;
	const { generatePostgresTriggers } = require('../lib/postgres/triggers.js');

	const triggers = _resolveEntities(entityNames, allEntities, hierarchyMap).flatMap(({ entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext }) =>
		generatePostgresTriggers(model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext)
	);

	await Promise.all(triggers.map((t) => cds.db.run(t)));
}

async function _regenerateH2Triggers(entityNames, allEntities, hierarchyMap) {
	const model = cds.context?.model ?? cds.model;
	const { generateH2Trigger } = require('../lib/h2/triggers.js');

	for (const { entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext } of _resolveEntities(entityNames, allEntities, hierarchyMap)) {
		const tableName = entity.name.replace(/\./g, '_').toUpperCase();
		await cds.db.run(`DROP TRIGGER IF EXISTS "${tableName}_CT_TRIGGER"`);

		const triggerSQL = generateH2Trigger(model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext);
		if (triggerSQL) await cds.db.run(triggerSQL);
	}
}

async function _regenerateHANATriggers(entityNames, allEntities, hierarchyMap) {
	const model = cds.context?.model ?? cds.model;
	const { generateHANATriggers } = require('../lib/hana/hdi.js');
	require('../lib/utils/change-tracking.js');

	for (const { entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext } of _resolveEntities(entityNames, allEntities, hierarchyMap)) {
		const triggers = generateHANATriggers(model, entity, rootEntity, mergedAnnotations, rootMergedAnnotations, grandParentContext);
		for (const trigger of triggers) {
			await cds.db.run(`CREATE OR REPLACE ${trigger.sql}`);
		}
	}
}

const _generators = {
	sqlite: _regenerateSQLiteTriggers,
	postgres: _regeneratePostgresTriggers,
	h2: _regenerateH2Triggers,
	hana: _regenerateHANATriggers
};

async function regenerateTriggers(entityNames) {
	const kind = cds.env.requires?.db?.kind;
	const generator = _generators[kind];
	if (!generator) throw new Error(`regenerateTriggers() does not support database kind '${kind}'`);

	const { getEntitiesForTriggerGeneration } = require('../lib/utils/entity-collector.js');
	const { collectedEntities, hierarchyMap } = _collectEntities();
	const allEntities = getEntitiesForTriggerGeneration((cds.context?.model ?? cds.model).definitions, collectedEntities);
	const normalizedEntityNames = entityNames ? [].concat(entityNames) : null;

	await generator(normalizedEntityNames, allEntities, hierarchyMap);
}

module.exports = { regenerateTriggers };
