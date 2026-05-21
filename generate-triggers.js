#!/usr/bin/env node
/**
 * Generates trigger SQL for multiple projects and dialects.
 *
 * Projects:
 *   1. tests/bookshop (incidents namespace only) -> trigger/sqlite, trigger/postgres, trigger/hana
 *   2. tests/performance/perf-bookshop (all entities) -> trigger/perf-bookshop/sqlite, trigger/perf-bookshop/postgres, trigger/perf-bookshop/hana
 *
 * Each entity gets one file containing all its triggers (create + update + delete).
 *
 * Usage: node generate-triggers.js
 */

const path = require('path');
const fs = require('fs');

const projects = [
  {
    name: 'bookshop (incidents)',
    dir: 'tests/bookshop',
    modelPaths: ['db', 'srv'],
    filter: (e) => e.dbEntityName.startsWith('sap.capire.incidents.'),
    outputDir: 'trigger'
  },
  {
    name: 'perf-bookshop',
    dir: 'tests/performance/perf-bookshop',
    modelPaths: ['db/schema.cds', 'srv/services.cds'],
    filter: null,
    outputDir: 'trigger/perf-bookshop'
  }
];

async function main() {
  for (const project of projects) {
    await generateTriggersForProject(project);
  }
}

async function generateTriggersForProject({ name, dir, modelPaths, filter, outputDir }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Project: ${name}`);
  console.log(`${'='.repeat(60)}`);

  const cds = require('@sap/cds');
  const projectDir = path.join(__dirname, dir);

  // Configure CDS to use this project's settings
  cds.env = cds.env.for('cds', projectDir);

  // Load the full model
  const model = await cds.load(modelPaths.map((p) => path.join(projectDir, p)));

  // Prepare for trigger generation
  const { prepareCSNForTriggers, generateTriggersForEntities } = require('./lib/utils/trigger-utils');
  const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(model);

  // Optionally filter entities
  const targetEntities = filter ? entities.filter(filter) : entities;

  console.log(`Found ${targetEntities.length} entities:`);
  for (const e of targetEntities) {
    console.log(`  - ${e.dbEntityName}`);
  }

  // Prepare output directories
  const baseDir = path.join(__dirname, outputDir);
  const dirs = {
    sqlite: path.join(baseDir, 'sqlite'),
    postgres: path.join(baseDir, 'postgres'),
    hana: path.join(baseDir, 'hana')
  };
  for (const d of Object.values(dirs)) {
    fs.mkdirSync(d, { recursive: true });
  }

  // --- SQLite ---
  const { generateSQLiteTrigger } = require('./lib/sqlite/triggers');
  const sqliteTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, targetEntities, generateSQLiteTrigger);
  writeSQLiteOutput(dirs.sqlite, sqliteTriggers);

  // --- PostgreSQL ---
  const { generatePostgresTriggers } = require('./lib/postgres/triggers');
  const pgTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, targetEntities, generatePostgresTriggers);
  writePostgresOutput(dirs.postgres, pgTriggers);

  // --- HANA ---
  try {
    const { generateHANATriggers } = require('./lib/hana/triggers');
    const hanaTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, targetEntities, generateHANATriggers);
    writeHanaOutput(dirs.hana, hanaTriggers);
  } catch (err) {
    console.log(`HANA: SKIPPED (error: ${err.message})`);
  }

  console.log(`\nOutput written to: ${baseDir}`);
}

/**
 * Write SQLite triggers grouped by entity.
 * Each trigger SQL starts with "CREATE TRIGGER IF NOT EXISTS <name>_ct_<type>"
 * We group by entity table name (everything before _ct_).
 */
function writeSQLiteOutput(dir, triggers) {
  const grouped = new Map();

  for (const sql of triggers) {
    const match = sql.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\S+?)_ct_(create|update|delete)/i);
    const entityTable = match ? match[1] : 'unknown';

    if (!grouped.has(entityTable)) grouped.set(entityTable, []);
    grouped.get(entityTable).push(sql);
  }

  for (const [entityTable, sqls] of grouped) {
    const filePath = path.join(dir, `${entityTable}.sql`);
    fs.writeFileSync(filePath, sqls.join('\n\n') + '\n');
  }

  console.log(`SQLite: ${triggers.length} triggers for ${grouped.size} entities`);
}

/**
 * Write PostgreSQL triggers grouped by entity.
 * CREATE FUNCTION and CREATE TRIGGER statements come in pairs.
 */
function writePostgresOutput(dir, triggers) {
  const grouped = new Map();

  for (const sql of triggers) {
    const funcMatch = sql.match(/(?:FUNCTION|TRIGGER)\s+(\S+?)_(?:func|tr)_change/i);
    const entityTable = funcMatch ? funcMatch[1] : 'unknown';

    if (!grouped.has(entityTable)) grouped.set(entityTable, []);
    grouped.get(entityTable).push(sql);
  }

  for (const [entityTable, sqls] of grouped) {
    const filePath = path.join(dir, `${entityTable}.sql`);
    fs.writeFileSync(filePath, sqls.join('\n\n') + '\n');
  }

  console.log(`PostgreSQL: ${triggers.length} trigger statements for ${grouped.size} entities`);
}

/**
 * Write HANA triggers as individual .hdbtrigger files.
 * Each trigger object has { name, sql, suffix: '.hdbtrigger' }.
 */
function writeHanaOutput(dir, triggers) {
  for (const trigger of triggers) {
    const fileName = trigger.name.replace(/\./g, '_') + (trigger.suffix || '.hdbtrigger');
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, trigger.sql + '\n');
  }

  console.log(`HANA: ${triggers.length} .hdbtrigger files`);
}

main().catch((err) => {
  console.error('Error generating triggers:', err);
  process.exit(1);
});
