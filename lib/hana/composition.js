const utils = require('../utils/change-tracking.js');
const { toSQL, entityKeyExpr, quote, colRef } = require('./sql-expressions.js');

/**
 * Builds an SQL expression for the parent objectID of a composition entry.
 * Resolves @changelog objectIDs from the parent table or falls back to the entityKey string
 * when no objectID is configured. With multiple objectIDs concatenates with ", ".
 *
 * @param {object} rootEntity - CSN definition of root entity
 * @param {Array} rootObjectIDs - @changelog objectID definitions
 * @param {Array} binding - FK column names on the child pointing to the parent
 * @param {string} refRow - Transition-table alias (e.g. 'nr' or 'o')
 * @param {object} model - CSN model
 * @param {Array} [keyValueExprs] - Pre-built key value expressions; bypass colRef(refRow, binding[i])
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
  const keyValues = keyValueExprs ?? binding.map((k) => colRef(refRow, k));
  const rootEntityKeyExpr = entityKeyExpr(keyValues);

  if (!rootObjectIDs || rootObjectIDs.length === 0) return rootEntityKeyExpr;

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
      const query = SELECT.one.from(rootEntity.name).columns(exprColumn).where(where);
      parts.push(`TO_NVARCHAR((${toSQL(query, model)}))`);
    } else {
      const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
      parts.push(`TO_NVARCHAR((${toSQL(query, model)}))`);
    }
  }

  // Single objectID field: simple COALESCE, no concat needed
  if (parts.length === 1) {
    return `COALESCE(${parts[0]}, ${rootEntityKeyExpr})`;
  }

  // Multiple objectID fields: use concat, fall back to entityKey when ALL are NULL
  const nullChecks = parts.map((p) => `${p} IS NULL`).join(' AND ');
  const concatExpr = parts.map((p) => `CASE WHEN ${p} IS NOT NULL THEN ', ' || ${p} ELSE '' END`).join(' || ');
  return `CASE WHEN ${nullChecks} THEN ${rootEntityKeyExpr} ELSE COALESCE(NULLIF(LTRIM(${concatExpr}, ', '), ''), ${rootEntityKeyExpr}) END`;
}

/**
 * Builds a correlated lookup expression that resolves the parent changelog entry's ID
 * for a row of the transition table, keyed by (entity, entityKey, attribute, txn).
 *
 * Used as the `parent_ID` value when inserting child changelog entries (or inner-ancestor
 * composition entries) at statement level. The row inserted earlier in this trigger body
 * (and matched by the same transactionID) is found by content.
 */
function buildParentIdLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName) {
  return `(SELECT MAX(ID) FROM SAP_CHANGELOG_CHANGES WHERE entity = '${parentEntityName}' AND entityKey = ${parentKeyExpr} AND attribute = '${compositionFieldName}' AND valueDataType = 'cds.Composition' AND transactionID = CURRENT_UPDATE_TRANSACTION())`;
}

/**
 * Composition-of-one parent context (statement-level).
 *
 * For composition-of-one, the parent entity has the FK to the child. Reverse-lookup from
 * the parent table finds the parent key for each child row in the transition table.
 *
 * @returns {{ parentEntityName: string, compositionFieldName: string, parentInsertSQL: string, parentIdLookupExpr: string, parentEntityKeyExpr: string }}
 */
function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, refRow, model, childObjectIDExpr = null) {
  const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
  const { compositionName, childKeys } = parentKeyBinding;

  const parentFKFields = childKeys.map((k) => quote(`${compositionName}_${k}`));
  const parentEntity = model.definitions[parentEntityName];
  const parentKeys = utils.extractKeys(parentEntity.keys);

  // Reverse-lookup WHERE: parent.<fk> = nr.<childKey> — references outer transition row.
  const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = ${colRef(refRow, childKeys[i])}`).join(' AND ');

  // Subquery yielding the parent's PK columns. There is at most one parent per child row
  // (composition-of-one), so MAX() is safe and avoids the correlated TOP/LIMIT restriction.
  const parentKeySubqueries = parentKeys.map((pk) => `(SELECT MAX(${quote(pk)}) FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
  const parentEntityKeyExpr = entityKeyExpr(parentKeySubqueries);

  // objectID for the parent composition entry: child's own objectID if provided, else parent objectID.
  const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

  // Parent INSERT (set-based, deduped against existing entries in this transaction).
  // The FROM source is the full transition table because the objectID expression may
  // reference any column on the child (not just the FK keys). The NOT EXISTS dedup
  // still prevents duplicate parent entries for the same parent key.
  const parentInsertSQL = `INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			NULL,
			'${compositionFieldName}',
			'${parentEntityName}',
			${parentEntityKeyExpr},
			${objectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'update',
			CURRENT_UPDATE_TRANSACTION()
		FROM :${refRow === 'o' ? 'old_rows' : 'new_rows'} ${refRow}
		WHERE EXISTS (SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})
		AND NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentEntityKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		);`;

  const parentIdLookupExpr = buildParentIdLookupExpr(parentEntityName, parentEntityKeyExpr, compositionFieldName);

  return { parentEntityName, compositionFieldName, parentInsertSQL, parentIdLookupExpr, parentEntityKeyExpr };
}

/**
 * Resolves key expressions for each level in a composition hierarchy by building
 * chained subqueries that navigate from the trigger row up through the ancestors.
 *
 * @param {Array} levels - Array of { entityName, compositionFieldName, keyBinding } from immediate parent to outermost ancestor
 * @param {string} refRow - Transition-table alias
 * @param {object} model - The CDS model
 * @returns {{ keyExprs: string[], ancestorKeyValues: string[][] }}
 */
function resolveAncestorKeyExpressions(levels, refRow, model) {
  const parentKeyBinding = levels[0].keyBinding;
  const keyExprs = [entityKeyExpr(parentKeyBinding.map((k) => colRef(refRow, k)))];
  const ancestorKeyValues = [parentKeyBinding.map((k) => colRef(refRow, k))];

  if (levels.length > 1) {
    const childEntity0 = model.definitions[levels[0].entityName];
    const childKeys0 = utils.extractKeys(childEntity0.keys);
    const childWhereClauses = [childKeys0.map((pk, j) => `${quote(pk)} = ${colRef(refRow, parentKeyBinding[j])}`).join(' AND ')];

    for (let i = 1; i < levels.length; i++) {
      const childLevel = levels[i - 1];
      const ancestorLevel = levels[i];
      const prevWhere = childWhereClauses[i - 1];

      // Wrap subqueries with MAX() to avoid HANA's correlated-subquery TOP/ORDER BY restriction.
      // Composition FKs have at-most-one parent so MAX is safe.
      const whereForAncestor = ancestorLevel.keyBinding.map((fk) => `(SELECT MAX(${quote(fk)}) FROM ${utils.transformName(childLevel.entityName)} WHERE ${prevWhere})`);

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
 * Builds the set of statement-level INSERT … SELECT statements that materialize the
 * composition parent entries (ancestor levels + immediate parent). These are emitted
 * outermost-first so each inner level's `parent_ID` lookup finds the outer entry.
 *
 * @param {{ levels: Array, compositionFieldChangelog: Array|null }} compositionHierarchy
 * @param {Array} parentObjectIDs - @changelog objectIDs of the immediate parent
 * @param {string} refRow - Transition-table alias ('nr' or 'o')
 * @param {object} model
 * @param {string|null} childObjectIDExpr - Optional SQL expression for the trigger entity's objectID
 * @param {Function|null} buildFieldObjectIDFn - Field-level @changelog objectID resolver
 * @returns {{ parentInsertsSQL: string, immediateParentEntityName: string, immediateParentCompositionFieldName: string, immediateParentEntityKeyExpr: string, parentIdLookupExpr: string }}
 */
function buildCompositionParentContext(compositionHierarchy, parentObjectIDs, refRow, model, childObjectIDExpr = null, buildFieldObjectIDFn = null) {
  const { levels, compositionFieldChangelog } = compositionHierarchy;
  const { entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding } = levels[0];

  // Composition-of-one is a special case: parent has FK to child (reverse lookup).
  if (parentKeyBinding.type === 'compositionOfOne') {
    const ctx = buildCompositionOfOneParentContext({ parentEntityName, compositionFieldName, parentKeyBinding }, parentObjectIDs, refRow, model, childObjectIDExpr);
    return {
      parentInsertsSQL: ctx.parentInsertSQL,
      immediateParentEntityName: ctx.parentEntityName,
      immediateParentCompositionFieldName: ctx.compositionFieldName,
      immediateParentEntityKeyExpr: ctx.parentEntityKeyExpr,
      parentIdLookupExpr: ctx.parentIdLookupExpr
    };
  }

  // Composition-of-many: child has FK to parent.
  const parentKeyExpr = entityKeyExpr(parentKeyBinding.map((k) => colRef(refRow, k)));

  // Resolve objectID for the immediate parent composition entry.
  let compositionFieldObjectIDExpr = null;
  if (buildFieldObjectIDFn) {
    const parentEntity = model.definitions[parentEntityName];
    compositionFieldObjectIDExpr = buildFieldObjectIDFn(compositionFieldChangelog, parentEntity, parentKeyBinding);
  }
  const rootEntity = model.definitions[parentEntityName];
  const immediateParentObjectIDExpr = compositionFieldObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, parentObjectIDs, parentKeyBinding, refRow, model);

  // Distinct parent key set per transition row, used as the FROM source for parent inserts.
  const distinctParentKeysSrc = `(SELECT DISTINCT ${parentKeyBinding.map((k) => `${refRow}.${quote(k)}`).join(', ')} FROM :${refRow === 'o' ? 'old_rows' : 'new_rows'} ${refRow} WHERE ${parentKeyBinding.map((k) => `${refRow}.${quote(k)} IS NOT NULL`).join(' AND ')}) ${refRow}`;

  const inserts = [];

  if (levels.length > 1) {
    // Resolve key expressions for each level (immediate parent through outermost ancestor).
    const { keyExprs, ancestorKeyValues } = resolveAncestorKeyExpressions(levels, refRow, model);

    // Emit INSERTs from outermost ancestor inward. Each inner level's parent_ID is a
    // correlated lookup against the row inserted in the preceding step.
    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i];
      const isOutermost = i === levels.length - 1;
      const isImmediate = i === 0;

      const levelKeyExpr = keyExprs[i];

      // parent_ID for this level
      let parentIDValue = 'NULL';
      if (!isOutermost) {
        const outerLevel = levels[i + 1];
        parentIDValue = buildParentIdLookupExpr(outerLevel.entityName, keyExprs[i + 1], outerLevel.compositionFieldName);
      }

      // objectID for this level's composition entry: child entity's objectID if known.
      let objectIDExpr;
      if (isImmediate) {
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

      inserts.push(`INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			${parentIDValue},
			'${level.compositionFieldName}',
			'${level.entityName}',
			${levelKeyExpr},
			${objectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'update',
			CURRENT_UPDATE_TRANSACTION()
		FROM ${distinctParentKeysSrc}
		WHERE NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${level.entityName}'
			AND entityKey = ${levelKeyExpr}
			AND attribute = '${level.compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		);`);
    }
  } else {
    // Simple single-level composition.
    inserts.push(`INSERT INTO SAP_CHANGELOG_CHANGES
		(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			SYSUUID,
			NULL,
			'${compositionFieldName}',
			'${parentEntityName}',
			${parentKeyExpr},
			${immediateParentObjectIDExpr},
			CURRENT_TIMESTAMP,
			SESSION_CONTEXT('APPLICATIONUSER'),
			'cds.Composition',
			'update',
			CURRENT_UPDATE_TRANSACTION()
		FROM ${distinctParentKeysSrc}
		WHERE NOT EXISTS (
			SELECT 1 FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION()
		);`);
  }

  const parentIdLookupExpr = buildParentIdLookupExpr(parentEntityName, parentKeyExpr, compositionFieldName);

  return {
    parentInsertsSQL: inserts.join('\n\t\t'),
    immediateParentEntityName: parentEntityName,
    immediateParentCompositionFieldName: compositionFieldName,
    immediateParentEntityKeyExpr: parentKeyExpr,
    parentIdLookupExpr
  };
}

module.exports = {
  buildCompOfManyRootObjectIDSelect,
  buildCompositionParentContext,
  buildParentIdLookupExpr
};
