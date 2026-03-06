const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');

const { fs } = cds.utils;

const { getEntitiesForTriggerGeneration, analyzeCompositions, collectEntities } = require('../utils/entity-collector.js');
const { getLabelTranslations } = require('../localization.js');

/**
 * Prepare CSN for trigger generation by cloning, compiling for Node.js,
 * and analyzing compositions.
 */
function prepareCSNForTriggers(csn, preserveSources = false) {
	const clonedCSN = structuredClone(csn);
	if (preserveSources) clonedCSN.$sources = csn.$sources;
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	if (preserveSources) runtimeCSN.$sources = csn.$sources;
	const { collectedEntities } = collectEntities(runtimeCSN);
	const hierarchy = analyzeCompositions(runtimeCSN);
	const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);
	return { runtimeCSN, hierarchy, entities };
}

/**
 * Generate triggers for all collected entities using the provided generator function.
 */
function generateTriggersForEntities(runtimeCSN, hierarchy, entities, generator) {
	const triggers = [];
	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = runtimeCSN.definitions[dbEntityName];
		if (!entity) continue;

		const hierarchyInfo = hierarchy.get(dbEntityName);
		const rootEntityName = hierarchyInfo?.parent ?? null;
		const rootEntity = rootEntityName ? runtimeCSN.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName ? entities.find((d) => d.dbEntityName === rootEntityName)?.mergedAnnotations : null;

		// Get grandparent info for deep linking
		const grandParentEntityName = hierarchyInfo?.grandParent ?? null;
		const grandParentEntity = grandParentEntityName ? runtimeCSN.definitions[grandParentEntityName] : null;
		const grandParentMergedAnnotations = grandParentEntityName ? entities.find((d) => d.dbEntityName === grandParentEntityName)?.mergedAnnotations : null;
		const grandParentCompositionField = hierarchyInfo?.grandParentCompositionField ?? null;

		const result = generator(runtimeCSN, entity, rootEntity, mergedAnnotations, rootMergedAnnotations, {
			grandParentEntity,
			grandParentMergedAnnotations,
			grandParentCompositionField
		});
		if (result) triggers.push(...(Array.isArray(result) ? result : [result]));
	}
	return triggers;
}

/**
 * Write i18n labels CSV file for H2/HDI deployments.
 */
function writeLabelsCSV(entities, model) {
	const labels = getLabelTranslations(entities, model);
	const header = 'ID;locale;text';
	const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
	const content = [header, ...rows].join('\n') + '\n';
	const dir = 'db/src/gen/data/';
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(`${dir}/sap.changelog-i18nKeys.csv`, content);
}

/**
 * Ensures the undeploy.json file contains the hdbtrigger pattern.
 */
function ensureUndeployJsonHasTriggerPattern() {
	const undeployPath = 'db/undeploy.json';
	const triggerPattern = 'src/gen/**/*.hdbtrigger';

	let undeploy = [];
	if (fs.existsSync(undeployPath)) {
		undeploy = JSON.parse(fs.readFileSync(undeployPath, 'utf8'));
	}
	if (!Array.isArray(undeploy)) return;

	if (!undeploy.includes(triggerPattern)) {
		undeploy.push(triggerPattern);
		fs.writeFileSync(undeployPath, JSON.stringify(undeploy, null, 4) + '\n');
		LOG.info(`Added '${triggerPattern}' to ${undeployPath}`);
	}
}

module.exports = {
	prepareCSNForTriggers,
	generateTriggersForEntities,
	writeLabelsCSV,
	ensureUndeployJsonHasTriggerPattern
};
