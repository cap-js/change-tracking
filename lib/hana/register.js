const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, ensureUndeployJsonHasTriggerPattern } = require('../utils/trigger-utils.js');
const { getLabelTranslations } = require('../localization.js');

function registerHDICompilerHook() {
	const _hdi_migration = cds.compiler.to.hdi.migration;
	cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
		const { generateHANATriggers } = require('./triggers.js');
		const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);

		const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateHANATriggers);
		const data = []
		if (triggers.length > 0) {
			delete csn.definitions['sap.changelog.CHANGE_TRACKING_DUMMY']['@cds.persistence.skip'];
			ensureUndeployJsonHasTriggerPattern();
			
			const labels = getLabelTranslations(entities, runtimeCSN);
			const header = 'ID;locale;text';
			const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
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
			)
		}

		const ret = _hdi_migration(csn, options, beforeImage);
		ret.definitions = ret.definitions.concat(triggers).concat(data);
		return ret;
	};
}

module.exports = { registerHDICompilerHook };
