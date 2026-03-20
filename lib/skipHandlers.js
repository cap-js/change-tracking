const cds = require('@sap/cds');

const { isChangeTracked, collectEntities } = require('./utils/entity-collector.js');
const { setSkipSessionVariables, resetSkipSessionVariables, resetAutoSkipForServiceEntity } = require('./utils/session-variables.js');

/**
 * Register db handlers for setting/resetting session variables on INSERT/UPDATE/DELETE.
 */
function registerSessionVariableHandlers() {
	cds.db?.before(['INSERT', 'UPDATE', 'DELETE'], async (req) => {
		const model = cds.context?.model ?? cds.model;
		const collectedEntities = model.collectEntities || (model.collectEntities = collectEntities(model).collectedEntities);
		if (!req.target || req.target.name.endsWith('.drafts')) return;
		const srv = req.target._service;
		if (!srv) return;
		setSkipSessionVariables(req, srv, collectedEntities);
	});

	cds.db?.after(['INSERT', 'UPDATE', 'DELETE'], async (_, req) => {
		if (!req.target || req.target.name.endsWith('.drafts')) return;

		// Reset auto-skip variable if it was set
		if (req._ctAutoSkipEntity) {
			resetAutoSkipForServiceEntity(req, req._ctAutoSkipEntity);
			delete req._ctAutoSkipEntity;
			return;
		}

		if (!isChangeTracked(req.target)) return;
		resetSkipSessionVariables(req);
	});
}

module.exports = { registerSessionVariableHandlers };
