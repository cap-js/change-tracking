const cds = require('@sap/cds');

const { getEntitiesForTriggerGeneration, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');
const { prepareCSNForTriggers, generateTriggersForEntities } = require('../utils/trigger-utils.js');

function registerPostgresCompilerHook() {
	cds.on('compile.to.dbx', (csn, options, next) => {
		const ddl = next();
		if (options?.dialect !== 'postgres') return ddl;

		const { generatePostgresTriggers } = require('./triggers.js');
		const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn);

		const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generatePostgresTriggers);

		if (triggers.length === 0) return ddl;

		// Handle standard compilation (array) or delta compilation (object with createsAndAlters/drops)
		if (Array.isArray(ddl)) {
			return [...ddl, ...triggers];
		} else if (ddl.createsAndAlters) {
			ddl.createsAndAlters.push(...triggers);
			return ddl;
		}

		return ddl;
	});

	// REVISIT: Remove once time casting is fixed in cds-dbs
	cds.on('serving', async () => {
		if (cds.env.requires?.db.kind !== 'postgres') return;
		const db = await cds.connect.to('db');
		db.before('*', () => {
			db.class.CQN2SQL.OutputConverters.Date = (e) => `to_date(${e}::text, 'YYYY-MM-DD')`;
			db.class.CQN2SQL.OutputConverters.Time = (e) => `to_timestamp(${e}::text, 'HH24:MI:SS')::TIME`;
			db.class.CQN2SQL.OutputConverters.DateTime = (e) => `to_timestamp(${e}::text, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::timestamp`;
			db.class.CQN2SQL.OutputConverters.Timestamp = (e) => `to_timestamp(${e}::text, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::timestamp`;
		});
	});
}

async function deployPostgresLabels() {
	const db = cds.env.requires?.db;
	if (db?.kind !== 'postgres') return;

	const model = cds.context?.model ?? cds.model;
	const { collectedEntities } = collectEntities(model);
	const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);
	const labels = getLabelTranslations(entities, model);
	const { i18nKeys } = cds.entities('sap.changelog');

	await Promise.all([cds.delete(i18nKeys), cds.insert(labels).into(i18nKeys)]);
}

module.exports = { registerPostgresCompilerHook, deployPostgresLabels };
