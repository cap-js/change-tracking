const cds = require('@sap/cds');

const { getEntitiesForTriggerGeneration, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');
const { prepareCSNForTriggers, generateTriggersForEntities } = require('../utils/trigger-utils.js');
const { enhanceModel } = require('../csn-enhancements');

function registerPostgresCompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    if (options?.dialect !== 'postgres') return ddl;

    const { generatePostgresTriggers } = require('./triggers.js');
    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn);

    const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generatePostgresTriggers);

    if (triggers.length === 0) return ddl;

    triggers.push(`CREATE INDEX IF NOT EXISTS sap_changelog_changes_ct_idx ON sap_changelog_changes (entity, entitykey, attribute, valuedatatype, transactionid)`);
    triggers.push(`CREATE INDEX IF NOT EXISTS sap_changelog_changes_parent_idx ON sap_changelog_changes (parent_id)`);

    // Handle standard compilation (array) or delta compilation (object with createsAndAlters/drops)
    if (Array.isArray(ddl)) {
      ddl.push(...triggers);
    } else if (ddl.createsAndAlters) {
      ddl.createsAndAlters.push(...triggers);
    }

    return ddl;
  });
}

async function deployPostgresLabels() {
  const db = cds.env.requires?.db;
  if (db?.kind !== 'postgres') return;

  const model = cds.context?.model ?? cds.model;
  const { collectedEntities } = collectEntities(model);
  const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);
  const labels = getLabelTranslations(entities, model);
  const { i18nKeys } = cds.entities('sap.changelog');

  await Promise.all([cds.delete(i18nKeys), cds.insert(labels).into(i18nKeys)]);
}

/**
 * Deploys the service-level ChangeView SQL views (e.g., AdminService_ChangeView)
 * that are added by enhanceModel but missing from the deployed schema because
 * the ModelProviderService compiles the CSN without firing the 'loaded' event.
 */
async function _deployChangeViews(csn) {
  const sql = cds.compile.to.sql(csn, { kind: 'postgres' });
  const changeViewDDL = sql.filter((stmt) => /CREATE VIEW\s+\S*ChangeView/i.test(stmt));
  for (const stmt of changeViewDDL) {
    const viewName = stmt.match(/CREATE VIEW\s+("[^"]+"|[^\s(]+)/i)?.[1];
    if (viewName) await cds.db.run(`DROP VIEW IF EXISTS ${viewName}`);
    await cds.db.run(stmt);
  }
}

/**
 * Registers a handler on the DeploymentService to deploy service-level ChangeViews
 * and labels after each tenant's database schema is deployed in MTX scenarios.
 * Triggers and indexes are already handled by the compile.to.dbx hook.
 */
function registerPostgresDeploymentHandler() {
  cds.once('served', async () => {
    const ds = await cds.connect.to('cds.xt.DeploymentService');
    ds.after('deploy', async (_, req) => {
      const db = cds.env.requires?.db;
      if (db?.kind !== 'postgres') return;

      // Skip for the t0 metadata tenant — it doesn't contain the application model
      const tenant = req.data?.tenant ?? cds.context?.tenant;
      const t0 = cds.env.requires?.multitenancy?.t0 ?? 't0';
      if (tenant === t0) return;

      // Get the tenant's application model from the ModelProviderService
      const { 'cds.xt.ModelProviderService': mps } = cds.services;
      const csn = await mps.getCsn({ tenant, toggles: ['*'], activated: true });

      // Enhance the CSN with service-level ChangeView definitions.
      // This is needed because getCsn() compiles in a worker thread with silent:true,
      // so the cds.on('loaded', enhanceModel) handler never fires on the tenant CSN.
      enhanceModel(csn);

      // Deploy service-level ChangeViews (e.g., AdminService_ChangeView)
      await _deployChangeViews(csn);

      // Deploy labels
      const model = cds.compile.for.nodejs(csn);
      const { collectedEntities } = collectEntities(model);
      const entities = getEntitiesForTriggerGeneration(model.definitions, collectedEntities);
      const labels = getLabelTranslations(entities, model);
      const { i18nKeys } = cds.entities('sap.changelog');
      await Promise.all([cds.delete(i18nKeys), cds.insert(labels).into(i18nKeys)]);
    });
  });
}

module.exports = { registerPostgresCompilerHook, registerPostgresDeploymentHandler, deployPostgresLabels };
