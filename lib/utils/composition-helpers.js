const utils = require('./change-tracking.js');

/**
 * Finds composition parent info for an entity.
 * Walks `parentEntity.compositions` to find the composition pointing at `entity`,
 * validates the @changelog annotation (skips if `false`), and resolves the FK binding.
 * For composition-of-many, also extracts and validates the field-level @changelog
 * (paths and expressions) used to build the parent composition entry's objectID.
 *
 * @param {object} entity - The (child) entity to check
 * @param {object} parentEntity - The immediate parent entity (composition owner)
 * @param {object} [parentMergedAnnotations] - Merged annotations for parentEntity
 * @returns {null | { compositionFieldName: string, parentKeyBinding: Array|object, compositionFieldChangelog: Array|null }}
 *   - `null` if entity is not a tracked composition target of `parentEntity`
 *   - `parentKeyBinding`: array of FK field names (composition-of-many)
 *     or `{ type: 'compositionOfOne', compositionName, childKeys, rootEntityName }`
 */
function getCompositionParentInfo(entity, parentEntity, parentMergedAnnotations) {
  if (!parentEntity || !parentEntity.compositions) return null;

  for (const comp of parentEntity.compositions) {
    if (comp.target !== entity.name) continue;

    // Check if this composition has @changelog: false annotation
    const changelogAnnotation = parentMergedAnnotations?.elementAnnotations?.[comp.name] ?? comp['@changelog'];
    if (changelogAnnotation === false) continue;

    // Found a tracked composition - get the FK binding from child to parent
    const parentKeyBinding = utils.getCompositionParentBinding(entity, parentEntity);
    if (!parentKeyBinding) continue;

    // Handle both array bindings (composition of many) and object bindings (composition of one)
    if (parentKeyBinding.type !== 'compositionOfOne' && parentKeyBinding.length === 0) continue;

    // For composition-of-many, extract and validate field-level @changelog
    // Only include paths that reference elements on the parent entity
    let compositionFieldChangelog = null;
    if (parentKeyBinding.type !== 'compositionOfOne') {
      // Normalize single-object expression annotations into array form
      const normalizedAnnotation = changelogAnnotation && typeof changelogAnnotation === 'object' && !Array.isArray(changelogAnnotation) ? [changelogAnnotation] : changelogAnnotation;
      if (Array.isArray(normalizedAnnotation)) {
        const validPaths = [];
        for (const entry of normalizedAnnotation) {
          if (entry && typeof entry === 'object' && entry.xpr) {
            // Expression annotation: validate that all refs reference parent entity elements
            const valid = utils.validateExpressionRefs(entry.xpr, comp.name, parentEntity);
            if (valid) {
              validPaths.push(entry);
            }
            continue;
          }
          const path = entry?.['='];
          if (!path) continue;
          const segments = path.split('.');
          // Reject paths that reference the child entity (start with the composition field name)
          if (segments[0] === comp.name) continue;
          // Validate path exists on parent entity
          if (!parentEntity.elements?.[segments[0]]) continue;
          validPaths.push(entry);
        }
        if (validPaths.length > 0) {
          compositionFieldChangelog = validPaths;
        }
      }
    }

    return {
      compositionFieldName: comp.name,
      parentKeyBinding,
      compositionFieldChangelog
    };
  }

  return null;
}

/**
 * Gets grandparent composition info for deep linking of changelog entries.
 * Used when linking a composition's changelog entry to its parent's composition changelog entry.
 *
 * @param {object} rootEntity - The composition target whose grandparent we are resolving
 * @param {object} grandParentEntity - The grandparent entity
 * @param {object} grandParentMergedAnnotations - Merged annotations for the grandparent
 * @param {string} grandParentCompositionField - The composition element name on the grandparent
 * @returns {null | { grandParentEntityName: string, grandParentCompositionFieldName: string, grandParentKeyBinding: Array }}
 */
function getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField) {
  if (!grandParentEntity || !grandParentCompositionField) return null;

  // Check if the grandparent's composition field has @changelog: false annotation
  const elem = grandParentEntity.elements?.[grandParentCompositionField];
  if (!elem || elem.type !== 'cds.Composition' || elem.target !== rootEntity.name) return null;

  const changelogAnnotation = grandParentMergedAnnotations?.elementAnnotations?.[grandParentCompositionField] ?? elem['@changelog'];
  if (changelogAnnotation === false) return null;

  // Get FK binding from rootEntity to grandParentEntity
  const grandParentKeyBinding = utils.getCompositionParentBinding(rootEntity, grandParentEntity);
  if (!grandParentKeyBinding || grandParentKeyBinding.length === 0) return null;

  return {
    grandParentEntityName: grandParentEntity.name,
    grandParentCompositionFieldName: grandParentCompositionField,
    grandParentKeyBinding
  };
}

/**
 * Resolves the full ancestor composition chain for an entity.
 * Each entry in the returned array represents one ancestor level with its key binding.
 *
 * @param {object} parentEntity - The immediate parent entity (composition owner)
 * @param {Array} ancestorChain - Array of { entity, mergedAnnotations, compositionField } from trigger-utils
 * @param {object} model - The CDS model (CSN) for resolving objectIDs
 * @returns {Array} Array of { entityName, compositionFieldName, keyBinding, objectIDs, childObjectIDs, childEntityName } from innermost to outermost ancestor
 */
function getAncestorCompositionChain(parentEntity, ancestorChain, model) {
  if (!ancestorChain || ancestorChain.length === 0) return [];

  const chain = [];
  let childEntity = parentEntity;

  for (const ancestor of ancestorChain) {
    const elem = ancestor.entity.elements[ancestor.compositionField];
    const changelogAnnotation = ancestor.mergedAnnotations?.elementAnnotations?.[ancestor.compositionField] ?? elem['@changelog'];
    if (changelogAnnotation === false) break;

    // objectIDs of the child entity (the composition target for this ancestor level)
    // Used for composition entry objectID — shows which child entity was affected
    const childObjectIDs = utils.getObjectIDs(childEntity, model);

    chain.push({
      entityName: ancestor.entity.name,
      compositionFieldName: ancestor.compositionField,
      keyBinding: utils.getCompositionParentBinding(childEntity, ancestor.entity),
      objectIDs: utils.getObjectIDs(ancestor.entity, model, ancestor.mergedAnnotations?.entityAnnotation),
      childObjectIDs,
      childEntityName: childEntity.name
    });

    childEntity = ancestor.entity;
  }

  return chain;
}

/**
 * Parses a composition field's @changelog annotation into a intermediate representation
 *
 * @param {Array} compositionFieldChangelog - Normalized @changelog annotation entries
 * @param {object} parentEntity - CSN definition of the parent entity
 * @param {Array} parentKeyBinding - FK field names on the child entity pointing to the parent
 * @param {string} refRow - Trigger row reference
 * @returns {null | { type: 'expression', exprColumn: object, where: object } | { type: 'paths', objectIDs: Array }}
 */
function parseCompositionFieldChangelog(compositionFieldChangelog, parentEntity, parentKeyBinding, refRow, quoteFn) {
  if (!compositionFieldChangelog || compositionFieldChangelog.length === 0) return null;

  const q = quoteFn ?? ((n) => n);

  // Expression-based annotation (e.g., @changelog: ('Items from ' || name))
  const expressionEntry = compositionFieldChangelog.find((e) => e && typeof e === 'object' && e.xpr);
  if (expressionEntry) {
    const parentKeys = utils.extractKeys(parentEntity.keys);
    if (parentKeys.length !== parentKeyBinding.length) return null;
    const where = {};
    for (let i = 0; i < parentKeys.length; i++) {
      where[parentKeys[i]] = { val: `${refRow}.${q(parentKeyBinding[i])}`, literal: 'sql' };
    }
    const exprColumn = utils.buildExpressionColumn(expressionEntry.xpr);
    return { type: 'expression', exprColumn, where };
  }

  // Path-based annotation (e.g., @changelog: [orderNumber])
  const objectIDs = [];
  for (const entry of compositionFieldChangelog) {
    const field = entry['='];
    if (!field) continue;
    const element = parentEntity.elements?.[field];
    const included = !!element && !element['@Core.Computed'];
    objectIDs.push({ name: field, included });
  }
  if (objectIDs.length === 0) return null;

  return { type: 'paths', objectIDs };
}

/**
 * Resolves the full composition hierarchy for an entity (immediate parent + ancestors).
 * Returns null if entity is not a tracked composition target.
 *
 * @param {object} entity - The entity to check
 * @param {object} parentEntity - The immediate parent entity (composition owner)
 * @param {object} parentMergedAnnotations - Merged annotations for parentEntity
 * @param {Array} ancestorChain - Array of { entity, mergedAnnotations, compositionField } from trigger-utils
 * @param {object} model - The CDS model (CSN)
 * @returns {null | { levels: Array, compositionFieldChangelog: Array|null }}
 */
function getCompositionHierarchy(entity, parentEntity, parentMergedAnnotations, ancestorChain, model) {
  const parentInfo = getCompositionParentInfo(entity, parentEntity, parentMergedAnnotations);
  if (!parentInfo) return null;

  const { compositionFieldName, parentKeyBinding, compositionFieldChangelog } = parentInfo;

  // Build the levels array: immediate parent + ancestors
  const levels = [{ entityName: parentEntity.name, compositionFieldName, keyBinding: parentKeyBinding }];

  if (parentKeyBinding.type !== 'compositionOfOne') {
    const ancestors = getAncestorCompositionChain(parentEntity, ancestorChain, model);
    levels.push(...ancestors);
  }

  return { levels, compositionFieldChangelog };
}

module.exports = { getCompositionParentInfo, getGrandParentCompositionInfo, getAncestorCompositionChain, getCompositionHierarchy, parseCompositionFieldChangelog };
