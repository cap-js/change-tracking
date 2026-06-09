const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, buildLabelsSQL } = require('../utils/trigger-utils.js');

/**
 * Registers a `compile.to.dbx` hook that appends SQLite change-tracking
 * triggers, indexes, and i18n label DML to the DDL produced by
 * `cds.compile.to.sql` (full compile) and `cds.compile.to.sql.delta`
 * (schema evolution).
 */
function registerSQLiteCompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    if (options?.kind !== 'sqlite') return ddl;

    const { generateSQLiteTrigger } = require('./triggers.js');
    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn);

    const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateSQLiteTrigger);
    if (triggers.length === 0) return ddl;

    // Build matching DROP TRIGGER statements for idempotent re-deploy / delta upgrades
    const triggerNames = triggers.map((t) => t.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\w+)/i)?.[1]).filter(Boolean);
    const triggerDrops = triggerNames.map((n) => `DROP TRIGGER IF EXISTS ${n};`);

    const indexes = [
      `CREATE INDEX IF NOT EXISTS sap_changelog_Changes_ct_index ON sap_changelog_Changes (entity, entityKey, attribute, valueDataType, transactionID)`,
      `CREATE INDEX IF NOT EXISTS sap_changelog_Changes_parent_index ON sap_changelog_Changes (parent_ID)`
    ];

    // Emit i18n labels as inline DELETE+INSERT SQL.
    const labelStmts = buildLabelsSQL(entities, runtimeCSN, 'sap_changelog_i18nKeys');

    if (Array.isArray(ddl)) {
      // full compile path (cds.compile.to.sql)
      ddl.push(...triggerDrops, ...triggers, ...indexes, ...labelStmts);
    } else if (ddl.createsAndAlters) {
      // delta path (cds.compile.to.sql.delta)
      if (Array.isArray(ddl.drops)) ddl.drops.push(...triggerDrops);
      ddl.createsAndAlters.push(...triggers, ...indexes, ...labelStmts);
    }
    return ddl;
  });
}

module.exports = { registerSQLiteCompilerHook };
