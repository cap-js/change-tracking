#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');

const projectPath = path.resolve(process.argv[2] || process.cwd());

if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
	console.error(`Error: No package.json found in "${projectPath}". Please provide a valid CAP project path.`);
	process.exit(1);
}

process.chdir(projectPath);

const cds = require('@sap/cds');
cds.root = projectPath;

async function main() {
	// Load the plugin to register model enhancements
	require(path.join(__dirname, '..', 'cds-plugin.js'));

	// Load and compile the CDS model
	const model = await cds.load('*');
	const compiledModel = cds.compile(model);
	const csn = cds.linked(compiledModel);
	if (compiledModel.$sources) csn.$sources = compiledModel.$sources;

	// Prepare trigger context (reuses the same infrastructure as trigger generation)
	const { prepareCSNForTriggers } = require('../lib/utils/trigger-utils.js');
	const { generateRestoreBacklinksProcedure } = require('../lib/hana/procedure.js');

	const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);
	const procedure = generateRestoreBacklinksProcedure(runtimeCSN, hierarchy, entities);

	if (!procedure) {
		console.log('No composition relationships found — nothing to generate.');
		process.exit(0);
	}

	// Write the procedure to db/src/
	const outputDir = path.join(projectPath, 'db', 'src');
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const outputFile = path.join(outputDir, `${procedure.name}${procedure.suffix}`);
	fs.writeFileSync(outputFile, procedure.sql);

	console.log(`Generated ${path.relative(projectPath, outputFile)}`);
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
