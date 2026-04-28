const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, ensureUndeployJsonHasTriggerPattern } = require('../utils/trigger-utils.js');
const { getLabelTranslations } = require('../localization.js');

const MIGRATION_TABLE_PATH = cds.utils.path.join('db', 'src', 'sap.changelog.Changes.hdbmigrationtable');

function hasMigrationTable() {
	return cds.utils.fs.existsSync(MIGRATION_TABLE_PATH);
}

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

		const config = cds.env.requires?.['change-tracking'];

		// Generate restore backlinks procedure if enabled via feature flag
		if (config?.procedureForRestoringBacklinks) {
			const { generateRestoreBacklinksProcedure } = require('./restoreProcedure.js');
			const procedure = generateRestoreBacklinksProcedure(runtimeCSN, hierarchy, entities);
			if (procedure) data.push(procedure);
		}

		// Auto-detect migration table created by `cds add change-tracking`
		if (hasMigrationTable()) {
			csn.definitions['sap.changelog.Changes']['@cds.persistence.journal'] = true;
		}

		// Add index for trigger deduplication and parent lookup queries
		data.push({
			name: 'sap.changelog.Changes_CT_INDEX',
			sql: 'INDEX "sap.changelog.Changes_CT_INDEX" ON sap_changelog_Changes (entity, entityKey, attribute, valueDataType, transactionID)',
			suffix: '.hdbindex'
		});

		data.push({
			name: 'sap.changelog.Changes_CT_parent_INDEX',
			sql: 'INDEX "sap.changelog.Changes_CT_parent_INDEX" ON sap_changelog_Changes (parent_ID)',
			suffix: '.hdbindex'
		});

		const ret = _hdi_migration(csn, options, beforeImage);
		ret.definitions = ret.definitions.concat(triggers).concat(data);
		return ret;
	};

	// When a migration table file exists in db/src/, strip compiler-generated changesets for sap.changelog.Changes
	// Prevent auto-generation of additional migration steps by the build
	const _compile_to_hana = cds.compile.to.hana;
	cds.compile.to.hana = function (csn, o, beforeCsn) {
		if (hasMigrationTable() && beforeCsn) {
			// Remove the Changes entity from the beforeImage so the compiler
			const beforeClone = structuredClone(beforeCsn);
			delete beforeClone.definitions?.['sap.changelog.Changes'];
			return _compile_to_hana.call(this, csn, o, beforeClone);
		}
		return _compile_to_hana.call(this, csn, o, beforeCsn);
	};
}

module.exports = { registerHDICompilerHook };
