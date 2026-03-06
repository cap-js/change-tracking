const cds = require('@sap/cds');
const { fs } = cds.utils;

const { prepareCSNForTriggers, generateTriggersForEntities, writeLabelsCSV, ensureUndeployJsonHasTriggerPattern } = require('../trigger/generator.js');

function registerHDICompilerHook() {
	const _hdi_migration = cds.compiler.to.hdi.migration;
	cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
		const { generateHANATriggers } = require('./triggers.js');
		const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);

		const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateHANATriggers);

		if (triggers.length > 0) {
			delete csn.definitions['sap.changelog.CHANGE_TRACKING_DUMMY']['@cds.persistence.skip'];
			writeLabelsCSV(entities, runtimeCSN);
			const dir = 'db/src/gen/data/';
			fs.writeFileSync(`${dir}/sap.changelog-CHANGE_TRACKING_DUMMY.csv`, `X\n1`);
			ensureUndeployJsonHasTriggerPattern();
		}

		const ret = _hdi_migration(csn, options, beforeImage);
		ret.definitions = [...ret.definitions, ...triggers];
		return ret;
	};
}

module.exports = { registerHDICompilerHook };
