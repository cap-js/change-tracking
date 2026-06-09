const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, buildLabelsSQL } = require('../utils/trigger-utils.js');

/**
 * Registers a `compile.to.dbx` hook that appends Postgres change-tracking
 * triggers, indexes, and i18n label DML to the DDL produced by
 * `cds.compile.to.sql` (full compile) and `cds.compile.to.sql.delta`
 * (schema evolution).
 */
function registerPostgresCompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    if (options?.kind !== 'postgres') return ddl;

    const { generatePostgresTriggers } = require('./triggers.js');
    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn);

    const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generatePostgresTriggers);
    if (triggers.length === 0) return ddl;

    triggers.push(`CREATE INDEX IF NOT EXISTS sap_changelog_changes_ct_idx ON sap_changelog_changes (entity, entitykey, attribute, valuedatatype, transactionid)`);
    triggers.push(`CREATE INDEX IF NOT EXISTS sap_changelog_changes_parent_idx ON sap_changelog_changes (parent_id)`);

    // Emit i18n labels as inline DELETE+INSERT SQL.
    // Postgres folds unquoted identifiers to lowercase.
    const labelStmts = buildLabelsSQL(entities, runtimeCSN, 'sap_changelog_i18nkeys', { cols: ['id', 'locale', 'text'] });
    triggers.push(...labelStmts);

    // Handle standard compilation (array) or delta compilation (object with createsAndAlters/drops)
    if (Array.isArray(ddl)) {
      ddl.push(...triggers);
    } else if (ddl.createsAndAlters) {
      ddl.createsAndAlters.push(...triggers);
    }

    return ddl;
  });
}

module.exports = { registerPostgresCompilerHook };
