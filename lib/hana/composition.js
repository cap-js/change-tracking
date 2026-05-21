const utils = require('../utils/change-tracking.js');
const { toSQL, entityKeyExpr, quote } = require('./sql-expressions.js');

/**
 * Builds rootObjectID select for composition of many.
 */
function buildCompOfManyRootObjectIDSelect(rootEntity, rootObjectIDs, binding, refRow, model, keyValueExprs = null) {
  const keyValues = keyValueExprs ?? binding.map((k) => `:${refRow}.${quote(k)}`);
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
 * Builds context for composition of one parent changelog entry.
 * In composition of one, the parent entity has FK to the child (e.g., BookStores.registry_ID -> BookStoreRegistry.ID)
 * So we need to do a reverse lookup: find the parent record that has FK pointing to this child.
 */
function buildCompositionOfOneParentContext(compositionParentInfo, rootObjectIDs, rowRef, model, childObjectIDExpr = null) {
  const { parentEntityName, compositionFieldName, parentKeyBinding } = compositionParentInfo;
  const { compositionName, childKeys } = parentKeyBinding;

  // Build the FK field names on the parent that point to this child
  // For composition of one, CAP generates <compositionName>_<childKey> fields
  const parentFKFields = childKeys.map((k) => quote(`${compositionName}_${k}`));

  // Build WHERE clause to find the parent entity that has this child
  const parentEntity = model.definitions[parentEntityName];
  const parentKeys = utils.extractKeys(parentEntity.keys);
  const parentWhereClause = parentFKFields.map((fk, i) => `${fk} = :${rowRef}.${quote(childKeys[i])}`).join(' AND ');

  // Build the parent key expression via subquery (reverse lookup)
  const parentKeySubqueries = parentKeys.map((pk) => `(SELECT ${quote(pk)} FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause})`);
  const parentKeyExpr = entityKeyExpr(parentKeySubqueries);

  // Use child's objectID expression for the composition entry — shows which child was affected
  // Falls back to parent's own objectID if child objectID is not available
  const objectIDExpr = childObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(parentEntity, rootObjectIDs, null, null, model, parentKeySubqueries);

  const declares = 'DECLARE parent_id NVARCHAR(36);';

  const insertSQL = `
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				parent_id,
				NULL,
				'${compositionFieldName}',
				'${parentEntityName}',
				${parentKeyExpr},
				${objectIDExpr},
				CURRENT_TIMESTAMP,
				SESSION_CONTEXT('APPLICATIONUSER'),
				'cds.Composition',
				'update',
				CURRENT_UPDATE_TRANSACTION()
			FROM SAP_CHANGELOG_CHANGE_TRACKING_DUMMY
			WHERE EXISTS (
				SELECT 1 FROM ${utils.transformName(parentEntityName)} WHERE ${parentWhereClause}
			)
			AND NOT EXISTS (
				SELECT 1 FROM SAP_CHANGELOG_CHANGES
				WHERE entity = '${parentEntityName}'
				AND entityKey = ${parentKeyExpr}
				AND attribute = '${compositionFieldName}'
				AND valueDataType = 'cds.Composition'
				AND transactionID = CURRENT_UPDATE_TRANSACTION()
			);`;

  return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr };
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
  const keyExprs = [entityKeyExpr(parentKeyBinding.map((k) => `:${rowRef}.${quote(k)}`))];
  const ancestorKeyValues = [parentKeyBinding.map((k) => `:${rowRef}.${quote(k)}`)];

  if (levels.length > 1) {
    const childEntity0 = model.definitions[levels[0].entityName];
    const childKeys0 = utils.extractKeys(childEntity0.keys);
    const childWhereClauses = [childKeys0.map((pk, j) => `${quote(pk)} = :${rowRef}.${quote(parentKeyBinding[j])}`).join(' AND ')];

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

function buildCompositionParentContext(compositionHierarchy, parentObjectIDs, rowRef, model, childObjectIDExpr = null, buildFieldObjectIDFn = null) {
  const { levels, compositionFieldChangelog } = compositionHierarchy;
  const { entityName: parentEntityName, compositionFieldName, keyBinding: parentKeyBinding } = levels[0];

  // Handle composition of one (parent has FK to child - need reverse lookup)
  if (parentKeyBinding.type === 'compositionOfOne') {
    return buildCompositionOfOneParentContext({ parentEntityName, compositionFieldName, parentKeyBinding }, parentObjectIDs, rowRef, model, childObjectIDExpr);
  }

  const parentKeyExpr = entityKeyExpr(parentKeyBinding.map((k) => `:${rowRef}.${quote(k)}`));

  // Null check for parent FK columns — prevents creating composition entries when FK is null
  const parentFKNullCheck = parentKeyBinding.map((k) => `:${rowRef}.${quote(k)} IS NOT NULL`).join(' AND ');

  // Composition of many: resolve the objectID for the composition field
  let compositionFieldObjectIDExpr = null;
  if (buildFieldObjectIDFn) {
    const parentEntity = model.definitions[parentEntityName];
    compositionFieldObjectIDExpr = buildFieldObjectIDFn(compositionFieldChangelog, parentEntityName, parentEntity, parentKeyBinding);
  }

  // Resolve objectID for the composition entry:
  // 1. childObjectIDExpr: child's own @changelog objectID (only for composition-of-one)
  // 2. compositionFieldObjectIDExpr: @changelog on the composition field (parent elements only, for composition-of-many)
  // 3. buildCompOfManyRootObjectIDSelect: parent entity-level @changelog / entity keys (fallback)
  const rootEntity = model.definitions[parentEntityName];
  const immediateParentObjectIDExpr = compositionFieldObjectIDExpr ?? buildCompOfManyRootObjectIDSelect(rootEntity, parentObjectIDs, parentKeyBinding, rowRef, model);

  let declares, insertSQL;

  if (levels.length > 1) {
    // Resolve key expressions for the composition hierarchy
    const { keyExprs, ancestorKeyValues } = resolveAncestorKeyExpressions(levels, rowRef, model);

    // Declare variables for each level's parent_id
    const declareStatements = ['DECLARE parent_id NVARCHAR(36);'];
    for (let i = 1; i < levels.length; i++) {
      declareStatements.push(`DECLARE ancestor_${i}_id NVARCHAR(36);`);
    }
    declares = declareStatements.join('\n\t');

    // Generate INSERT statements from outermost ancestor down to the immediate parent
    // Row-level triggers: use procedural INSERT ... VALUES with IF NULL checks
    // For ancestor levels, add a null check on the immediate parent FK to ensure the chain exists.
    // If the immediate parent FK is null, skip all ancestor levels too.
    const insertStatements = [];

    // Build a null check on the immediate parent FK columns (these are on the trigger's entity)
    const immediateParentFKNullCheck = parentKeyBinding.map((k) => `:${rowRef}.${quote(k)} IS NOT NULL`).join(' AND ');

    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i];
      const levelKeyExpr = keyExprs[i];
      const isOutermost = i === levels.length - 1;
      const isImmediateParent = i === 0;

      // Variable name for this level's changelog entry ID
      const varName = isImmediateParent ? 'parent_id' : `ancestor_${i}_id`;

      // parent_ID: NULL for outermost, variable for inner levels
      let parentIDValue = 'NULL';
      if (!isOutermost) {
        parentIDValue = `ancestor_${i + 1}_id`;
      }

      // objectID: use child entity's objectID — shows which child was affected
      let objectIDExpr;
      if (isImmediateParent) {
        objectIDExpr = immediateParentObjectIDExpr;
      } else {
        // For ancestor levels, resolve the child entity's objectID via subquery
        const childEntityDef = model.definitions[level.childEntityName];
        if (childEntityDef && level.childObjectIDs && level.childObjectIDs.length > 0) {
          const childKeyValues = ancestorKeyValues[i - 1];
          objectIDExpr = buildCompOfManyRootObjectIDSelect(childEntityDef, level.childObjectIDs, null, null, model, childKeyValues);
        } else {
          objectIDExpr = keyExprs[i - 1];
        }
      }

      // For non-immediate parent levels (ancestors), wrap in a null check on the immediate parent FK
      // This prevents creating ancestor composition entries when the child has no parent
      // (e.g., RootSample inserted without grandParent)
      const needsFKCheck = !isImmediateParent;
      const fkCheckOpen = needsFKCheck ? `IF ${immediateParentFKNullCheck} THEN\n\t\t\t` : '';
      const fkCheckClose = needsFKCheck ? `\n\t\tEND IF;` : '';

      // Look up existing entry for this level, or create one
      insertStatements.push(`${fkCheckOpen}SELECT MAX(ID) INTO ${varName} FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${level.entityName}'
			AND entityKey = ${levelKeyExpr}
			AND attribute = '${level.compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();
		IF ${varName} IS NULL THEN
			${varName} := SYSUUID;
			INSERT INTO SAP_CHANGELOG_CHANGES
				(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
				VALUES (
					${varName},
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
				);
		END IF;${fkCheckClose}`);
    }

    insertSQL = insertStatements.join('\n\t\t');
  } else {
    // Simple composition-of-many: single-level parent.
    declares = 'DECLARE parent_id NVARCHAR(36);';

    insertSQL = `
		INSERT INTO SAP_CHANGELOG_CHANGES
			(ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (
				parent_id,
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
			);`;
  }

  return { declares, insertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentFKNullCheck };
}

function buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName) {
  return `SELECT MAX(ID) INTO parent_id FROM SAP_CHANGELOG_CHANGES
			WHERE entity = '${parentEntityName}'
			AND entityKey = ${parentKeyExpr}
			AND attribute = '${compositionFieldName}'
			AND valueDataType = 'cds.Composition'
			AND transactionID = CURRENT_UPDATE_TRANSACTION();`;
}

function buildParentLookupOrCreateSQL(compositionParentContext) {
  const { insertSQL: compInsertSQL, parentEntityName, compositionFieldName, parentKeyExpr, parentFKNullCheck } = compositionParentContext;
  const lookupSQL = buildParentLookupSQL(parentEntityName, parentKeyExpr, compositionFieldName);
  // Wrap in FK null check to skip composition entry creation when parent FK is null
  if (parentFKNullCheck) {
    return `IF ${parentFKNullCheck} THEN
			${lookupSQL}
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;
		END IF;`;
  }
  return `${lookupSQL}
		IF parent_id IS NULL THEN
			parent_id := SYSUUID;
			${compInsertSQL}
		END IF;`;
}

function buildCompositionOnlyBody(entityName, compositionParentContext, prefixSQL = '') {
  const { getSkipCheckCondition } = require('./sql-expressions.js');
  const { declares } = compositionParentContext;
  const prefix = prefixSQL ? `\n\t\t${prefixSQL}` : '';
  return `${declares}
	IF ${getSkipCheckCondition(entityName)} THEN${prefix}
		${buildParentLookupOrCreateSQL(compositionParentContext)}
	END IF;`;
}

module.exports = {
  buildCompOfManyRootObjectIDSelect,
  buildCompositionOfOneParentContext,
  buildCompositionParentContext,
  buildParentLookupSQL,
  buildParentLookupOrCreateSQL,
  buildCompositionOnlyBody
};
