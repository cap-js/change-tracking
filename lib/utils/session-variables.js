const cds = require('@sap/cds');
const DEBUG = cds.debug('change-tracking');

// Session context variable names for skipping change tracking
const CT_SKIP_VAR = 'CT_SKIP_VAR';
const CT_SKIP_ENTITY_PREFIX = 'CT_SKIP_ENTITY_';

function getEntitySkipVarName(entityName) {
	return `${CT_SKIP_ENTITY_PREFIX}${entityName.replace(/\./g, '_')}`;
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

/**
 * Sets session variables to skip change tracking for a service/entities.
 * Called in the before handler for INSERT/UPDATE/DELETE.
 */
function setSkipSessionVariables(req, srv) {
	// Check if request is for a service to skip
	if (srv['@changelog'] === false || srv['@changelog'] === null) {
		DEBUG?.(`Set session variable ${CT_SKIP_VAR} for service ${srv.name} to true!`);
		req._tx.set({ [CT_SKIP_VAR]: 'true' });
		req._ctSkipWasSet = true;
	}

	const entitiesToSkip = _collectSkipEntities(req.target, req.query, srv);
	if (entitiesToSkip.length > 0) {
		const skipVars = {};
		for (const name of entitiesToSkip) {
			const varName = getEntitySkipVarName(name);
			skipVars[varName] = 'true';
			DEBUG?.(`Set session variable ${varName} for entity ${name} to true!`);
		}
		req._tx.set(skipVars);
		req._ctSkipEntities = entitiesToSkip;
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
}

// Export only what's needed by trigger modules and cds-plugin.js
module.exports = {
	CT_SKIP_VAR,
	getEntitySkipVarName,
	setSkipSessionVariables,
	resetSkipSessionVariables
};
