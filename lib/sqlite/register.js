const cds = require('@sap/cds');

const { getEntitiesForTriggerGeneration, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');
const { generateTriggersForEntities } = require('../utils/trigger-utils.js');

/**
 * Deploys SQLite triggers, indexes, and labels for change tracking.
 * Generates triggers from the given model and executes them sequentially
 * against the current database connection.
 */
async function _deploySQLiteTriggersAndLabels(model) {
  const { generateSQLiteTrigger } = require('./triggers.js');
  const { collectedEntities, hierarchyMap } = collectEntities(model);
  const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);

  const triggers = generateTriggersForEntities(model, hierarchyMap, entities, generateSQLiteTrigger);
  if (triggers.length === 0) return;

  const dropTriggers = triggers.map((t) => t.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\w+)/i)).map((m) => `DROP TRIGGER IF EXISTS ${m[1]};`);

  const labels = getLabelTranslations(entities, model);
  const { i18nKeys } = cds.entities('sap.changelog');

  // Drop existing triggers
  await Promise.all(dropTriggers.map((t) => cds.db.run(t)));

  // Create triggers and indexes
  await Promise.all([
    ...triggers.map((t) => cds.db.run(t)),
    cds.db.run(`CREATE INDEX IF NOT EXISTS sap_changelog_Changes_ct_index ON sap_changelog_Changes (entity, entityKey, attribute, valueDataType, transactionID)`),
    cds.db.run(`CREATE INDEX IF NOT EXISTS sap_changelog_Changes_parent_index ON sap_changelog_Changes (parent_ID)`)
  ]);

  // Refresh i18n labels
  await cds.delete(i18nKeys);
  await cds.insert(labels).into(i18nKeys);
}

/**
 * Deploys SQLite triggers, indexes, and labels for single-tenant scenarios.
 * Skipped when multitenancy is enabled because the DeploymentService handler
 * takes care of deploying triggers after each tenant's schema is created.
 */
async function deploySQLiteTriggers() {
  const db = cds.env.requires?.db;
  if (db?.kind !== 'sqlite') return;

  if (cds.env.requires?.multitenancy) return;

  const model = cds.context?.model ?? cds.model;
  await _deploySQLiteTriggersAndLabels(model);
}

/**
 * Registers an after handler on the DeploymentService to deploy SQLite triggers,
 * indexes, labels, and service-level ChangeViews after each tenant's database
 * schema is deployed.
 */
function registerSQLiteDeploymentHandler() {
  cds.on('serving:cds.xt.DeploymentService', (ds) => {
    ds.after('deploy', async (_, req) => {
      const db = cds.env.requires?.db;
      if (db?.kind !== 'sqlite') return;

      // Skip for the t0 metadata tenant — it doesn't contain the application model
      const tenant = req.data?.tenant ?? cds.context?.tenant;
      const t0 = cds.env.requires?.multitenancy?.t0 ?? 't0';
      if (tenant === t0) return;

      // Get the tenant's application model from the ModelProviderService
      const { 'cds.xt.ModelProviderService': mps } = cds.services;
      const cached = await mps.getCsn({ tenant, toggles: ['*'], activated: true });
      const csn = structuredClone(cached);

      // Compile for Node.js runtime (needed for trigger generation)
      const model = cds.compile.for.nodejs(csn);
      await _deploySQLiteTriggersAndLabels(model);
    });
  });
}

module.exports = { registerSQLiteDeploymentHandler, deploySQLiteTriggers };
