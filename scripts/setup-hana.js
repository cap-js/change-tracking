const { createHash } = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOKSHOP = path.join(ROOT, 'tests', 'bookshop');
const HASH_FILE = path.join(ROOT, '.hana-deploy-hash');

/**
 * Recursively collects all files matching a filter from a directory.
 */
function collectFiles(dir, filter = () => true, skipDirs = []) {
	const results = [];
	if (!fs.existsSync(dir)) return results;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === 'gen' || skipDirs.includes(entry.name)) continue;
			results.push(...collectFiles(fullPath, filter, skipDirs));
		} else if (filter(entry.name)) {
			results.push(fullPath);
		}
	}
	return results;
}

/**
 * Gathers all files whose content affects a HANA deployment.
 */
function getRelevantFiles() {
	const files = [];

	// lib/**/*.js
	const skipDirs = ['h2', 'postgres', 'sqlite'];
	files.push(...collectFiles(path.join(ROOT, 'lib'), (name) => name.endsWith('.js'), skipDirs));

	// Root index.cds
	const indexCds = path.join(ROOT, 'index.cds');
	if (fs.existsSync(indexCds)) files.push(indexCds);

	// cds-plugin.js
	const pluginFile = path.join(ROOT, 'cds-plugin.js');
	if (fs.existsSync(pluginFile)) files.push(pluginFile);

	// tests/bookshop/db/**/*.cds
	files.push(...collectFiles(path.join(BOOKSHOP, 'db'), (name) => name.endsWith('.cds')));

	// tests/bookshop/srv/**/*.cds
	files.push(...collectFiles(path.join(BOOKSHOP, 'srv'), (name) => name.endsWith('.cds')));

	// tests/bookshop config files
	for (const cfg of ['package.json', '.cdsrc.yaml']) {
		const cfgPath = path.join(BOOKSHOP, cfg);
		if (fs.existsSync(cfgPath)) files.push(cfgPath);
	}

	// Sort by relative path for deterministic ordering
	files.sort((a, b) => path.relative(ROOT, a).localeCompare(path.relative(ROOT, b)));
	return files;
}

/**
 * Computes a combined SHA-256 hash over sorted file paths and their contents.
 */
function computeHash(files) {
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(path.relative(ROOT, file));
		hash.update(fs.readFileSync(file));
	}
	return hash.digest('hex');
}

function main() {
	const files = getRelevantFiles();
	const currentHash = computeHash(files);

	const previousHash = fs.existsSync(HASH_FILE) ? fs.readFileSync(HASH_FILE, 'utf8').trim() : null;

	if (currentHash === previousHash) {
		console.log('[setup-hana] No changes detected — skipping HANA deploy.');
		return;
	}

	console.log('[setup-hana] Changes detected — deploying to HANA...');
	try {
		execSync('CDS_ENV=production cds deploy -2 hana', {
			cwd: BOOKSHOP,
			stdio: 'inherit'
		});
	} catch (err) {
		console.error('[setup-hana] HANA deploy failed — hash NOT updated so next run will retry.');
		process.exit(err.status || 1);
	}

	fs.writeFileSync(HASH_FILE, currentHash, 'utf8');
	console.log('[setup-hana] Deploy succeeded — hash saved.');
}

main();
