const cds = require('@sap/cds');

const { getEntitiesForTriggerGeneration, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');
const { generateTriggersForEntities } = require('../utils/trigger-utils.js');

async function deploySQLiteTriggers() {
	const db = cds.env.requires?.db;
	if (db?.kind !== 'sqlite') return;

	const model = cds.context?.model ?? cds.model;
	const { collectedEntities, hierarchyMap } = collectEntities(model);
	const { generateSQLiteTrigger } = require('./triggers.js');
	const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);

	const triggers = generateTriggersForEntities(model, hierarchyMap, entities, generateSQLiteTrigger);
	let deleteTriggers = triggers.map((t) => t.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\w+)/i)).map((m) => `DROP TRIGGER IF EXISTS ${m[1]};`);

	const labels = getLabelTranslations(entities, model);
	const { i18nKeys } = cds.entities('sap.changelog');

	// Delete existing triggers
	await Promise.all(deleteTriggers.map((t) => cds.db.run(t)));

	await Promise.all([...triggers.map((t) => cds.db.run(t)), cds.delete(i18nKeys), cds.insert(labels).into(i18nKeys)]);
}

module.exports = { deploySQLiteTriggers };
