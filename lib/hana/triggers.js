const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { getCompositionHierarchy, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, getElementSkipCondition, getValueExpr, getWhereCondition, getLabelExpr, buildObjectIDExpr, buildTriggerContext, quote } = require('./sql-expressions.js');
const { buildCompositionParentContext, buildParentLookupOrCreateSQL, buildCompositionOnlyBody } = require('./composition.js');

/**
 * Builds an objectID SQL expression from a parsed composition-field @changelog annotation.
 * Returns `null` when the annotation cannot be parsed.
 *
 * @param {Array} compositionFieldChangelog - Normalized @changelog entries on the composition field
 * @param {object} parentEntity - The parent entity definition
 * @param {Array} parentKeyBinding - FK fields on the child pointing to the parent
 * @param {string} rowRef - Trigger row reference ('new' or 'old')
 * @param {object} model - CSN model
 * @returns {string|null}
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntity, parentKeyBinding, rowRef, model) {
  const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, `:${rowRef}`, quote);
  if (!parsed) return null;

  if (parsed.type === 'expression') {
    const query = SELECT.one.from(parentEntity.name).columns(parsed.exprColumn).where(parsed.where);
    const { toSQL } = require('./sql-expressions.js');
    return `TO_NVARCHAR((${toSQL(query, model)}))`;
  }

  const { buildCompOfManyRootObjectIDSelect } = require('./composition.js');
  return buildCompOfManyRootObjectIDSelect(parentEntity, parsed.objectIDs, parentKeyBinding, rowRef, model);
}

function buildInsertSQL(entity, columns, modification, ctx, model) {
  // Generate single UNION ALL query for all changed columns
  const unionQuery = columns
    .map((col) => {
      const whereCondition = getWhereCondition(col, modification);
      const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
      let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

      // For composition-of-one columns, add deduplication check to prevent duplicate entries
      // when child trigger has already created a composition entry for this transaction
      if (col.type === 'cds.Composition' && ctx.entityKey) {
        fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${entity.name}'
			AND entityKey = ${ctx.entityKey}
			AND attribute = '${col.name}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		)`;
      }

      const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, 'old');
      const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, 'new');
      const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, 'old', model, entity);
      const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, 'new', model, entity);

      const dataType = col.altExpression ? 'cds.String' : col.type;

      return `SELECT '${col.name}' AS attribute, ${oldVal} AS valueChangedFrom, ${newVal} AS valueChangedTo, ${oldLabel} AS valueChangedFromLabel, ${newLabel} AS valueChangedToLabel, '${dataType}' AS valueDataType FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY WHERE ${fullWhere}`;
    })
    .join('\nUNION ALL\n');

  return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			${ctx.parentLookupExpr ?? 'NULL'},
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'${entity.name}',
			${ctx.entityKey},
			${ctx.objectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			valueDataType,
			'${modification}',
			CURRENT_UPDATE_TRANSACTION()
		FROM (
			${unionQuery}
		);`;
}

function wrapInSkipCheck(entityName, insertSQL, compositionParentContext = null) {
  if (compositionParentContext) {
    const { declares } = compositionParentContext;
    return `${declares}
	IF ${getSkipCheckCondition(entityName)} THEN
		${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
  }
  return `IF ${getSkipCheckCondition(entityName)} THEN
		${insertSQL}
	END IF;`;
}

/**
 * Generates a single HANA trigger (CREATE / UPDATE / DELETE) for an entity.
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
 * @returns {{ name: string, sql: string, suffix: string }}
 */
function generateTrigger(entity, columns, objectIDs, parentObjectIDs, model, modification, compositionHierarchy) {
  const refRow = modification === 'delete' ? 'old' : 'new';
  const ctx = buildTriggerContext(entity, objectIDs, refRow, model);

  // Build context for composition parent entry if this is a tracked composition target
  const compositionParentContext = compositionHierarchy
    ? buildCompositionParentContext(compositionHierarchy, parentObjectIDs, refRow, model, buildObjectIDExpr(objectIDs, entity, refRow, model), (changelog, parentEntity, keyBinding) =>
        buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, refRow, model)
      )
    : null;

  if (compositionParentContext) ctx.parentLookupExpr = 'parent_id';

  // Optional cleanup for non-preserve delete
  const deleteSQL = modification === 'delete' && !config?.preserveDeletes ? `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey = ${ctx.entityKey};` : '';

  // Build trigger body
  let body;
  if (columns.length === 0 && compositionParentContext) {
    // Composition-only case: only insert composition parent entry, no child column inserts
    body = buildCompositionOnlyBody(entity.name, compositionParentContext, deleteSQL);
  } else if (compositionParentContext) {
    // Mixed case: both composition parent entry and child column inserts
    const insertSQL = buildInsertSQL(entity, columns, modification, ctx, model);
    const { declares } = compositionParentContext;
    const prefix = deleteSQL ? `${deleteSQL}\n\t\t` : '';
    body = `${declares}
	IF ${getSkipCheckCondition(entity.name)} THEN
		${prefix}${buildParentLookupOrCreateSQL(compositionParentContext)}
		${insertSQL}
	END IF;`;
  } else {
    // No composition: standard insert (with optional delete cleanup)
    const insertSQL = buildInsertSQL(entity, columns, modification, ctx, model);
    const innerSQL = deleteSQL ? `${deleteSQL}\n\t\t${insertSQL}` : insertSQL;
    body = wrapInSkipCheck(entity.name, innerSQL);
  }

  // Build event clause and REFERENCING clause
  let eventClause, referencing;
  if (modification === 'create') {
    eventClause = 'AFTER INSERT';
    referencing = 'REFERENCING NEW ROW new';
  } else if (modification === 'update') {
    const ofColumns = [
      ...new Set(
        columns.flatMap((c) => {
          if (!c.target) return [quote(c.name)];
          if (c.foreignKeys) return c.foreignKeys.map((k) => quote(`${c.name}_${k.replaceAll(/\./g, '_')}`));
          if (c.on) return c.on.map((m) => quote(m.foreignKeyField));
          return [];
        })
      )
    ];
    const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';
    eventClause = `AFTER UPDATE ${ofClause}`;
    referencing = 'REFERENCING NEW ROW new, OLD ROW old';
  } else {
    eventClause = 'AFTER DELETE';
    referencing = 'REFERENCING OLD ROW old';
  }

  const upper = modification.toUpperCase();
  return {
    name: `${entity.name}_CT_${upper}`,
    sql: `TRIGGER ${utils.transformName(entity.name)}_CT_${upper} ${eventClause}
ON ${utils.transformName(entity.name)}
${referencing}
BEGIN
	${body}
END;`,
    suffix: '.hdbtrigger'
  };
}

/**
 * Generates HANA hdbtrigger artifacts for an entity (CREATE / UPDATE / DELETE).
 * Returns an empty array when the entity is neither tracked nor a tracked composition target.
 *
 * @param {object} csn - The CDS model (CSN)
 * @param {object} entity
 * @param {object|null} [parentEntity]
 * @param {object} [mergedAnnotations]
 * @param {object} [parentMergedAnnotations]
 * @param {object} [grandParentContext]
 * @returns {Array<{ name: string, sql: string, suffix: string }>}
 */
function generateHANATriggers(csn, entity, parentEntity = null, mergedAnnotations = null, parentMergedAnnotations = null, grandParentContext = {}) {
  const triggers = [];
  const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
  const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
  const parentObjectIDs = utils.getObjectIDs(parentEntity, csn, parentMergedAnnotations?.entityAnnotation);

  const keys = utils.extractKeys(entity.keys);
  if (keys.length === 0 && trackedColumns.length > 0) return triggers;

  // Resolve composition hierarchy (immediate parent + ancestors)
  const { ancestorChain } = grandParentContext;
  const compositionHierarchy = getCompositionHierarchy(entity, parentEntity, parentMergedAnnotations, ancestorChain ?? [], csn);

  // Skip if no tracked columns and not a composition target with tracked composition
  if (trackedColumns.length === 0 && !compositionHierarchy) return triggers;

  const modifications = [];
  if (!config?.disableCreateTracking) modifications.push('create');
  if (!config?.disableUpdateTracking) modifications.push('update');
  if (!config?.disableDeleteTracking) modifications.push('delete');

  for (const modification of modifications) {
    triggers.push(generateTrigger(entity, trackedColumns, objectIDs, parentObjectIDs, csn, modification, compositionHierarchy));
  }

  return triggers;
}

module.exports = { generateHANATriggers };
