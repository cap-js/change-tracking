#!/usr/bin/env node
/**
 * Generates trigger SQL for all entities in tests/bookshop/db/incidents/schema.cds
 * for sqlite, postgres, and hana dialects.
 *
 * Output is written to:
 *   trigger/sqlite/<entity>.sql
 *   trigger/postgres/<entity>.sql
 *   trigger/hana/<TriggerName>.hdbtrigger
 *
 * Usage: node generate-triggers.js
 */

const path = require('path');
const fs = require('fs');

const INCIDENTS_NAMESPACE = 'sap.capire.incidents';

async function main() {
  const cds = require('@sap/cds');
  const bookshopDir = path.join(__dirname, 'tests/bookshop');

  // Configure CDS to use bookshop's settings (change-tracking config etc.)
  cds.env = cds.env.for('cds', bookshopDir);

  // Load the full model (db + srv) so service projections are available for entity collection
  const model = await cds.load([path.join(bookshopDir, 'db'), path.join(bookshopDir, 'srv')]);

  // Prepare for trigger generation
  const { prepareCSNForTriggers, generateTriggersForEntities } = require('./lib/utils/trigger-utils');
  const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(model);

  // Filter to only entities from the incidents namespace
  const incidentEntities = entities.filter((e) => e.dbEntityName.startsWith(INCIDENTS_NAMESPACE + '.'));

  console.log(`Found ${incidentEntities.length} entities in namespace "${INCIDENTS_NAMESPACE}":`);
  for (const e of incidentEntities) {
    console.log(`  - ${e.dbEntityName}`);
  }

  // Prepare output directories
  const triggerDir = path.join(__dirname, 'trigger');
  const dirs = {
    sqlite: path.join(triggerDir, 'sqlite'),
    postgres: path.join(triggerDir, 'postgres'),
    hana: path.join(triggerDir, 'hana')
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // --- SQLite ---
  const { generateSQLiteTrigger } = require('./lib/sqlite/triggers');
  const sqliteTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, incidentEntities, generateSQLiteTrigger);
  // SQLite triggers are plain SQL strings; group by entity name extracted from the trigger
  writeSQLiteOutput(dirs.sqlite, sqliteTriggers);

  // --- PostgreSQL ---
  const { generatePostgresTriggers } = require('./lib/postgres/triggers');
  const pgTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, incidentEntities, generatePostgresTriggers);
  // Postgres triggers are SQL strings (CREATE FUNCTION + CREATE TRIGGER); group by function name
  writePostgresOutput(dirs.postgres, pgTriggers);

  // --- HANA ---
  const { generateHANATriggers } = require('./lib/hana/triggers');
  const hanaTriggers = generateTriggersForEntities(runtimeCSN, hierarchy, incidentEntities, generateHANATriggers);
  // HANA triggers are objects { name, sql, suffix }
  writeHanaOutput(dirs.hana, hanaTriggers);

  console.log('\nDone! Triggers written to:');
  console.log(`  ${dirs.sqlite}`);
  console.log(`  ${dirs.postgres}`);
  console.log(`  ${dirs.hana}`);
}

/**
 * Write SQLite triggers grouped by entity.
 * Each trigger SQL starts with "CREATE TRIGGER IF NOT EXISTS <name>_ct_<type>"
 * We group by entity table name (everything before _ct_).
 */
function writeSQLiteOutput(dir, triggers) {
  const grouped = new Map();

  for (const sql of triggers) {
    // Extract entity table name from: CREATE TRIGGER IF NOT EXISTS <tableName>_ct_<type>
    const match = sql.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\S+?)_ct_(create|update|delete)/i);
    const entityTable = match ? match[1] : 'unknown';

    if (!grouped.has(entityTable)) grouped.set(entityTable, []);
    grouped.get(entityTable).push(sql);
  }

  for (const [entityTable, sqls] of grouped) {
    const filePath = path.join(dir, `${entityTable}.sql`);
    fs.writeFileSync(filePath, sqls.join('\n\n') + '\n');
  }

  console.log(`\nSQLite: ${triggers.length} triggers for ${grouped.size} entities`);
}

/**
 * Write PostgreSQL triggers grouped by entity.
 * CREATE FUNCTION and CREATE TRIGGER statements come in pairs.
 * The function name pattern is: <tablename>_func_change
 */
function writePostgresOutput(dir, triggers) {
  const grouped = new Map();

  for (const sql of triggers) {
    // Extract entity table name from CREATE OR REPLACE FUNCTION <name>_func_change or CREATE OR REPLACE TRIGGER <name>_tr_change
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
