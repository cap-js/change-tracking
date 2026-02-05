/**
 * Legacy entity processing logic for composition hierarchy analysis.
 * This module was used by the old change tracking logic to determine
 * root entities and parent-child relationships in compositions.
 * 
 * @deprecated This logic is kept for backward compatibility but may be removed in future versions.
 */

const isRoot = 'change-tracking-isRootEntity';
const hasParent = 'change-tracking-parentEntity';

function setChangeTrackingIsRootEntity(entity, csn, val = true) {
	if (csn.definitions?.[entity.name]) {
		csn.definitions[entity.name][isRoot] = val;
	}
}

function checkAndSetRootEntity(parentEntity, entity, csn) {
	if (entity[isRoot] === false) {
		return entity;
	}
	if (parentEntity) {
		return compositionRoot(parentEntity, csn);
	} else {
		setChangeTrackingIsRootEntity(entity, csn);
		return { ...csn.definitions?.[entity.name], name: entity.name };
	}
}

function processEntities(m) {
	for (let name in m.definitions) {
		compositionRoot({ ...m.definitions[name], name }, m);
	}
}

function compositionRoot(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const parentEntity = compositionParent(entity, csn);
	return checkAndSetRootEntity(parentEntity, entity, csn);
}

function compositionParent(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const parentAssociation = compositionParentAssociation(entity, csn);
	return parentAssociation ?? null;
}

function compositionParentAssociation(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const elements = entity.elements ?? {};

	// Add the change-tracking-isRootEntity attribute of the child entity
	processCompositionElements(entity, csn, elements);

	const hasChildFlag = entity[isRoot] !== false;
	const hasParentEntity = entity[hasParent];

	if (hasChildFlag || !hasParentEntity) {
		// Find parent association of the entity
		const parentAssociation = findParentAssociation(entity, csn, elements);
		if (parentAssociation) {
			const parentAssociationTarget = elements[parentAssociation]?.target;
			if (hasChildFlag) setChangeTrackingIsRootEntity(entity, csn, false);
			return {
				...csn.definitions?.[parentAssociationTarget],
				name: parentAssociationTarget
			};
		} else return;
	}
	return { ...csn.definitions?.[entity.name], name: entity.name };
}

function processCompositionElements(entity, csn, elements) {
	for (const name in elements) {
		const element = elements[name];
		const target = element?.target;
		const definition = csn.definitions?.[target];
		if (element.type !== 'cds.Composition' || target === entity.name || !definition || definition[isRoot] === false) {
			continue;
		}
		setChangeTrackingIsRootEntity({ ...definition, name: target }, csn, false);
	}
}

function findParentAssociation(entity, csn, elements) {
	return Object.keys(elements).find((name) => {
		const element = elements[name];
		const target = element?.target;
		if (element.type === 'cds.Association' && target !== entity.name) {
			const parentDefinition = csn.definitions?.[target] ?? {};
			const parentElements = parentDefinition?.elements ?? {};
			return !!Object.keys(parentElements).find((parentEntityName) => {
				const parentElement = parentElements?.[parentEntityName] ?? {};
				if (parentElement.type === 'cds.Composition') {
					const isCompositionEntity = parentElement.target === entity.name;
					// add parent information in the current entity
					if (isCompositionEntity) {
						csn.definitions[entity.name][hasParent] = {
							associationName: name,
							entityName: target
						};
					}
					return isCompositionEntity;
				}
			});
		}
	});
}

module.exports = {
	isRoot,
	hasParent,
	processEntities
};
