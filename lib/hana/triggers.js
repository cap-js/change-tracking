const cds = require('@sap/cds');
const utils = require('../utils/change-tracking.js');
const config = cds.env.requires['change-tracking'];
const { getCompositionHierarchy, parseCompositionFieldChangelog } = require('../utils/composition-helpers.js');
const { getSkipCheckCondition, getElementSkipCondition, getValueExpr, getWhereCondition, getLabelExpr, buildObjectIDExpr, buildTriggerContext, quote, toSQL } = require('./sql-expressions.js');
const { buildCompositionParentContext } = require('./composition.js');

// HANA transition-table aliases used inside the trigger body.
// 'nr' / 'o' are non-reserved HANA identifiers and bind to :new_rows / :old_rows.
const NEW = 'nr';
const OLD = 'o';

/**
 * Builds an objectID SQL expression from a parsed composition-field @changelog annotation.
 * Returns `null` when the annotation cannot be parsed.
 */
function buildCompositionFieldObjectID(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, model) {
  const parsed = parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, quote);
  if (!parsed) return null;

  if (parsed.type === 'expression') {
    const query = SELECT.one.from(parentEntity.name).columns(parsed.exprColumn).where(parsed.where);
    return `TO_NVARCHAR((${toSQL(query, model)}))`;
  }

  const { buildCompOfManyRootObjectIDSelect } = require('./composition.js');
  return buildCompOfManyRootObjectIDSelect(parentEntity, parsed.objectIDs, parentKeyBinding, refRow, model);
}

/**
 * Statement-level INSERT body — emits one `INSERT … SELECT` per tracked column,
 * reading directly from the transition tables (`:new_rows nr` / `:old_rows o`).
 *
 * For UPDATE, NEW and OLD must be joined on the primary key because transition
 * tables are unordered sets; pre/post pairs for the same logical row must be
 * matched explicitly.
 */
function buildStmtInsertSQL(entity, columns, modification, ctx, model) {
  const keys = utils.extractKeys(entity.keys);

  let fromClause;
  let refs;
  if (modification === 'create') {
    fromClause = `FROM :new_rows ${NEW}`;
    refs = { newRef: NEW, oldRef: NEW };
  } else if (modification === 'delete') {
    fromClause = `FROM :old_rows ${OLD}`;
    refs = { newRef: OLD, oldRef: OLD };
  } else {
    // UPDATE: join on PK
    const joinCond = keys.map((k) => `${NEW}.${quote(k)} = ${OLD}.${quote(k)}`).join(' AND ');
    fromClause = `FROM :new_rows ${NEW} JOIN :old_rows ${OLD} ON ${joinCond}`;
    refs = { newRef: NEW, oldRef: OLD };
  }

  const inserts = columns.map((col) => {
    const whereCondition = getWhereCondition(col, modification, refs);
    const elementSkipCondition = getElementSkipCondition(entity.name, col.name);
    let fullWhere = `(${whereCondition}) AND ${elementSkipCondition}`;

    // For composition-of-one columns, dedupe against any composition entry the child's
    // delete/create trigger may have already inserted for this transaction. Without this,
    // a deep delete (UPDATE parent SET comp=null) yields both:
    //   (a) parent's own UPDATE-trigger composition entry, and
    //   (b) the child DELETE-trigger's composition parent entry,
    // because the BookStores row still has the FK at the moment the child's DELETE fires.
    if (col.type === 'cds.Composition') {
      fullWhere += ` AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${entity.name}'
			AND entityKey = ${ctx.entityKey}
			AND attribute = '${col.name}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		)`;
    }

    const oldVal = modification === 'create' ? 'NULL' : getValueExpr(col, refs.oldRef);
    const newVal = modification === 'delete' ? 'NULL' : getValueExpr(col, refs.newRef);
    const oldLabel = modification === 'create' ? 'NULL' : getLabelExpr(col, refs.oldRef, model, entity);
    const newLabel = modification === 'delete' ? 'NULL' : getLabelExpr(col, refs.newRef, model, entity);

    const dataType = col.altExpression ? 'cds.String' : col.type;
    const parentIdExpr = ctx.parentIdLookupExpr ?? 'NULL';

    return `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			${parentIdExpr},
			'${col.name}',
			${oldVal},
			${newVal},
			${oldLabel},
			${newLabel},
			'${entity.name}',
			${ctx.entityKey},
			${ctx.objectID},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'${dataType}',
			'${modification}',
			CURRENT_UPDATE_TRANSACTION()
		${fromClause}
		WHERE ${fullWhere};`;
  });

  return inserts.join('\n\t');
}

/**
 * Generates a single HANA trigger (CREATE / UPDATE / DELETE) for an entity.
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
  // Use OLD on delete (only :old_rows is populated); NEW otherwise.
  const refRow = modification === 'delete' ? OLD : NEW;

  const ctx = buildTriggerContext(entity, objectIDs, refRow, model);

  // Build composition parent context (set-based parent INSERTs + parent_ID lookup expression).
  const compositionParentContext = compositionHierarchy
    ? buildCompositionParentContext(compositionHierarchy, parentObjectIDs, refRow, model, buildObjectIDExpr(objectIDs, entity, refRow, model), (changelog, parentEntity, keyBinding) =>
        buildCompositionFieldObjectID(changelog, parentEntity, keyBinding, refRow, model)
      )
    : null;

  if (compositionParentContext) {
    ctx.parentIdLookupExpr = compositionParentContext.parentIdLookupExpr;
  }

  // Set-based delete cleanup for non-preserve delete.
  const deleteSQL = modification === 'delete' && !config?.preserveDeletes ? `DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = '${entity.name}' AND entityKey IN (SELECT ${ctx.entityKey} FROM :old_rows ${OLD});` : '';

  const insertSQL = columns.length > 0 ? buildStmtInsertSQL(entity, columns, modification, ctx, model) : '';
  const parentInsertsSQL = compositionParentContext?.parentInsertsSQL ?? '';

  // Body order: optional delete cleanup, parent (composition) inserts, child column inserts.
  const innerSQL = [deleteSQL, parentInsertsSQL, insertSQL].filter(Boolean).join('\n\t\t');

  const body = `IF ${getSkipCheckCondition(entity.name)} THEN
		${innerSQL}
	END IF;`;

  // Build event clause and REFERENCING clause.
  // NOTE: HANA requires a comma between transition-table specifications.
  let eventClause;
  let referencing;
  if (modification === 'create') {
    eventClause = 'AFTER INSERT';
    referencing = 'REFERENCING NEW TABLE new_rows';
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
    referencing = 'REFERENCING NEW TABLE new_rows, OLD TABLE old_rows';
  } else {
    eventClause = 'AFTER DELETE';
    referencing = 'REFERENCING OLD TABLE old_rows';
  }
  referencing = `${referencing}\nFOR EACH STATEMENT`;

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
