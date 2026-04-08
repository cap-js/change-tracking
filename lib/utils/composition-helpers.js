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

		return {
			parentEntityName: rootEntity.name,
			compositionFieldName: elemName,
			parentKeyBinding,
			isCompositionOfOne
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
 * @returns {Array} Array of { entityName, compositionFieldName, keyBinding, objectIDs } from innermost to outermost ancestor
 */
function getAncestorCompositionChain(rootEntity, ancestorChain, model) {
	if (!ancestorChain || ancestorChain.length === 0) return [];

	const chain = [];
	let childEntity = rootEntity;

	for (const ancestor of ancestorChain) {
		const elem = ancestor.entity.elements[ancestor.compositionField];
		const changelogAnnotation = ancestor.mergedAnnotations?.elementAnnotations?.[ancestor.compositionField] ?? elem['@changelog'];
		if (changelogAnnotation === false) break;

		chain.push({
			entityName: ancestor.entity.name,
			compositionFieldName: ancestor.compositionField,
			keyBinding: utils.getCompositionParentBinding(childEntity, ancestor.entity),
			objectIDs: utils.getObjectIDs(ancestor.entity, model, ancestor.mergedAnnotations?.entityAnnotation)
		});

		childEntity = ancestor.entity;
	}

	return chain;
}

module.exports = { getCompositionParentInfo, getGrandParentCompositionInfo, getAncestorCompositionChain };
