/**
 * Generates simplified HANA .hdbtrigger artifacts for .drafts shadow tables.
 *
 * These triggers record which entity types within a draft were touched, writing
 * into sap_changelog_DraftChanges without any column-level comparison.  False
 * positives (a field changed and changed back) are intentionally accepted.
 */
const utils = require('../utils/change-tracking.js');

const DRAFT_CHANGES_TABLE = 'SAP_CHANGELOG_DRAFTCHANGES';

// HANA uses DraftAdministrativeData_DraftUUID as the FK column in .drafts tables.
// quote() is not needed here — this is already the flat DB column name.
const DRAFT_UUID_COL = '"DraftAdministrativeData_DraftUUID"';

/**
 * Generates one HANA .hdbtrigger artifact for a given event on a .drafts table.
 *
 * @param {string} draftsEntityName  - model name of the .drafts entity
 * @param {string} activeEntityName  - DB entity name recorded in DraftChanges.entityName
 * @param {'update'|'insert'|'delete'} modification
 * @returns {{ name: string, sql: string, suffix: string }}
 */
function _generateHanaDraftTrigger(draftsEntityName, activeEntityName, modification) {
  const tableName = utils.transformName(draftsEntityName);
  const upper = modification.toUpperCase();
  const triggerName = `${tableName}_DCT_${upper}`;
  const changeType = modification;

  let eventClause;
  let referencing;
  let draftUUIDExpr;

  if (modification === 'insert') {
    eventClause = 'AFTER INSERT';
    referencing = 'REFERENCING NEW TABLE new_rows\nFOR EACH STATEMENT';
    draftUUIDExpr = `nr.${DRAFT_UUID_COL}`;
  } else if (modification === 'update') {
    eventClause = 'AFTER UPDATE';
    referencing = 'REFERENCING NEW TABLE new_rows\nFOR EACH STATEMENT';
    draftUUIDExpr = `nr.${DRAFT_UUID_COL}`;
  } else {
    eventClause = 'AFTER DELETE';
    referencing = 'REFERENCING OLD TABLE old_rows\nFOR EACH STATEMENT';
    draftUUIDExpr = `o.${DRAFT_UUID_COL}`;
  }

  const fromAlias = modification === 'delete' ? 'o' : 'nr';
  const fromTable = modification === 'delete' ? ':old_rows o' : ':new_rows nr';

  const body = `UPSERT ${DRAFT_CHANGES_TABLE}("DRAFTUUID", "ENTITYNAME", "CHANGETYPE")
    SELECT ${draftUUIDExpr}, '${activeEntityName}', '${changeType}'
    FROM ${fromTable}
    WHERE ${draftUUIDExpr} IS NOT NULL;`;

  const sql = `TRIGGER ${triggerName} ${eventClause}
ON ${tableName}
${referencing}
BEGIN
  ${body}
END;`;

  return { name: triggerName, sql, suffix: '.hdbtrigger' };
}

/**
 * Entry point called from hana/register.js for each draft entity descriptor.
 * Returns an array of .hdbtrigger artifacts (one per relevant event).
 *
 * @param {{ draftsEntityName: string, activeEntityName: string, isRoot: boolean }}
 * @returns {Array<{ name: string, sql: string, suffix: string }>}
 */
function generateHanaDraftTriggers({ draftsEntityName, activeEntityName, isRoot }) {
  const triggers = [];
  triggers.push(_generateHanaDraftTrigger(draftsEntityName, activeEntityName, 'update'));
  if (!isRoot) {
    triggers.push(_generateHanaDraftTrigger(draftsEntityName, activeEntityName, 'insert'));
    triggers.push(_generateHanaDraftTrigger(draftsEntityName, activeEntityName, 'delete'));
  }
  return triggers;
}

module.exports = { generateHanaDraftTriggers };
