const cds = require('@sap/cds');

const { getEntitiesForTriggerGeneration, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');
const { generateTriggersForEntities } = require('../utils/trigger-utils.js');

async function _deployTriggersAndLabels(model) {
  const { generateSQLiteTrigger } = require('./triggers.js');
  const { collectedEntities, hierarchyMap } = collectEntities(model);
  const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);

  const triggers = generateTriggersForEntities(model, hierarchyMap, entities, generateSQLiteTrigger);
  if (triggers.length === 0) return;

  // Drop existing triggers
  const dropTriggerStmts = triggers.map((t) => t.match(/CREATE\s+TRIGGER\s+IF NOT EXISTS\s+(\w+)/i)).map((m) => `DROP TRIGGER IF EXISTS ${m[1]};`);
  for (const stmt of dropTriggerStmts) await cds.db.run(stmt);

  const labels = getLabelTranslations(entities, model);
  const { i18nKeys } = cds.entities('sap.changelog');

  // Create triggers and indexes
  await Promise.all([
    ...triggers.map((t) => cds.db.run(t)),
    cds.db.run(`CREATE INDEX IF NOT EXISTS sap_changelog_Changes_ct_index ON sap_changelog_Changes (entity, entityKey, attribute, valueDataType, transactionID)`),
    cds.db.run(`CREATE INDEX IF NOT EXISTS sap_changelog_Changes_parent_index ON sap_changelog_Changes (parent_ID)`),
    cds.delete(i18nKeys),
    cds.insert(labels).into(i18nKeys)
  ]);
}

async function deploySQLiteTriggers() {
  const db = cds.env.requires?.db;
  if (db?.kind !== 'sqlite') return;

  // in multitenancy scenario the DeploymentService handler deploys triggers after each tenant's schema is created
  if (cds.env.requires?.multitenancy) return;

  const model = cds.context?.model ?? cds.model;
  await _deployTriggersAndLabels(model);
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

      // Skip for the t0 metadata tenant because it doesn't contain the application model
      const tenant = req.data?.tenant ?? cds.context?.tenant;
      const t0 = cds.env.requires?.multitenancy?.t0 ?? 't0';
      if (tenant === t0) return;

      // Get the tenant's application model from the ModelProviderService
      const { 'cds.xt.ModelProviderService': mps } = cds.services;
      const cached = await mps.getCsn({ tenant, toggles: ['*'], activated: true });
      const csn = structuredClone(cached);

      // Compile for Node.js runtime (needed for trigger generation)
      const model = cds.compile.for.nodejs(csn);
      await _deployTriggersAndLabels(model);
    });
  });
}

module.exports = { registerSQLiteDeploymentHandler, deploySQLiteTriggers };
