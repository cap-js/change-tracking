const path = require('path');
const fs = require('fs');
const cds = require('@sap/cds');
const TempUtil = require('./tempUtil.js');
const tempUtil = new TempUtil(__filename);

const bookshopDir = path.join(__dirname, '../bookshop');
const isHana = cds.env.requires?.db?.kind === 'hana';

(isHana ? describe : describe.skip)('HANA Build', () => {
	let compiler;
	let csn;
	const originalCwd = process.cwd();

	beforeAll(async () => {
		const testDir = await tempUtil.mkTempFolder();
		fs.mkdirSync(path.join(testDir, 'db'), { recursive: true });
		fs.writeFileSync(path.join(testDir, 'db', 'undeploy.json'), '[]');

		process.chdir(testDir);
		cds.root = testDir;
		cds.env = cds.env.for('cds', bookshopDir);
		cds.requires = cds.env.requires;
		require('../../cds-plugin.js');
		compiler = cds.compiler.to.hdi.migration;

		const model = await cds.load([path.join(bookshopDir, 'db'), path.join(bookshopDir, 'srv')]);
		const compiledModel = cds.compile(model);
		csn = cds.linked(compiledModel);

		if (compiledModel.$sources) {
			csn.$sources = compiledModel.$sources;
		}
	});

	afterAll(async () => {
		process.chdir(originalCwd);
		return tempUtil.cleanUp();
	});

	function freshCsn() {
		const copy = JSON.parse(JSON.stringify(csn));
		if (csn.$sources) copy.$sources = csn.$sources;
		return copy;
	}

	describe('CSV data generation', () => {
		let result;
		let csvEntries;

		beforeAll(() => {
			result = compiler(freshCsn(), {});
			csvEntries = result.definitions.filter((def) => def.suffix === '.csv');
		});

		test('Build adds i18nKeys CSV with translations for tracked entities', () => {
			const i18n = csvEntries.find((def) => def.name === 'sap.changelog-i18nKeys');
			expect(i18n).toBeDefined();

			const lines = i18n.sql.trim().split('\n');
			expect(lines[0]).toBe('ID;locale;text');
			expect(lines.length).toBeGreaterThan(1);
			expect(i18n.sql).toMatch(/Books|Authors|Orders/i);
		});

		test('i18n CSV rows have exactly 3 semicolon-separated fields', () => {
			const i18n = csvEntries.find((def) => def.name === 'sap.changelog-i18nKeys');
			const rows = i18n.sql.trim().split('\n').slice(1);

			for (const row of rows) {
				let inQuotes = false;
				let semicolonCount = 0;
				for (let i = 0; i < row.length; i++) {
					if (row[i] === '"' && (i === 0 || row[i - 1] !== '"')) inQuotes = !inQuotes;
					if (row[i] === ';' && !inQuotes) semicolonCount++;
				}
				expect(semicolonCount).toBe(2);
			}
		});
	});

	describe('Trigger generation', () => {
		test('Build adds HDBTRIGGER definitions for change-tracked entities', () => {
			const result = compiler(freshCsn(), {});
			const triggers = result.definitions.filter((def) => def.kind === 'HDBTRIGGER' || (def.sql && def.sql.includes('TRIGGER')));
			expect(triggers.length).toBeGreaterThan(0);
		});
	});
});
