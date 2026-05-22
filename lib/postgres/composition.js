const utils = require('../utils/change-tracking.js');
const { toSQL, entityKeyExpr, quote } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
  const keyValues = keyValueExprs ?? binding.map((k) => `${refRow}.${quote(k)}`);
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
      // Leave NULL as-is so CONCAT_WS skips unresolved expressions
      parts.push(`(${toSQL(query, model)})::TEXT`);
    } else {
      const query = SELECT.one.from(rootEntity.name).columns(oid.name).where(where);
      // Leave NULL as-is so CONCAT_WS skips unresolved association paths
      parts.push(`(${toSQL(query, model)})::TEXT`);
    }
  }

  // Single objectID field: simple COALESCE, no CONCAT_WS needed
  if (parts.length === 1) {
    return `COALESCE(${parts[0]}, ${rootEntityKeyExpr})`;
  }

  // Multiple objectID fields: use CONCAT_WS, fall back to entityKey when all are NULL
  const concatLogic = `CONCAT_WS(', ', ${parts.join(', ')})`;

  return `COALESCE(NULLIF(${concatLogic}, ''), ${rootEntityKeyExpr})`;
}

function buildCompositionOfOneParentBlock(compositionParentInfo, parentObjectIDs, model, childObjectIDExpr = null) {
  const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
  const { compositionName, childKeys } = parentKeyBinding;

  const parentFKFields = childKeys.map((k) => quote(`${compositionName}_${k}`));
  const parentEntity = model.definitions[parentEntityName];
  const parentKeys = utils.extractKeys(parentEntity.keys);
  const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = rec.${quote(childKeys[i])}`).join(' AND ');

  // Build the parent key expression via subquery (reverse lookup)
  const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${quote(pk)} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
  const parentKeyExpr = entityKeyExpr(parentKeySubqueries);

  // Use child's objectID expression for the composition entry — shows which child was affected
  // Falls back to parent's own objectID if child objectID is not available
  const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, parentObjectIDs, null, null, model, parentKeySubqueries);

  return `IF EXISTS (SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}) THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                    AND entitykey = ${parentKeyExpr}
                    AND attribute = '${compositionFieldName}'
                    AND valuedatatype = 'cds.Composition'
                    AND transactionid = transaction_id;
                IF comp_parent_id IS NULL THEN
                    comp_parent_id := gen_random_uuid();
                    INSERT INTO sap_changelog_changes
                        (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                        VALUES (
                            comp_parent_id,
                            NULL,
                            '${compositionFieldName}',
                            '${parentEntityName}',
                            ${parentKeyExpr},
                            ${objectIDExpr},
                            now(),
                            user_id,
                            'cds.Composition',
                            'update',
                            transaction_id
                        );
                END IF;
            END IF;`;
}

/**
 * Resolves key expressions for each level in a composition hierarchy by building
 * chained subqueries that navigate from the trigger row up through the ancestors.
 *
 * @param {Array} levels - Array of { entityName, compositionFieldName, keyBinding } from immediate parent to outermost ancestor
 * @param {object} model - The CDS model
 * @returns {{ keyExprs: string[], ancestorKeyValues: string[][] }}
 */
function resolveAncestorKeyExpressions(levels, model) {
  const parentKeyBinding = levels[0].keyBinding;
  const keyExprs = [entityKeyExpr(parentKeyBinding.map((k) => `rec.${quote(k)}`))];
  const ancestorKeyValues = [parentKeyBinding.map((k) => `rec.${quote(k)}`)];

  if (levels.length > 1) {
    const childEntity0 = model.definitions[levels[0].entityName];
    const childKeys0 = utils.extractKeys(childEntity0.keys);
    const childWhereClauses = [childKeys0.map((pk, j) => `${quote(pk)} = rec.${quote(parentKeyBinding[j])}`).join(' AND ')];

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

function buildCompositionParentBlock(compositionHierarchy, parentObjectIDs, model, childObjectIDExpr = null, buildFieldObjectIDFn = null) {
  const { levels, compositionFieldChangelog } = compositionHierarchy;
  const { entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding } = levels[0];

  // Handle composition of one (parent has FK to child - need reverse lookup)
  if (parentKeyBinding.type === 'compositionOfOne') {
    return buildCompositionOfOneParentBlock({ parentEntityName, compositionFieldName, parentKeyBinding }, parentObjectIDs, model, childObjectIDExpr);
  }

  // Composition of many: resolve the objectID for the composition field
  let compositionFieldObjectIDExpr = null;
  if (buildFieldObjectIDFn) {
    const parentEntity = model.definitions[parentEntityName];
    compositionFieldObjectIDExpr = buildFieldObjectIDFn(compositionFieldChangelog, parentEntity, parentKeyBinding);
  }

  // Resolve key expressions for the composition hierarchy
  const { keyExprs, ancestorKeyValues } = resolveAncestorKeyExpressions(levels, model);
  const parentKeyExpr = keyExprs[0];

  // Resolve objectID for the composition entry:
  // 1. compositionFieldObjectIDExpr: @changelog on the composition field (parent elements only, for composition-of-many)
  // 2. buildCompOfManyRootObjectIDSelect: parent entity-level @changelog / entity keys (fallback)
  const rootEntity = model.definitions[parentEntityName];
  const immediateParentObjectIDExpr = compositionFieldObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, parentObjectIDs, parentKeyBinding, 'rec', model);

  if (levels.length > 1) {
    // Multi-level ancestor chain: generate PL/pgSQL blocks from outermost ancestor down to immediate parent
    const blocks = [];

    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i];
      const levelKeyExpr = keyExprs[i];
      const isOutermost = i === levels.length - 1;
      const isImmediateParent = i === 0;

      // Variable name for this level's changelog entry ID
      const varName = isImmediateParent ? 'comp_parent_id' : `comp_ancestor_${i - 1}_id`;

      // parent_id: NULL for outermost, variable from the level above for inner levels
      let parentVarExpr;
      if (isOutermost) {
        parentVarExpr = 'NULL';
      } else {
        const parentLevelIndex = i + 1;
        parentVarExpr = `comp_ancestor_${parentLevelIndex - 1}_id`;
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

      blocks.push(`SELECT id INTO ${varName} FROM sap_changelog_changes WHERE entity = '${level.entityName}'
                AND entitykey = ${levelKeyExpr}
                AND attribute = '${level.compositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF ${varName} IS NULL THEN
                ${varName} := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        ${varName},
                        ${parentVarExpr},
                        '${level.compositionFieldName}',
                        '${level.entityName}',
                        ${levelKeyExpr},
                        ${objectIDExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;`);
    }
    return blocks.join('\n            ');
  }

  // No ancestors — single parent level
  return `SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = '${parentEntityName}'
                AND entitykey = ${parentKeyExpr}
                AND attribute = '${compositionFieldName}'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        '${compositionFieldName}',
                        '${parentEntityName}',
                        ${parentKeyExpr},
                        ${immediateParentObjectIDExpr},
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;`;
}

module.exports = {
  buildCompOfManyRootObjectIDSelect,
  buildCompositionParentBlock
};
