const utils = require('./change-tracking.js');

/**
 * Finds composition parent info for an entity.
 * Returns null if not found, or an object with:
 *   { parentEntityName, compositionFieldName, parentKeyBinding, isCompositionOfOne }
 */
function getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations) {
	if (!rootEntity) return null;

	for (const [elemName, elem] of Object.entries(rootEntity.elements)) {
		if (elem.type !== 'cds.Composition' || elem.target !== entity.name) continue;

		// Check if this composition has @changelog: false annotation
		const changelogAnnotation = rootMergedAnnotations?.elementAnnotations?.[elemName] ?? elem['@changelog'];
		if (changelogAnnotation === false) continue;

		// Found a tracked composition - get the FK binding from child to parent
		const parentKeyBinding = utils.getCompositionParentBinding(entity, rootEntity);
		if (!parentKeyBinding) continue;

		// Handle both array bindings (composition of many) and object bindings (composition of one)
		const isCompositionOfOne = parentKeyBinding.type === 'compositionOfOne';
		if (!isCompositionOfOne && parentKeyBinding.length === 0) continue;

		// For composition-of-many, extract and validate field-level @changelog
		// Only include paths that reference elements on the parent (root) entity
		let compositionFieldChangelog = null;
		if (!isCompositionOfOne) {
			// Normalize single-object expression annotations into array form
			const normalizedAnnotation = changelogAnnotation && typeof changelogAnnotation === 'object' && !Array.isArray(changelogAnnotation) && changelogAnnotation['='] ? [changelogAnnotation] : changelogAnnotation;
			if (Array.isArray(normalizedAnnotation)) {
				const validPaths = [];
				for (const entry of normalizedAnnotation) {
					if (entry && typeof entry === 'object' && entry.xpr) {
						// Expression annotation: validate that all refs reference parent entity elements
						const valid = utils.validateExpressionRefs(entry.xpr, elemName, rootEntity);
						if (valid) {
							validPaths.push(entry);
						}
						continue;
					}
					const path = entry?.['='];
					if (!path) continue;
					const segments = path.split('.');
					// Reject paths that reference the child entity (start with the composition field name)
					if (segments[0] === elemName) continue;
					// Validate path exists on parent entity
					if (!rootEntity.elements?.[segments[0]]) continue;
					validPaths.push(entry);
				}
				if (validPaths.length > 0) {
					compositionFieldChangelog = validPaths;
				}
			}
		}

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding,
			isCompositionOfOne,
			compositionFieldChangelog
		};
	}

	return null;
}

/**
 * Gets grandparent composition info for deep linking of changelog entries.
 * Used when linking a composition's changelog entry to its parent's composition changelog entry.
 *
 * Returns null if not applicable, or:
 *   { grandParentEntityName, grandParentCompositionFieldName, grandParentKeyBinding }
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
 * @param {object} rootEntity - The immediate parent entity (composition owner)
 * @param {Array} ancestorChain - Array of { entity, mergedAnnotations, compositionField } from trigger-utils
 * @param {object} model - The CDS model (CSN) for resolving objectIDs
 * @returns {Array} Array of { entityName, compositionFieldName, keyBinding, objectIDs, childObjectIDs, childEntityName } from innermost to outermost ancestor
 */
function getAncestorCompositionChain(rootEntity, ancestorChain, model) {
	if (!ancestorChain || ancestorChain.length === 0) return [];

	const chain = [];
	let childEntity = rootEntity;

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
 * Resolves the childObjectIDExpr and compositionFieldObjectIDExpr for composition parent entries.
 * - Composition of one: uses the child entity's own objectID expression (driver-provided)
 * - Composition of many: sets childObjectIDExpr to null and computes compositionFieldObjectIDExpr via the driver-provided callback
 */
function resolveCompositionObjectIDs(compositionParentInfo, defaultChildObjectIDExpr, buildFieldObjectID, model) {
	let childObjectIDExpr = defaultChildObjectIDExpr;
	let compositionFieldObjectIDExpr = null;

	if (compositionParentInfo && !compositionParentInfo.isCompositionOfOne) {
		childObjectIDExpr = null;
		const parentEntity = model.definitions[compositionParentInfo.parentEntityName];
		compositionFieldObjectIDExpr = buildFieldObjectID(compositionParentInfo.compositionFieldChangelog, compositionParentInfo.parentEntityName, parentEntity, compositionParentInfo.parentKeyBinding);
	}

	return { childObjectIDExpr, compositionFieldObjectIDExpr };
}

module.exports = { getCompositionParentInfo, getGrandParentCompositionInfo, getAncestorCompositionChain, resolveCompositionObjectIDs, parseCompositionFieldChangelog };
