const utils = require('./change-tracking.js');

/**
 * Finds composition parent info for an entity.
 * Checks if root entity has a @changelog annotation on a composition field pointing to this entity.
 *
 * Returns null if not found, or an object with:
 *   { parentEntityName, compositionFieldName, parentKeyBinding, isCompositionOfOne }
 */
function getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations) {
	if (!rootEntity) return null;

	for (const [elemName, elem] of Object.entries(rootEntity.elements)) {
		if (elem.type !== 'cds.Composition' || elem.target !== entity.name) continue;

		// Check if this composition has @changelog annotation
		const changelogAnnotation = rootMergedAnnotations?.elementAnnotations?.[elemName] ?? elem['@changelog'];
		if (!changelogAnnotation) continue;

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

	// Check if the grandparent's composition field has @changelog annotation
	const elem = grandParentEntity.elements?.[grandParentCompositionField];
	if (!elem || elem.type !== 'cds.Composition' || elem.target !== rootEntity.name) return null;

	const changelogAnnotation = grandParentMergedAnnotations?.elementAnnotations?.[grandParentCompositionField] ?? elem['@changelog'];
	if (!changelogAnnotation) return null;

	// Get FK binding from rootEntity to grandParentEntity
	const grandParentKeyBinding = utils.getCompositionParentBinding(rootEntity, grandParentEntity);
	if (!grandParentKeyBinding || grandParentKeyBinding.length === 0) return null;

	return {
		grandParentEntityName: grandParentEntity.name,
		grandParentCompositionFieldName: grandParentCompositionField,
		grandParentKeyBinding
	};
}

module.exports = { getCompositionParentInfo, getGrandParentCompositionInfo };
