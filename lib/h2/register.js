const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, writeLabelsCSV } = require('../utils/trigger-utils.js');

function registerH2CompilerHook() {
	const _sql_original = cds.compile.to.sql;
	cds.compile.to.sql = function (csn, options) {
		let ret = _sql_original.call(this, csn, options);
		const kind = options?.kind ?? options?.to;
		if (kind !== 'h2') return ret;

		const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);
		const { generateH2Triggers } = require('./triggers.js');
		const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateH2Triggers);

		if (triggers.length > 0) {
			writeLabelsCSV(entities, runtimeCSN);
		}
		// Add semicolon at the end of each DDL statement if not already present
		ret = ret.map((s) => (s.endsWith(';') ? s : s + ';'));

		return ret.concat(triggers);
	};
	Object.assign(cds.compile.to.sql, _sql_original);
}

module.exports = { registerH2CompilerHook };
