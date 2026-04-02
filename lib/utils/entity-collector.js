const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

function isChangeTracked(entity) {
	if (entity['@changelog'] === false) return false;
	if (entity['@changelog']) return true;
	return Object.values(entity.elements).some((e) => e['@changelog']);
}

function _hasTrackedElements(entity) {
	if (!entity?.elements) return false;
	return Object.values(entity.elements).some((e) => e['@changelog'] && e['@changelog'] !== false);
}

// Compares two @changelog annotation values for equality
function _annotationsEqual(a, b) {
	// Handle null/undefined/false cases
	if (a === b) return true;
	if (a == null || b == null) return false;
	// Deep equality via structuredClone + comparison (order-safe)
	const aClone = structuredClone(a);
	const bClone = structuredClone(b);
	// For expression annotations, the "=" field is non-semantic source text that may differ but should be ignored for equality checks
	_stripSourceTextField(aClone);
	_stripSourceTextField(bClone);
	
	return JSON.stringify(aClone) === JSON.stringify(bClone);
}

// Strips the non-semantic "=" source text field from expression annotation objects
function _stripSourceTextField(obj) {
	if (obj && typeof obj === 'object' && !Array.isArray(obj) && (obj.xpr || obj.ref)) {
		delete obj['='];
	}
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

// Rewrites annotation refs from service-level names back to DB-level names
// Reverts CDS compiler rewrites of refs when propagating annotations through projections with renames (e.g. status.descr -> renamedStatus.descr)
function _normalizeAnnotationRefs(annotation, srvEntity) {
	if (annotation == null || typeof annotation === 'boolean') return annotation;

	if (Array.isArray(annotation)) {
		let changed = false;
		const result = annotation.map((entry) => {
			const normalized = _normalizeEntry(entry, srvEntity);
			if (normalized !== entry) changed = true;
			return normalized;
		});
		return changed ? result : annotation;
	}

	if (typeof annotation === 'object') {
		return _normalizeEntry(annotation, srvEntity);
	}

	return annotation;
}

function _normalizeEntry(entry, srvEntity) {
	if (entry == null || typeof entry !== 'object') return entry;
	const normalized = { ...entry };
	let entryChanged = false;

	// Normalize "=" string (e.g., "renamedStatus.descr" -> "status.descr")
	if (typeof normalized['='] === 'string') {
		const segments = normalized['='].split('.');
		const dbName = _getDbElementName(srvEntity, segments[0]);
		if (dbName !== segments[0]) {
			segments[0] = dbName;
			normalized['='] = segments.join('.');
			entryChanged = true;
		}
	}

	// Normalize "ref" array (e.g., ["renamedStatus", "descr"] -> ["status", "descr"])
	if (Array.isArray(normalized.ref) && normalized.ref.length > 0) {
		const dbName = _getDbElementName(srvEntity, normalized.ref[0]);
		if (dbName !== normalized.ref[0]) {
			normalized.ref = [dbName, ...normalized.ref.slice(1)];
			entryChanged = true;
		}
	}

	// Normalize refs within "xpr" expression tokens
	if (Array.isArray(normalized.xpr)) {
		normalized.xpr = normalized.xpr.map((token) => {
			if (token && typeof token === 'object' && Array.isArray(token.ref) && token.ref.length > 0) {
				const dbName = _getDbElementName(srvEntity, token.ref[0]);
				if (dbName !== token.ref[0]) {
					entryChanged = true;
					return { ...token, ref: [dbName, ...token.ref.slice(1)] };
				}
			}
			return token;
		});
	}

	return entryChanged ? normalized : entry;
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

function _extractServiceAnnotations(serviceEntity, dbEntity) {
	const entityAnnotation = _normalizeAnnotationRefs(serviceEntity['@changelog'], serviceEntity);
	const elementAnnotations = {};
	for (const element of serviceEntity.elements) {
		if (element['@changelog'] !== undefined) {
			// Skip renamed elements — they don't exist in the DB entity
			// and carry rewritten annotation refs (e.g., renamedStatus)
			if (dbEntity && !dbEntity.elements[element.name]) continue;
			elementAnnotations[element.name] = _normalizeAnnotationRefs(element['@changelog'], serviceEntity);
		}
	}
	return { entity: serviceEntity, entityAnnotation, elementAnnotations };
}

// Resolve collected service entities into DB entities with merged annotations
function _collectServiceEntities(model, collected, result, processed) {
	for (const [dbEntityName, serviceEntityNames] of collected) {
		processed.add(dbEntityName);
		const dbEntity = model[dbEntityName];
		if (!dbEntity) {
			DEBUG?.(`DB entity ${dbEntityName} not found in model, skipping`);
			continue;
		}

		const serviceEntities = [];
		for (const name of serviceEntityNames) {
			const serviceEntity = model[name];
			if (!serviceEntity) {
				DEBUG?.(`Service entity ${name} not found in model, skipping`);
				continue;
			}
			serviceEntities.push(_extractServiceAnnotations(serviceEntity, dbEntity));
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
}

// Include standalone DB entities that have @changelog but no service projection
function _collectStandaloneEntities(model, result, processed) {
	for (const def of model) {
		const isTableEntity = def.kind === 'entity' && !def.query && !def.projection;
		if (!isTableEntity || processed.has(def.name)) continue;

		if (isChangeTracked(def)) {
			result.push({ dbEntityName: def.name, mergedAnnotations: null });
			processed.add(def.name);
			DEBUG?.(`Including DB entity ${def.name} directly (no service entities collected)`);
		}
	}
}

/**
 * Auto-discover composition target entities up to the configured hierarchy depth
 * Compositions are auto-tracked when the parent is tracked and field is not set to @changelog: false, and target has at least one @changelog element (or the field has an explicit @changelog)
 */
function _discoverCompositionTargets(model, result, processed) {
	const maxDepth = cds.env.requires?.['change-tracking']?.maxDisplayHierarchyDepth ?? 3;
	let currentEntities = [...result];

	for (let depth = 1; depth < maxDepth; depth++) {
		const newEntities = [];

		for (const { dbEntityName, mergedAnnotations } of currentEntities) {
			const dbEntity = model[dbEntityName];
			if (!dbEntity) continue;

			for (const element of Object.values(dbEntity.elements)) {
				if (element.type !== 'cds.Composition' || !element.target) continue;
				if (processed.has(element.target)) continue;

				const changelogAnnotation = mergedAnnotations?.elementAnnotations?.[element.name] ?? element['@changelog'];
				if (changelogAnnotation === false) continue;

				const targetEntity = model[element.target];
				if (!targetEntity) continue;
				if (!changelogAnnotation && !_hasTrackedElements(targetEntity)) continue;

				const entry = { dbEntityName: element.target, mergedAnnotations: null };
				result.push(entry);
				processed.add(element.target);
				newEntities.push(entry);
				DEBUG?.(`Including composition target ${element.target} for ${changelogAnnotation ? 'tracked' : 'auto-tracked'} composition ${element.name} on ${dbEntityName} (depth ${depth})`);
			}
		}

		if (newEntities.length === 0) break;
		currentEntities = newEntities;
	}
}

function getEntitiesForTriggerGeneration(model, collected) {
	const result = [];
	const processed = new Set();

	_collectServiceEntities(model, collected, result, processed);
	_collectStandaloneEntities(model, result, processed);
	_discoverCompositionTargets(model, result, processed);

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

function getBaseElement(element, entity, model) {
	const cqn = entity.projection ?? entity.query?.SELECT;
	if (!cqn) return null;
	element = cqn.columns?.find((c) => c.as === element && c.ref)?.ref?.[0] ?? element;

	const baseRef = cqn.from?.ref?.[0];
	if (!baseRef || !model) return null;

	const baseEntity = model.definitions[baseRef];
	if (!baseEntity) return null;
	const baseCQN = baseEntity.projection ?? baseEntity.query?.SELECT ?? baseEntity.query?.SET;
	// If base entity is also a projection, recurse
	if (baseCQN) {
		return getBaseElement(element, baseEntity, model);
	} else {
		return { baseRef, baseElement: element };
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
	const maxDepth = cds.env.requires?.['change-tracking']?.maxDisplayHierarchyDepth ?? 3;
	for (const [childName, parentInfo] of childParentMap) {
		const { parent: parentName, compositionField } = parentInfo;

		// Only include grandparent info if maxDisplayHierarchyDepth allows it (depth > 2 needed for grandparent)
		const grandParentInfo = maxDepth > 2 ? childParentMap.get(parentName) : null;

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
	collectEntities,
	getBaseElement
};
