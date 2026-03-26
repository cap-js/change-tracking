const cds = require('@sap/cds');
const { fs, path } = cds.utils;
const { join } = path;

const MIGRATION_TABLE_PATH = join('db', 'src', 'sap.changelog.Changes.hdbmigrationtable');
const UNDEPLOY_JSON_PATH = join('db', 'undeploy.json');

const UNDEPLOY_ENTRIES = [
	'src/gen/**/sap.changelog.Changes.hdbtable',
	'src/gen/**/sap.changelog.ChangeLog.hdbtable'
];

const LOG = cds.log('change-tracking');

const { getMigrationTableSQL } = require('./hana/migrationTable.js');

module.exports = class extends cds.add.Plugin {
	async run() {
		if (fs.existsSync(MIGRATION_TABLE_PATH)) {
			const existing = fs.readFileSync(MIGRATION_TABLE_PATH, 'utf8');
			const versionMatch = [...existing.matchAll(/==\s*version=(\d+)/g)];
			const latestVersion = versionMatch.length > 0 ? Math.max(...versionMatch.map((m) => parseInt(m[1]))) : 1;

			if (latestVersion >= 2) {
				LOG.warn(
					`Migration table already exists at ${MIGRATION_TABLE_PATH} (latest version: ${latestVersion}). ` +
						`Only the initial v1 -> v2 migration is supported by this command. ` +
						`Please add new migration steps manually.`
				);
				return;
			}

			// Rewrite file with v2 DDL and migration (replaces v1 content)
			fs.writeFileSync(MIGRATION_TABLE_PATH, getMigrationTableSQL());
			LOG.info(`Updated ${MIGRATION_TABLE_PATH} with v2 migration`);
		} else {
			// Write the migration table file
			const dir = join('db', 'src');
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(MIGRATION_TABLE_PATH, getMigrationTableSQL());
			LOG.info(`Created ${MIGRATION_TABLE_PATH}`);
		}

		// Update undeploy.json
		let undeploy = [];
		if (fs.existsSync(UNDEPLOY_JSON_PATH)) {
			undeploy = JSON.parse(fs.readFileSync(UNDEPLOY_JSON_PATH, 'utf8'));
		}
		if (!Array.isArray(undeploy)) undeploy = [];

		let changed = false;
		for (const entry of UNDEPLOY_ENTRIES) {
			if (!undeploy.includes(entry)) {
				undeploy.push(entry);
				changed = true;
			}
		}

		if (changed) {
			fs.writeFileSync(UNDEPLOY_JSON_PATH, JSON.stringify(undeploy, null, 4) + '\n');
			LOG.info(`Updated ${UNDEPLOY_JSON_PATH} with old .hdbtable entries`);
		}
	}
};
