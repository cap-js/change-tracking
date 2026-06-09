const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');

const { fs } = cds.utils;

const { getEntitiesForTriggerGeneration, analyzeCompositions, collectEntities } = require('./entity-collector.js');
const { getLabelTranslations } = require('../localization.js');

/**
 * Prepares a CSN for trigger generation by deep-cloning, compiling for the Node.js
 * runtime, and analyzing composition relationships.
 *
 * @param {object} csn - The CDS model (CSN) to prepare
 * @param {boolean} [preserveSources=false] - When true, copies `$sources` to the runtime CSN
 * @returns {{ runtimeCSN: object, hierarchy: Map, entities: Array }}
 */
function prepareCSNForTriggers(csn, preserveSources = false) {
  const clonedCSN = structuredClone(csn);
  if (preserveSources) clonedCSN.$sources = csn.$sources;
  const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
  if (preserveSources) runtimeCSN.$sources = csn.$sources;
  const { collectedEntities } = collectEntities(runtimeCSN);
  const hierarchy = analyzeCompositions(runtimeCSN);
  const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);
  return { runtimeCSN, hierarchy, entities };
}

/**
 * Iterates over collected entities, resolves their composition parent and ancestor
 * chain, and invokes the DB-specific generator for each.
 *
 * @param {object} runtimeCSN - The runtime CSN
 * @param {Map} hierarchy - Map of entity → { parent, ancestors[], grandParent, ... }
 * @param {Array} entities - Entities collected for trigger generation
 * @param {Function} generator - DB-specific generator
 *   `(csn, entity, parentEntity, mergedAnnotations, parentMergedAnnotations, ctx) => string|object|Array`
 * @returns {Array} Flattened list of generated triggers
 */
function generateTriggersForEntities(runtimeCSN, hierarchy, entities, generator) {
  const triggers = [];
  for (const { dbEntityName, mergedAnnotations } of entities) {
    const entity = runtimeCSN.definitions[dbEntityName];
    if (!entity) continue;

    const hierarchyInfo = hierarchy.get(dbEntityName);
    const parentEntityName = hierarchyInfo?.parent ?? null;
    const parentEntity = parentEntityName ? runtimeCSN.definitions[parentEntityName] : null;
    const parentMergedAnnotations = parentEntityName ? entities.find((d) => d.dbEntityName === parentEntityName)?.mergedAnnotations : null;

    // Resolve full ancestor chain for deep linking
    const ancestorChain = (hierarchyInfo?.ancestors ?? []).map((a) => ({
      entity: runtimeCSN.definitions[a.entity] ?? null,
      mergedAnnotations: entities.find((d) => d.dbEntityName === a.entity)?.mergedAnnotations ?? null,
      compositionField: a.compositionField
    }));

    // Backward-compatible grandParentContext derived from ancestorChain[0]
    const grandParentEntity = ancestorChain[0]?.entity ?? null;
    const grandParentMergedAnnotations = ancestorChain[0]?.mergedAnnotations ?? null;
    const grandParentCompositionField = ancestorChain[0]?.compositionField ?? null;

    const result = generator(runtimeCSN, entity, parentEntity, mergedAnnotations, parentMergedAnnotations, {
      grandParentEntity,
      grandParentMergedAnnotations,
      grandParentCompositionField,
      ancestorChain
    });
    if (result) triggers.push(...(Array.isArray(result) ? result : [result]));
  }
  return triggers;
}

/**
 * Write i18n labels CSV file for H2/HDI deployments.
 */
function writeLabelsCSV(entities, model) {
  const labels = getLabelTranslations(entities, model);
  const header = 'ID;locale;text';
  const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
  const content = [header, ...rows].join('\n') + '\n';
  const dir = 'db/src/gen/data/';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(`${dir}/sap.changelog-i18nKeys.csv`, content);
}

/**
 * Build SQL statements (DELETE + INSERT) to (re)populate the
 * `sap.changelog.i18nKeys` table with label translations.
 *
 * Used by SQLite/Postgres compile hooks to inject labels directly into
 * the deploy DDL stream, avoiding file writes that would conflict with
 * `cds watch`'s file-watcher.
 *
 * @param {Array}  entities      Entities collected for trigger generation
 * @param {object} model         Runtime CSN
 * @param {string} table         Physical table name (dialect-specific case)
 * @param {object} [opts]
 * @param {string[]} [opts.cols] Column names in the target table, in
 *                               the order ID, locale, text. Defaults to
 *                               ['ID', 'locale', 'text'].
 * @returns {string[]} Array of SQL statements; empty when there are no labels.
 */
function buildLabelsSQL(entities, model, table, { cols = ['ID', 'locale', 'text'] } = {}) {
  const labels = getLabelTranslations(entities, model);
  if (labels.length === 0) return [`DELETE FROM ${table};`];
  const esc = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
  const rows = labels.map((r) => `(${esc(r.ID)}, ${esc(r.locale)}, ${esc(r.text)})`);
  return [`DELETE FROM ${table};`, `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n  ${rows.join(',\n  ')};`];
}

/**
 * Ensures the undeploy.json file contains the hdbtrigger pattern.
 */
function ensureUndeployJsonHasTriggerPattern() {
  const undeployPath = 'db/undeploy.json';
  const triggerPattern = 'src/gen/**/*.hdbtrigger';

  let undeploy = [];
  if (fs.existsSync(undeployPath)) {
    undeploy = JSON.parse(fs.readFileSync(undeployPath, 'utf8'));
  }
  if (!Array.isArray(undeploy)) return;

  if (!undeploy.includes(triggerPattern)) {
    undeploy.push(triggerPattern);
    fs.writeFileSync(undeployPath, JSON.stringify(undeploy, null, 4) + '\n');
    LOG.info(`Added '${triggerPattern}' to ${undeployPath}`);
  }
}

module.exports = {
  prepareCSNForTriggers,
  generateTriggersForEntities,
  writeLabelsCSV,
  buildLabelsSQL,
  ensureUndeployJsonHasTriggerPattern
};
