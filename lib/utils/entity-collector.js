const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

function isChangeTracked(entity) {
	if (entity['@changelog'] === false) return false;
	if (entity['@changelog']) return true;
	return Object.values(entity.elements).some((e) => e['@changelog']);
}

// Compares two @changelog annotation values for equality
function _annotationsEqual(a, b) {
	// Handle null/undefined/false cases
	if (a === b) return true;
	if (a == null || b == null) return false;
	// Deep equality via structuredClone + comparison (order-safe)
	return JSON.stringify(structuredClone(a)) === JSON.stringify(structuredClone(b));
}

// Maps service element name to DB element name (handles renaming in projections)
function _getDbElementName(serviceEntity, elementName) {
	const columns = (serviceEntity.projection ?? serviceEntity.query?.SELECT)?.columns;
	if (!columns) return elementName;

	for (const col of columns) {
		// Check for a renamed column: { ref: ['title'], as: 'adminTitle' }
		if (typeof col === 'object' && col.as === elementName && col.ref?.length > 0) {
			return col.ref[0];
		}
	}
	return elementName;
}

function _mergeChangelogAnnotations(dbEntity, serviceEntities) {
	// Track merged annotations for conflict detection
	let mergedEntityAnnotation = dbEntity['@changelog'];
	let mergedEntityAnnotationSource = mergedEntityAnnotation ? dbEntity.name : null;
	const mergedElementAnnotations = new Map(); // Map<dbElementName, { annotation, sourceName }>

	// Initialize with DB entity element annotations
	for (const element of dbEntity.elements) {
		if (element['@changelog'] !== undefined) {
			mergedElementAnnotations.set(element.name, {
				annotation: element['@changelog'],
				sourceName: dbEntity.name
			});
		}
	}

	// Merge annotations from each service entity
	for (const { entity: srvEntity, entityAnnotation, elementAnnotations } of serviceEntities) {
		// Merge entity-level @changelog (ObjectID definition)
		if (entityAnnotation !== undefined) {
			if (mergedEntityAnnotation !== undefined && !_annotationsEqual(mergedEntityAnnotation, entityAnnotation)) {
				throw new Error(
					`Conflicting @changelog annotations on entity '${dbEntity.name}': ` + `'${mergedEntityAnnotationSource}' has ${JSON.stringify(mergedEntityAnnotation)} but ` + `'${srvEntity.name}' has ${JSON.stringify(entityAnnotation)}`
				);
			}
			if (mergedEntityAnnotation === undefined) {
				mergedEntityAnnotation = entityAnnotation;
				mergedEntityAnnotationSource = srvEntity.name;
			}
		}

		// Merge element-level @changelog annotations
		for (const [srvElemName, annotation] of Object.entries(elementAnnotations)) {
			// Map service element name to DB element name (handles renaming)
			const dbElemName = _getDbElementName(srvEntity, srvElemName);

			// Skip if annotation is false/null (explicit opt-out)
			if (annotation === false || annotation === null) continue;

			const existing = mergedElementAnnotations.get(dbElemName);
			if (existing && !_annotationsEqual(existing.annotation, annotation)) {
				throw new Error(
					`Conflicting @changelog annotations on element '${dbElemName}' of entity '${dbEntity.name}': ` + `'${existing.sourceName}' has ${JSON.stringify(existing.annotation)} but ` + `'${srvEntity.name}' has ${JSON.stringify(annotation)}`
				);
			}
			if (!existing) {
				mergedElementAnnotations.set(dbElemName, {
					annotation,
					sourceName: srvEntity.name
				});
			}
		}
	}

	// Convert Map to plain object for elementAnnotations
	const elementAnnotationsObj = {};
	for (const [elemName, { annotation }] of mergedElementAnnotations) {
		elementAnnotationsObj[elemName] = annotation;
	}

	return {
		entityAnnotation: mergedEntityAnnotation,
		elementAnnotations: elementAnnotationsObj
	};
}

function getEntitiesForTriggerGeneration(model, collected) {
	const result = [];
	const processedDbEntities = new Set();

	// Process collected service entities - resolve entities and annotations from names
	for (const [dbEntityName, serviceEntityNames] of collected) {
		processedDbEntities.add(dbEntityName);
		const dbEntity = model[dbEntityName];
		if (!dbEntity) {
			DEBUG?.(`DB entity ${dbEntityName} not found in model, skipping`);
			continue;
		}

		// Resolve service entities and extract their annotations
		const serviceEntities = [];
		for (const name of serviceEntityNames) {
			const serviceEntity = model[name];
			if (!serviceEntity) {
				DEBUG?.(`Service entity ${name} not found in model, skipping`);
				continue;
			}

			// Extract @changelog annotations from the service entity
			const entityAnnotation = serviceEntity['@changelog'];
			const elementAnnotations = {};
			for (const element of serviceEntity.elements) {
				if (element['@changelog'] !== undefined) {
					elementAnnotations[element.name] = element['@changelog'];
				}
			}

			serviceEntities.push({
				entity: serviceEntity,
				entityAnnotation,
				elementAnnotations
			});
		}

		try {
			const mergedAnnotations = _mergeChangelogAnnotations(dbEntity, serviceEntities);
			result.push({ dbEntityName, mergedAnnotations });
			DEBUG?.(`Merged annotations for ${dbEntityName} from ${serviceEntities.length} service entities`);
		} catch (error) {
			LOG.error(error.message);
			throw error;
		}
	}

	// Add table entities that have @changelog but weren't collected
	for (const def of model) {
		const isTableEntity = def.kind === 'entity' && !def.query && !def.projection;
		if (!isTableEntity || processedDbEntities.has(def.name)) continue;

		if (isChangeTracked(def)) {
			// No service entities collected, use null for mergedAnnotations (use entity's own annotations)
			result.push({ dbEntityName: def.name, mergedAnnotations: null });
			processedDbEntities.add(def.name);
			DEBUG?.(`Including DB entity ${def.name} directly (no service entities collected)`);
		}
	}

	// Add composition-of-many target entities that have @changelog on the composition field
	for (const { dbEntityName, mergedAnnotations } of [...result]) {
		const dbEntity = model[dbEntityName];

		for (const element of Object.values(dbEntity.elements)) {
			if (element.type !== 'cds.Composition' || !element.is2many || !element.target) continue;

			const changelogAnnotation = mergedAnnotations?.elementAnnotations?.[element.name] ?? element['@changelog'];
			if (!changelogAnnotation) continue;

			// Skip if target entity is already processed
			if (processedDbEntities.has(element.target)) continue;

			const targetEntity = model[element.target];
			if (!targetEntity) continue;

			// Add target entity with null mergedAnnotations (it uses its own annotations, if any)
			result.push({ dbEntityName: element.target, mergedAnnotations: null });
			processedDbEntities.add(element.target);
			DEBUG?.(`Including composition target ${element.target} for tracked composition ${element.name} on ${dbEntityName}`);
		}
	}

	return result;
}

// Recursively find the base entity of a projection (needed for loaded lifecycle hook)
function getBaseEntity(entity, model) {
	const cqn = entity.projection ?? entity.query?.SELECT;
	if (!cqn) return null;

	const baseRef = cqn.from?.ref?.[0];
	if (!baseRef || !model) return null;

	const baseEntity = model.definitions[baseRef];
	if (!baseEntity) return null;
	const baseCQN = baseEntity.projection ?? baseEntity.query?.SELECT ?? baseEntity.query?.SET;
	// If base entity is also a projection, recurse
	if (baseCQN) {
		return getBaseEntity(baseEntity, model);
	} else {
		return { baseRef, baseEntity };
	}
}

// Analyze composition hierarchy in CSN
function analyzeCompositions(csn) {
	// First pass: build child -> { parent, compositionField } map
	const childParentMap = new Map();

	for (const [name, def] of Object.entries(csn.definitions)) {
		if (def.kind !== 'entity') continue;

		if (def.elements) {
			for (const [elemName, element] of Object.entries(def.elements)) {
				if (element.type === 'cds.Composition' && element.target) {
					childParentMap.set(element.target, {
						parent: name,
						compositionField: elemName
					});
				}
			}
		}
	}

	// Second pass: build hierarchy with grandparent info
	const hierarchy = new Map();
	for (const [childName, parentInfo] of childParentMap) {
		const { parent: parentName, compositionField } = parentInfo;

		// Check if the parent itself has a parent (grandparent)
		const grandParentInfo = childParentMap.get(parentName);

		hierarchy.set(childName, {
			parent: parentName,
			compositionField,
			grandParent: grandParentInfo?.parent ?? null,
			grandParentCompositionField: grandParentInfo?.compositionField ?? null
		});
	}

	return hierarchy;
}

function getService(name, model) {
	const nameSegments = name.split('.');
	let service;
	let serviceName = '';

	// Goining in reverse to ensure that in scenarios where one service includes another service name
	// in its namespace the correct service is chosen
	while (!service && nameSegments.length) {
		nameSegments.pop();
		serviceName = nameSegments.join('.');
		service = model.definitions[serviceName];
		if (service?.kind !== 'service') {
			service = null;
		}
	}
	if (!service) {
		serviceName = '';
	}
	return serviceName;
}

/**
 * REVISIT!
 * Collect change-tracked service entities from a model, grouped by their underlying DB entity
 */
function collectEntities(model) {
	const collectedEntities = new Map();
	const hierarchyMap = analyzeCompositions(model);

	for (const name in model.definitions) {
		const entity = model.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
		if (isServiceEntity && isChangeTracked(entity)) {
			const baseInfo = getBaseEntity(entity, model);
			if (!baseInfo) continue;
			const { baseRef: dbEntityName } = baseInfo;

			if (!collectedEntities.has(dbEntityName)) collectedEntities.set(dbEntityName, []);
			collectedEntities.get(dbEntityName).push(name);
		}
	}

	return { collectedEntities, hierarchyMap };
}

module.exports = {
	isChangeTracked,
	getEntitiesForTriggerGeneration,
	getBaseEntity,
	analyzeCompositions,
	getService,
	collectEntities
};
