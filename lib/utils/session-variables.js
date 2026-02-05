const cds = require('@sap/cds');
const DEBUG = cds.debug('change-tracking');

// Session context variable names for skipping change tracking
// Using 'ct.' prefix for all session variables to be PostgreSQL compatible
const CT_SKIP_VAR = 'ct.skip';
const CT_SKIP_ENTITY_PREFIX = 'ct.skip_entity.';
const CT_SKIP_ELEMENT_PREFIX = 'ct.skip_element.';

function getEntitySkipVarName(entityName) {
	return `${CT_SKIP_ENTITY_PREFIX}${entityName.replace(/\./g, '_')}`;
}

function getElementSkipVarName(entityName, elementName) {
	return `${CT_SKIP_ELEMENT_PREFIX}${entityName.replace(/\./g, '_')}.${elementName.replace(/\./g, '_')}`;
}

function _findServiceEntity(service, dbEntity) {
	if (!service || !dbEntity) return null;
	for (const def of service.entities) {
		const projectionTarget = cds.db.resolve.table(def)?.name;
		if (projectionTarget === dbEntity.name) return def;
	}
	return null;
}

function _collectDeepEntities(entity, data, service, toSkip) {
	if (!entity.compositions) return;
	for (const comp of entity.compositions) {
		const compData = data[comp.name];
		if (compData === undefined) continue;

		const targetEntity = comp._target || cds.model.definitions[comp.target];
		if (!targetEntity) continue;

		// Check annotations of target entity (on service level)
		const serviceEntity = _findServiceEntity(service, targetEntity);
		if (serviceEntity && (serviceEntity['@changelog'] === false || serviceEntity['@changelog'] === null)) {
			toSkip.add(targetEntity.name);
		}

		// Recurse for nested compositions
		_collectDeepEntities(targetEntity, compData, service, toSkip);
	}
}

function _collectSkipEntities(rootTarget, query, service) {
	const toSkip = new Set();
	const dbEntity = cds.db.resolve.table(rootTarget);

	// Check root entity annotation
	if (rootTarget['@changelog'] === false || rootTarget['@changelog'] === null) {
		toSkip.add(dbEntity.name);
	}

	// For deep operations, extract data from query and traverse compositions
	const data = query?.INSERT?.entries || query?.UPDATE?.data || query?.UPDATE?.with;
	if (!data || !dbEntity?.compositions) return toSkip;

	// Filter all compositions inside data and map on composition target
	const dataArray = Array.isArray(data) ? data : [data];
	for (const row of dataArray) {
		_collectDeepEntities(dbEntity, row, service, toSkip);
	}

	return Array.from(toSkip);
}

// Maps service element name to corresponding column name (considers renaming in projections) 
function _getDbElementName(serviceEntity, elementName) {
	const columns = serviceEntity.projection?.columns;
	if (!columns) return elementName;

	for (const col of columns) {
		// Check for a renamed column: { ref: ['title'], as: 'adminTitle' }
		if (typeof col === 'object' && col.as === elementName && col.ref?.length > 0) {
			return col.ref[0];
		}
	}
	
	return elementName;
}

function _collectSkipElements(serviceEntity, query, service) {
	const toSkip = [];
	if (!serviceEntity?.elements) return toSkip;

	const dbEntity = cds.db.resolve.table(serviceEntity);
	if (!dbEntity) return toSkip;

	for (const [elementName, element] of Object.entries(serviceEntity.elements)) {
		if (element['@changelog'] === false || element['@changelog'] === null) {
			// Get the actual column name (handles renaming in projections)
			const dbElementName = _getDbElementName(serviceEntity, elementName);

			toSkip.push({
				dbEntityName: dbEntity.name,
				dbElementName: dbElementName
			});

			DEBUG?.(`Found element to skip: ${dbEntity.name}.${dbElementName} (service element: ${elementName})`);
		}
	}

	// Handle nested compositions for deep skip elements
	const data = query?.INSERT?.entries || query?.UPDATE?.data || query?.UPDATE?.with;
	if (!data || !dbEntity?.compositions) return toSkip;

	// Filter all compositions inside data and map on composition target
	const dataArray = Array.isArray(data) ? data : [data];
	for (const row of dataArray) {
		_collectDeepSkipElements(dbEntity, row, service, toSkip);
	}

	return toSkip;
}

function _collectDeepSkipElements(entity, data, service, toSkip) {
	if (!entity.compositions) return;

	for (const comp of entity.compositions) {
		const compData = data[comp.name];
		if (compData === undefined) continue;

		const targetEntity = comp._target || cds.model.definitions[comp.target];
		if (!targetEntity) continue;

		// Find the service entity for this composition target
		const serviceEntity = _findServiceEntity(service, targetEntity);
		if (serviceEntity) {
			// Collect skip elements from this service entity
			const skipElements = _collectSkipElements(serviceEntity);
			for (const el of skipElements) {
				toSkip.push(el);
			}
		}

		// Recurse for nested compositions
		const compDataArray = Array.isArray(compData) ? compData : [compData];
		for (const row of compDataArray) {
			_collectDeepSkipElements(targetEntity, row, service, toSkip);
		}
	}
}

/**
 * Sets session variables to skip change tracking for a service/entities/elements.
 * Called in the before handler for INSERT/UPDATE/DELETE.
 */
function setSkipSessionVariables(req, srv) {
	// Check if request is for a service to skip
	if (srv['@changelog'] === false || srv['@changelog'] === null) {
		DEBUG?.(`Set skip session variable for service ${srv.name} to true!`);
		req._tx.set({ [CT_SKIP_VAR]: 'true' });
		req._ctSkipWasSet = true;
	}

	const entitiesToSkip = _collectSkipEntities(req.target, req.query, srv);
	if (entitiesToSkip.length > 0) {
		const skipVars = {};
		for (const name of entitiesToSkip) {
			const varName = getEntitySkipVarName(name);
			skipVars[varName] = 'true';
			DEBUG?.(`Set skip session variable for entity ${name} to true!`);
		}
		req._tx.set(skipVars);
		req._ctSkipEntities = entitiesToSkip;
	}

	// Collect elements to skip from the root service entity
	const elementsToSkip = _collectSkipElements(req.target, req.query, srv);
	if (elementsToSkip.length > 0) {
		const skipVars = {};
		for (const { dbEntityName, dbElementName } of elementsToSkip) {
			const varName = getElementSkipVarName(dbEntityName, dbElementName);
			skipVars[varName] = 'true';
			DEBUG?.(`Set skip session variable for element ${dbEntityName}.${dbElementName} to true!`);
		}
		req._tx.set(skipVars);
		req._ctSkipElements = elementsToSkip;
	}
}

/**
 * Resets session variables after change tracking operations.
 * Called in the after handler for INSERT/UPDATE/DELETE.
 */
function resetSkipSessionVariables(req) {
	if (req._ctSkipWasSet) {
		req._tx.set({ [CT_SKIP_VAR]: 'false' });
		delete req._ctSkipWasSet;
	}

	if (req._ctSkipEntities) {
		const resetVars = {};
		for (const name of req._ctSkipEntities) {
			resetVars[getEntitySkipVarName(name)] = 'false';
		}
		req._tx.set(resetVars);
		delete req._ctSkipEntities;
	}

	if (req._ctSkipElements) {
		const resetVars = {};
		for (const { dbEntityName, dbElementName } of req._ctSkipElements) {
			resetVars[getElementSkipVarName(dbEntityName, dbElementName)] = 'false';
		}
		req._tx.set(resetVars);
		delete req._ctSkipElements;
	}
}

// Export only what's needed by trigger modules and cds-plugin.js
module.exports = {
	CT_SKIP_VAR,
	getEntitySkipVarName,
	getElementSkipVarName,
	setSkipSessionVariables,
	resetSkipSessionVariables
};
