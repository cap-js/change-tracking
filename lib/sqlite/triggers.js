const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionHierarchy, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, buildObjectIDExpr, buildTriggerContext, buildInsertSQL, toSQL, quote } = require('./sql-expressions.js');
const { buildCompositionParentContext } = require('./composition.js');

/**
 * Builds an objectID SQL expression from a parsed composition-field @changelog annotation.
 * Returns `null` when the annotation cannot be parsed.
 *
 * @param {Array} compositionFieldChangelog - Normalized @changelog entries on the composition field
 * @param {object} parentEntity - The parent entity definition
 * @param {Array} parentKeyBinding - FK fields on the child pointing to the parent
 * @param {string} refRow - Trigger row reference ('new' or 'old')
 * @param {object} model - The CDS model (CSN)
 * @returns {string|null}
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, model) {
  const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, quote);
  if (!parsed) return null;

  if (parsed.type === 'expression') {
    const query = SELECT.one.from(parentEntity.name).columns(parsed.exprColumn).where(parsed.where);
    return `(${toSQL(query, model)})`;
  }

  const parentKeys = utils.extractKeys(parentEntity.keys);
  return buildObjectIDExpr(parsed.objectIDs, parentEntity, parentKeys, refRow, model);
}

/**
 * Generates a single SQLite trigger (CREATE / UPDATE / DELETE) for an entity.
 * Combines optional cleanup (delete mode), composition parent INSERTs, and
 * column-change INSERTs into one trigger body.
 *
 * @param {object} entity - The CDS entity definition
 * @param {Array} columns - Tracked column descriptors
 * @param {Array} objectIDs - @changelog objectIDs of the entity
 * @param {Array} parentObjectIDs - @changelog objectIDs of the immediate parent entity
 * @param {object} model - The CDS model (CSN)
 * @param {'create'|'update'|'delete'} modification - The modification type
 * @param {object|null} compositionHierarchy - Composition hierarchy from `getCompositionHierarchy`
 * @returns {string} A `CREATE TRIGGER IF NOT EXISTS ...` statement
 */
function generateTrigger(entity, columns, objectIDs, parentObjectIDs, model, modification, compositionHierarchy) {
  const refRow = modification === 'delete' ? 'old' : 'new';
  const ctx = buildTriggerContext(entity, objectIDs, refRow, model);

  let compositionParentContext = null;
  if (compositionHierarchy) {
    compositionParentContext = buildCompositionParentContext(compositionHierarchy, parentObjectIDs, refRow, model, ctx.objectID, (changelog, parentEntity, keyBinding) =>
      buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, refRow, model)
    );
    ctx.parentLookupExpr = compositionParentContext.parentLookupExpr;
  }

  // Build trigger body parts
  const bodyParts = [];

  // Delete trigger (non-preserve mode): prepend DELETE FROM statement
  if (modification === 'delete' && !config?.preserveDeletes) {
    bodyParts.push(`DELETE FROM ${utils.transformName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${ctx.entityKey};`);
  }

  // Composition parent INSERT (if applicable)
  if (compositionParentContext) {
    bodyParts.push(compositionParentContext.insertSQL);
  }

  // Column changes INSERT (if there are tracked columns)
  if (columns.length > 0) {
    bodyParts.push(buildInsertSQL(entity, columns, modification, ctx, model));
  }

  const bodySQL = bodyParts.join('\n        ');

  // Build event clause
  let eventClause;
  if (modification === 'create') {
    eventClause = 'AFTER INSERT';
  } else if (modification === 'update') {
    const ofColumns = [
      ...new Set(
        columns.flatMap((c) => {
          if (!c.target) return [quote(c.name)];
          if (c.foreignKeys) return c.foreignKeys.map((k) => quote(`${c.name}_${k}`));
          if (c.on) return c.on.map((m) => quote(m.foreignKeyField));
          return [];
        })
      )
    ];
    const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';
    eventClause = `AFTER UPDATE ${ofClause}`;
  } else {
    eventClause = 'AFTER DELETE';
  }

  return `CREATE TRIGGER IF NOT EXISTS ${utils.transformName(entity.name)}_ct_${modification} ${eventClause}
    ON ${utils.transformName(entity.name)}
    WHEN ${getSkipCheckCondition(entity.name)}
    BEGIN
        ${bodySQL}
    END;`;
}

/**
 * Generates SQLite triggers for an entity based on its tracked columns and composition role.
 *
 * @param {object} csn - The CDS model (CSN)
 * @param {object} entity - The entity to generate triggers for
 * @param {object|null} parentEntity - The immediate parent entity, if any
 * @param {object} [mergedAnnotations] - Merged annotations for `entity`
 * @param {object} [parentMergedAnnotations] - Merged annotations for `parentEntity`
 * @param {object} [grandParentContext] - Ancestor context (`{ ancestorChain, ... }`)
 * @returns {string|string[]|null} A single trigger SQL, an array of triggers, or `null`
 */
function generateSQLiteTrigger(csn, entity, parentEntity, mergedAnnotations = null, parentMergedAnnotations = null, grandParentContext = {}) {
  const triggers = [];
  const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
  const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
  const parentObjectIDs = utils.getObjectIDs(parentEntity, csn, parentMergedAnnotations?.entityAnnotation);

  // Resolve composition hierarchy (immediate parent + ancestors)
  const { ancestorChain } = grandParentContext;
  const compositionHierarchy = getCompositionHierarchy(entity, parentEntity, parentMergedAnnotations, ancestorChain ?? [], csn);

  // Generate triggers if we have tracked columns OR if this is a composition target
  const shouldGenerateTriggers = trackedColumns.length > 0 || compositionHierarchy;

  if (shouldGenerateTriggers) {
    const modifications = [];
    if (!config?.disableCreateTracking) modifications.push('create');
    if (!config?.disableUpdateTracking) modifications.push('update');
    if (!config?.disableDeleteTracking) modifications.push('delete');

    for (const modification of modifications) {
      triggers.push(generateTrigger(entity, trackedColumns, objectIDs, parentObjectIDs, csn, modification, compositionHierarchy));
    }
  }

  return triggers.length === 1 ? triggers[0] : triggers.length > 0 ? triggers : null;
}

module.exports = { generateSQLiteTrigger };
