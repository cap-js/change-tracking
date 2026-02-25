const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

const { fs } = cds.utils;

const { isChangeTracked, getEntitiesForTriggerGeneration, getBaseEntity, analyzeCompositions } = require('./lib/utils/entity-collector.js');
const { setSkipSessionVariables, resetSkipSessionVariables, resetAutoSkipForServiceEntity } = require('./lib/utils/session-variables.js');
const { getLabelTranslations } = require('./lib/localization.js');

let hierarchyMap = new Map();
let collectedEntities = new Map();

/**
 * Add side effects annotations for actions to refresh the changes association.
 */
function addSideEffects(actions, entityName, hierarchyMap, model) {
	const isRootEntity = !hierarchyMap.has(entityName);

	// If not a root entity, find the parent association name
	let parentAssociationName = null;
	if (!isRootEntity) {
		const parentEntityName = hierarchyMap.get(entityName);
		const parentEntity = model.definitions[parentEntityName];
		if (parentEntity?.elements) {
			// Find the composition element in the parent that points to this entity
			for (const [elemName, elem] of Object.entries(parentEntity.elements)) {
				if (elem.type === 'cds.Composition' && elem.target === entityName) {
					parentAssociationName = elemName;
					break;
				}
			}
		}
	}

	for (const se of Object.values(actions)) {
		const target = isRootEntity ? 'TargetProperties' : 'TargetEntities';
		const sideEffectAttr = se[`@Common.SideEffects.${target}`];
		const property = isRootEntity ? 'changes' : { '=': `${parentAssociationName}.changes` };
		if (sideEffectAttr?.length >= 0) {
			sideEffectAttr.findIndex((item) => (item['='] ? item['='] : item) === (property['='] ? property['='] : property)) === -1 && sideEffectAttr.push(property);
		} else {
			se[`@Common.SideEffects.${target}`] = [property];
		}
	}
}

/**
 * Returns a CQN expression for the composite key of an entity.
 * Used for the ON condition when associating changes.
 */
function entityKey4(entity) {
	const xpr = [];
	for (const k in entity.elements) {
		const e = entity.elements[k];
		if (!e.key) continue;
		if (xpr.length) {
			xpr.push('||');
			xpr.push({ val: '||' });
			xpr.push('||');
		}
		if (e.type === 'cds.Association') {
			xpr.push({ ref: [k, e.keys?.[0]?.ref?.[0]] });
		} else {
			xpr.push({ ref: [k] });
		}
	}
	return xpr;
}

/**
 * Replace ENTITY and ROOTENTITY placeholders in ON conditions.
 */
function _replaceTablePlaceholders(on, tableName, hierarchy) {
	const rootEntityName = hierarchy.get(tableName) || tableName;
	return on.map(part => {
		if (part?.val === 'ENTITY') return { ...part, val: tableName };
		if (part?.val === 'ROOTENTITY') return { ...part, val: rootEntityName };
		return part;
	});
}

/**
 * Check if a facet already exists for the changes composition.
 */
function hasFacetForComp(comp, facets) {
	return facets.some(f =>
		f.Target === `${comp.name}/@UI.LineItem` ||
		(f.Facets && hasFacetForComp(comp, f.Facets))
	);
}

function prepareCSNForTriggers(csn, preserveSources = false) {
	const clonedCSN = structuredClone(csn);
	if (preserveSources) clonedCSN.$sources = csn.$sources;
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	if (preserveSources) runtimeCSN.$sources = csn.$sources;
	const hierarchy = analyzeCompositions(runtimeCSN);
	const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);
	return { runtimeCSN, hierarchy, entities };
}

// Generate triggers for all collected entities using the provided generator function
function generateTriggersForEntities(runtimeCSN, hierarchy, entities, generator) {
	const triggers = [];
	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = runtimeCSN.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hierarchy.get(dbEntityName);
		const rootEntity = rootEntityName ? runtimeCSN.definitions[rootEntityName] : null;
		const rootMergedAnnotations = rootEntityName
			? entities.find(d => d.dbEntityName === rootEntityName)?.mergedAnnotations
			: null;
		const result = generator(runtimeCSN, entity, rootEntity, mergedAnnotations, rootMergedAnnotations);
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
	const rows = labels.map(row => `${row.ID};${row.locale};${row.text}`);
	const content = [header, ...rows].join('\n') + '\n';
	fs.writeFileSync('db/data/sap.changelog-i18nKeys.csv', content);
}

function enhanceModel(m) {
	if (m.meta?.flavor !== 'inferred') {
		// In MTX scenarios with extensibility the runtime model for deployed apps is not
		// inferred but xtended and the logic requires inferred.
		DEBUG?.(`Skipping model enhancement because model flavour is '${m.meta?.flavor}' and not 'inferred'`);
		return;
	}
	const _enhanced = 'sap.changelog.enhanced';
	if (m.meta?.[_enhanced]) return; // already enhanced

	// Get definitions from Dummy entity in our models
	const { 'sap.changelog.aspect': aspect } = m.definitions;
	if (!aspect) return; // some other model
	const { '@UI.Facets': [facet], elements: { changes } } = aspect;

	hierarchyMap = analyzeCompositions(m);
	collectedEntities = new Map();

	for (let name in m.definitions) {
		const entity = m.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
		if (isServiceEntity && isChangeTracked(entity)) {
			// Collect change-tracked service entity name with its underlying DB entity name
			const baseInfo = getBaseEntity(entity, m);
			if (!baseInfo) continue;
			const { baseRef: dbEntityName, baseEntity: dbEntity } = baseInfo;

			if (!collectedEntities.has(dbEntityName)) collectedEntities.set(dbEntityName, []);
			collectedEntities.get(dbEntityName).push(name);

			if (!entity['@changelog.disable_assoc']) {
				// Add association to ChangeView
				const keys = entityKey4(entity);
				if (!keys.length) continue; // skip if no key attribute is defined

				const onCondition = changes.on.flatMap((p) => (p?.ref && p.ref[0] === 'ID' ? keys : [p]));
				const tableName = entity.projection?.from?.ref[0];
				const on = _replaceTablePlaceholders(onCondition, tableName, hierarchyMap);
				const assoc = new cds.builtin.classes.Association({ ...changes, on });

				DEBUG?.(
					`\n
          extend ${name} with {
            changes : Association to many ${assoc.target} on ${assoc.on.map((x) => x.ref?.join('.') || x.val || x).join(' ')};
          }
        `.replace(/ {8}/g, '')
				);

				const query = entity.projection || entity.query?.SELECT;
				if (query) {
					(query.columns ??= ['*']).push({ as: 'changes', cast: assoc });
				} else if (entity.elements) {
					entity.elements.changes = assoc;
				}

				if (entity['@changelog.disable_facet'] !== undefined) {
					LOG.warn(
						`@changelog.disable_facet is deprecated! You can just define your own Facet for the changes association or annotate the changes association on ${entity.name} with not readable via @Capabilities.NavigationRestrictions.RestrictedProperties`
					);
				}

				let facets = entity['@UI.Facets'];

				if (!facets) {
					DEBUG?.(`${entity.name} does not have a @UI.Facets annotation and thus the change tracking section is not added.`);
				}
				// Add UI.Facet for Change History List
				if (
					facets &&
					!entity['@changelog.disable_facet'] &&
					!hasFacetForComp(changes, entity['@UI.Facets']) &&
					!entity['@Capabilities.NavigationRestrictions.RestrictedProperties']?.some((restriction) => restriction.NavigationProperty?.['='] === 'changes' && restriction.ReadRestrictions?.Readable === false)
				) {
					facets.push(facet);
				}
			}

			if (entity.actions) {
				const baseInfo = getBaseEntity(entity, m);
				if (baseInfo) {
					const { baseRef: dbEntityName } = baseInfo;
					addSideEffects(entity.actions, dbEntityName, hierarchyMap, m);
				}
			}
		}
	}
	(m.meta ??= {})[_enhanced] = true;
}

cds.on('loaded', enhanceModel);

cds.on('listening', () => {
	cds.db.before(['INSERT', 'UPDATE', 'DELETE'], async (req) => {
		if (!req.target || req.target.name.endsWith('.drafts')) return;
		const srv = req.target._service;
		if (!srv) return;
		setSkipSessionVariables(req, srv, collectedEntities);
	});

	cds.db.after(['INSERT', 'UPDATE', 'DELETE'], async (_, req) => {
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
});

cds.once('served', async () => {
	const kind = cds.env.requires?.db?.kind;
	if (kind !== 'sqlite') return;

	const { generateSQLiteTriggers } = require('./lib/trigger/sqlite.js');
	const entities = getEntitiesForTriggerGeneration(cds.model.definitions, collectedEntities);

	const triggers = generateTriggersForEntities(
		cds.model,
		hierarchyMap,
		entities,
		(_, entity, rootEntity, mergedAnnotations, rootMergedAnnotations) =>
			generateSQLiteTriggers(entity, rootEntity, mergedAnnotations, rootMergedAnnotations)
	);

	const labels = getLabelTranslations(entities, cds.model);
	const { i18nKeys } = cds.entities('sap.changelog');

	await Promise.all([
		...triggers.map(t => cds.db.run(t)),
		cds.delete(i18nKeys),
		cds.insert(labels).into(i18nKeys)
	]);
});

/**
 * H2 Database Triggers via compile.to.sql
 */
const _sql_original = cds.compile.to.sql;
cds.compile.to.sql = function (csn, options) {
	let ret = _sql_original.call(this, csn, options);
	if (options?.to !== 'h2') return ret;

	const { generateH2Trigger } = require('./lib/trigger/h2.js');
	const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);

	const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateH2Trigger);

	if (triggers.length > 0) {
		writeLabelsCSV(entities, runtimeCSN);
	}

	// Add semicolon at the end of each DDL statement if not already present
	ret = ret.map(s => s.endsWith(';') ? s : s + ';');
	return [...ret, ...triggers];
};
Object.assign(cds.compile.to.sql, _sql_original);

/**
 * PostgreSQL Triggers via compile.to.dbx
 */
cds.on('compile.to.dbx', (csn, options, next) => {
	const ddl = next();
	if (options?.dialect !== 'postgres') return ddl;

	const { generatePostgresTriggers } = require('./lib/trigger/postgres.js');
	const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn);

	const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generatePostgresTriggers);

	if (triggers.length === 0) return ddl;

	// Handle standard compilation (array) or delta compilation (object with createsAndAlters/drops)
	if (Array.isArray(ddl)) {
		return [...ddl, ...triggers];
	} else if (ddl.createsAndAlters) {
		ddl.createsAndAlters.push(...triggers);
		return ddl;
	}

	return ddl;
});

/**
 * HANA HDI Triggers via compiler.to.hdi.migration
 */
const _hdi_migration = cds.compiler.to.hdi.migration;
cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
	const { generateHANATriggers } = require('./lib/trigger/hdi.js');
	const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);

	const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateHANATriggers);

	if (triggers.length > 0) {
		writeLabelsCSV(entities, runtimeCSN);
	}

	const ret = _hdi_migration(csn, options, beforeImage);
	ret.definitions = [...ret.definitions, ...triggers];
	return ret;
};
