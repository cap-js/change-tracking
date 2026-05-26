const utils = require('../utils/change-tracking.js');
const { toSQL, entityKeyExpr, quote } = require('./sql-expressions.js');

/**
 * Builds a SQLite scalar subquery that looks up a composition changelog entry's ID.
 * Used for parent_ID linking in nested composition hierarchies.
 *
 * @param {string} entityName - The CDS entity name of the composition owner
 * @param {string} keyExpr - SQL expression for the entityKey column (already quoted/concatenated)
 * @param {string} compositionFieldName - The composition element name (attribute)
 * @returns {string} A `(SELECT ID FROM sap_changelog_Changes ... LIMIT 1)` expression
 */
function buildChangelogLookupExpr(entityName, keyExpr, compositionFieldName) {
  return `(SELECT ID FROM sap_changelog_Changes
		WHERE entity = '${entityName}'
		AND entityKey = ${keyExpr}
		AND attribute = '${compositionFieldName}'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1)`;
}

/**
 * Builds an INSERT statement for a composition changelog entry.
 * @param {object} params
 * @param {string} params.parentIDExpr - SQL expression for parent_ID (NULL or subquery)
 * @param {string} params.compositionFieldName - The composition element name (attribute)
 * @param {string} params.entityName - The parent entity name
 * @param {string} params.keyExpr - SQL expression for the entity key
 * @param {string} params.objectIDExpr - SQL expression for objectID
 * @param {string} [params.existsClause] - Optional extra WHERE EXISTS clause (for composition-of-one)
 */
function buildCompositionChangelogInsert({ parentIDExpr, compositionFieldName, entityName, keyExpr, objectIDExpr, existsClause }) {
  const existsCondition = existsClause
    ? `WHERE ${existsClause}
		AND NOT EXISTS (`
    : `WHERE NOT EXISTS (`;

  return `INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			${parentIDExpr},
			'${compositionFieldName}',
			'${entityName}',
			${keyExpr},
			${objectIDExpr},
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		${existsCondition}
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = '${entityName}'
			AND entityKey = ${keyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);`;
}

/**
 * Builds rootObjectID select for composition of many.
 * @param {object} rootEntity - The entity to look up objectIDs from
 * @param {Array} rootObjectIDs - The @changelog objectID definitions
 * @param {Array} binding - FK column names on the child entity (e.g., ['parent_ID'])
 * @param {string} refRow - Trigger row reference (e.g., 'new' or 'old')
 * @param {object} model - The CDS model
 * @param {Array} [keyValueExprs] - Optional pre-built key value expressions (e.g., subquery strings).
 *   When provided, used instead of computing `${refRow}.${binding[i]}` for each key.
 *   Uses `literal: 'sql'` to prevent CQN from quoting subquery expressions as string literals.
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
  const keyValues = keyValueExprs ?? binding.map((k) => `${refRow}.${quote(k)}`);
  const rootEntityKeyExpr = entityKeyExpr(keyValues);

  if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

  // REVISIT
  const rootKeys = utils.extractKeys(rootEntity.keys);
  if (rootKeys.length !== keyValues.length) return rootEntityKeyExpr;

  const where = {};
  for (let i = 0; i < rootKeys.length; i++) {
    where[rootKeys[i]] = { val: keyValues[i], literal: 'sql' };
  }

  const parts = [];
  for (const oid of rootObjectIDs) {
    if (oid.expression) {
      const exprColumn = utils.buildExpressionColumn(oid.expression);
      const q = SELECT.one.from(rootEntity.name).columns(exprColumn).where(where);
      parts.push(toSQL(q, model));
    } else {
      const q = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
      parts.push(toSQL(q, model));
    }
  }

  // Single objectID field: simple COALESCE, no GROUP_CONCAT needed
  if (parts.length === 1) {
    return `COALESCE((${parts[0]}), ${rootEntityKeyExpr})`;
  }

  // Multiple objectID fields: use GROUP_CONCAT, fall back to entityKey when ALL are NULL
  const unions = parts.map((part) => `SELECT (${part}) AS value`).join('\nUNION ALL\n');
  const concatExpr = `(SELECT GROUP_CONCAT(value, ', ') FROM (${unions}))`;

  const nullChecks = parts.map((p) => `(${p}) IS NULL`).join(' AND ');
  return `(CASE WHEN ${nullChecks} THEN ${rootEntityKeyExpr} ELSE ${concatExpr} END)`;
}

/**
 * Builds the SQL context for a composition-of-one parent changelog entry.
 * For composition-of-one, the parent has the FK to the child, so a reverse lookup
 * is used to derive the parent's key.
 *
 * @param {{ parentEntityName: string, compositionFieldName: string, parentKeyBinding: object }} compositionParentInfo
 * @param {Array} parentObjectIDs - @changelog objectIDs of the parent entity
 * @param {string} rowRef - Trigger row reference ('new' or 'old')
 * @param {object} model - The CDS model (CSN)
 * @param {string|null} [childObjectIDExpr] - Optional SQL expression for the child's objectID
 * @returns {{ insertSQL: string, parentEntityName: string, compositionFieldName: string, parentKeyExpr: string, parentLookupExpr: string }}
 */
function buildCompositionOfOneParentContext(compositionParentInfo, parentObjectIDs, rowRef, model, childObjectIDExpr = null) {
  const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
  const { compositionName, childKeys } = parentKeyBinding;
  const parentFKFields = childKeys.map((k) => quote(`${compositionName}_${k}`));
  const parentEntity = model.definitions[parentEntityName];
  const parentKeys = utils.extractKeys(parentEntity.keys);

  const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = ${rowRef}.${quote(childKeys[i])}`).join(' AND ');
  // Build the parent key expression via subquery (reverse lookup)
  const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${quote(pk)} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
  const parentKeyExpr = entityKeyExpr(parentKeySubqueries);
  // Use child's objectID expression for the composition entry
  // Falls back to parent's own objectID if child objectID is not available
  const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, parentObjectIDs, null, null, model, parentKeySubqueries);

  const insertSQL = buildCompositionChangelogInsert({
    parentIDExpr: 'NULL',
    compositionFieldName,
    entityName: parentEntityName,
    keyExpr: parentKeyExpr,
    objectIDExpr,
    existsClause: `EXISTS (
			SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
		)`
  });

  const parentLookupExpr = buildChangelogLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName);

  return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

/**
 * Resolves key expressions for each level in a composition hierarchy by building
 * chained subqueries that navigate from the trigger row up through the ancestors.
 *
 * @param {Array} levels - Array of { entityName, compositionFieldName, keyBinding } from immediate parent to outermost ancestor
 * @param {string} rowRef - Trigger row reference ('new' or 'old')
 * @param {object} model - The CDS model
 * @returns {{ keyExprs: string[], ancestorKeyValues: string[][] }}
 */
function resolveAncestorKeyExpressions(levels, rowRef, model) {
  const parentKeyBinding = levels[0].keyBinding;
  const keyExprs = [entityKeyExpr(parentKeyBinding.map((k) => `${rowRef}.${quote(k)}`))];
  const ancestorKeyValues = [parentKeyBinding.map((k) => `${rowRef}.${quote(k)}`)];

  if (levels.length > 1) {
    const childEntity0 = model.definitions[levels[0].entityName];
    const childKeys0 = utils.extractKeys(childEntity0.keys);
    const childWhereClauses = [childKeys0.map((pk, j) => `${quote(pk)} = ${rowRef}.${quote(parentKeyBinding[j])}`).join(' AND ')];

    for (let i = 1; i < levels.length; i++) {
      const childLevel = levels[i - 1];
      const ancestorLevel = levels[i];
      const prevWhere = childWhereClauses[i - 1];

      const whereForAncestor = ancestorLevel.keyBinding.map((fk) => `(SELECT ${quote(fk)} FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`);

      const ancestorEntity = model.definitions[ancestorLevel.entityName];
      const ancestorKeys = utils.extractKeys(ancestorEntity.keys);
      const thisWhere = ancestorKeys.map((pk, j) => `${quote(pk)} = ${whereForAncestor[j]}`).join(' AND ');
      childWhereClauses.push(thisWhere);

      ancestorKeyValues.push(whereForAncestor);
      keyExprs.push(entityKeyExpr(whereForAncestor));
    }
  }

  return { keyExprs, ancestorKeyValues };
}

/**
 * Builds the composition parent INSERT SQL for a SQLite trigger.
 * Walks the composition hierarchy from outermost ancestor down to the immediate parent
 * and emits one idempotent INSERT per level (keyed on (entity, entityKey, attribute, transactionID)).
 *
 * @param {{ levels: Array, compositionFieldChangelog: Array|null }} compositionHierarchy
 *   - `levels[0]` = immediate parent, `levels[N]` = ancestors (innermost → outermost)
 * @param {Array} parentObjectIDs - @changelog objectIDs of the immediate parent entity
 * @param {string} rowRef - Trigger row reference ('new' or 'old')
 * @param {object} model - The CDS model (CSN)
 * @param {string|null} [childObjectID] - SQL expression for the trigger entity's own objectID;
 *   used as a fallback when the parent has no objectID (composition-of-one)
 * @param {Function|null} [buildFieldObjectIDFn] - Callback `(changelog, parentEntity, parentKeyBinding) => sqlExpr`
 *   that resolves the objectID from a field-level @changelog annotation
 * @returns {{ insertSQL: string, parentEntityName: string, compositionFieldName: string, parentKeyExpr: string, parentLookupExpr: string }}
 */
function buildCompositionParentContext(compositionHierarchy, parentObjectIDs, rowRef, model, childObjectID = null, buildFieldObjectIDFn = null) {
  const { levels, compositionFieldChangelog } = compositionHierarchy;
  const { entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding } = levels[0];

  // Handle composition of one (parent has FK to child - need reverse lookup)
  if (parentKeyBinding.type === 'compositionOfOne') {
    return buildCompositionOfOneParentContext({ parentEntityName, compositionFieldName, parentKeyBinding }, parentObjectIDs, rowRef, model, childObjectID);
  }

  // Composition of many: resolve the objectID for the composition field
  let compositionFieldObjectIDExpr = null;
  if (buildFieldObjectIDFn) {
    const parentEntity = model.definitions[parentEntityName];
    compositionFieldObjectIDExpr = buildFieldObjectIDFn(compositionFieldChangelog, parentEntity, parentKeyBinding);
  }

  // Resolve key expressions for the composition hierarchy
  const { keyExprs, ancestorKeyValues } = resolveAncestorKeyExpressions(levels, rowRef, model);
  const parentKeyExpr = keyExprs[0];

  // Resolve objectID for the composition entry:
  // 1. compositionFieldObjectIDExpr: @changelog on the composition field (parent elements only, for composition-of-many)
  // 2. buildCompOfManyRootObjectIDSelect: parent entity-level @changelog / entity keys (fallback)
  const rootEntity = model.definitions[parentEntityName];
  const immediateParentObjectIDExpr = compositionFieldObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, parentObjectIDs, parentKeyBinding, rowRef, model);

  // Generate INSERT statements from outermost ancestor down to the immediate parent
  const insertStatements = [];

  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i];
    const levelKeyExpr = keyExprs[i];
    const isOutermost = i === levels.length - 1;
    const isImmediateParent = i === 0;

    // parent_ID: NULL for outermost, lookup for inner levels
    let parentIDExpr;
    if (isOutermost) {
      parentIDExpr = 'NULL';
    } else {
      const parentLevel = levels[i + 1];
      const parentLevelKeyExpr = keyExprs[i + 1];
      parentIDExpr = buildChangelogLookupExpr(parentLevel.entityName, parentLevelKeyExpr, parentLevel.compositionFieldName);
    }

    // objectID: immediate parent uses the composition field objectID, ancestors use child entity's objectID
    let objectIDExpr;
    if (isImmediateParent) {
      objectIDExpr = immediateParentObjectIDExpr;
    } else {
      const childEntityDef = model.definitions[level.childEntityName];
      if (childEntityDef && level.childObjectIDs && level.childObjectIDs.length > 0) {
        const childKeyValues = ancestorKeyValues[i - 1];
        objectIDExpr = buildCompOfManyRootObjectIDSelect(childEntityDef, level.childObjectIDs, null, null, model, childKeyValues);
      } else {
        objectIDExpr = keyExprs[i - 1];
      }
    }

    insertStatements.push(
      buildCompositionChangelogInsert({
        parentIDExpr,
        compositionFieldName: level.compositionFieldName,
        entityName: level.entityName,
        keyExpr: levelKeyExpr,
        objectIDExpr
      })
    );
  }

  const insertSQL = insertStatements.join('\n        ');

  // SELECT SQL to get the parent_ID for child entries
  const parentLookupExpr = buildChangelogLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName);

  return { insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentLookupExpr };
}

module.exports = {
  buildCompositionParentContext
};
