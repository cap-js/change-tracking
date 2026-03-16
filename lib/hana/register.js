const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, ensureUndeployJsonHasTriggerPattern } = require('../utils/trigger-utils.js');
const { getLabelTranslations } = require('../localization.js');

function registerHDICompilerHook() {
	const _hdi_migration = cds.compiler.to.hdi.migration;
	cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
		const { generateHANATriggers } = require('./triggers.js');
		const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);

		const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateHANATriggers);
		const data = [];
		if (triggers.length > 0) {
			delete csn.definitions['sap.changelog.CHANGE_TRACKING_DUMMY']['@cds.persistence.skip'];
			ensureUndeployJsonHasTriggerPattern();

			const labels = getLabelTranslations(entities, runtimeCSN);
			const header = 'ID;locale;text';
			const escape = (v) => {
				const s = String(v ?? '');
				return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
			};
			const rows = labels.map((row) => `${escape(row.ID)};${escape(row.locale)};${escape(row.text)}`);
			const i18nContent = [header, ...rows].join('\n') + '\n';

			data.push(
				{
					name: 'sap.changelog-CHANGE_TRACKING_DUMMY',
					sql: 'X\n1',
					suffix: '.csv'
				},
				{
					name: 'sap.changelog-i18nKeys',
					sql: i18nContent,
					suffix: '.csv'
				}
			);
		}

		const ret = _hdi_migration(csn, options, beforeImage);
		ret.definitions = ret.definitions.concat(triggers).concat(data);
		return ret;
	};

	// REVISIT: Remove once time casting is fixed in cds-dbs
	cds.on('serving', async () => {
		if (cds.env.requires?.db.kind !== 'hana') return;
		const db = await cds.connect.to('db');
		db.before('*', () => {
			// to_time conversion is necessary else HANA tries to convert to timestamp implicitly causing an SQL crash
			db.class.CQN2SQL.OutputConverters.Time = (e) => `to_char(to_time(${e}), 'HH24:MI:SS')`;
		});
	});
}

module.exports = { registerHDICompilerHook };
