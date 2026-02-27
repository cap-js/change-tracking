const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

function isChangeTracked(entity) {
	if (entity.query?.SET?.op === 'union') return false; // REVISIT: should that be an error or warning?
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
			DEBUG?.(`Including DB entity ${def.name} directly (no service entities collected)`);
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
	const baseCQN = baseEntity.projection ?? baseEntity.query?.SELECT;
	// If base entity is also a projection, recurse
	if (baseCQN?.from?.ref) {
		return getBaseEntity(baseEntity, model);
	}

	return { baseRef, baseEntity };
}

// Analyze composition hierarchy in CSN
function analyzeCompositions(csn) {
	const childParentMap = new Map();

	for (const [name, def] of Object.entries(csn.definitions)) {
		if (def.kind !== 'entity') continue;

		if (def.elements) {
			for (const element of Object.values(def.elements)) {
				if (element.type === 'cds.Composition' && element.target) {
					childParentMap.set(element.target, name);
				}
			}
		}
	}

	const hierarchy = new Map();
	for (const [childName, parentName] of childParentMap) {
		let root = parentName;
		hierarchy.set(childName, root);
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

module.exports = {
	isChangeTracked,
	getEntitiesForTriggerGeneration,
	getBaseEntity,
	analyzeCompositions,
	getService
};
