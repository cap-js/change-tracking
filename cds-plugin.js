const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

const { fs } = cds.utils;

const { isChangeTracked, getEntitiesForTriggerGeneration, getBaseEntity, analyzeCompositions } = require('./lib/utils/entity-collector.js');
const { setSkipSessionVariables, resetSkipSessionVariables, resetAutoSkipForServiceEntity } = require('./lib/utils/session-variables.js');
const { getLabelTranslations } = require('./lib/localization.js');
// REVISIT
const { isRoot, hasParent } = require('./lib/legacy/entity-processing.js');

// Global state for collected entities and hierarchy
let hierarchyMap = new Map();
let collectedEntities = new Map();

const addSideEffects = (actions, isRootEntity) => {
	for (const se of Object.values(actions)) {
		const target = isRootEntity ? 'TargetProperties' : 'TargetEntities';
		const sideEffectAttr = se[`@Common.SideEffects.${target}`];
		const property = isRootEntity ? 'changes' : { '=': `${element}.changes` };
		if (sideEffectAttr?.length >= 0) {
			sideEffectAttr.findIndex((item) => (item['='] ? item['='] : item) === (property['='] ? property['='] : property)) === -1 && sideEffectAttr.push(property);
		} else {
			se[`@Common.SideEffects.${target}`] = [property];
		}
	}
};

/**
 * Returns an expression for the key of the given entity, which we can use as the right-hand-side of an ON condition.
 */
function entityKey4(entity) {
	const xpr = [];
	for (let k in entity.elements) {
		const e = entity.elements[k];
		if (!e.key) continue;
		if (xpr.length) {
			xpr.push('||');
			xpr.push({ val: "||" });
			xpr.push('||');
		}
		if (e.type === 'cds.Association') xpr.push({ ref: [k, e.keys?.[0]?.ref?.[0]] });
		else xpr.push({ ref: [k] });
	}
	return xpr;
}

/**
 * Replace table name placeholders in ON conditions.
 */
function _replaceTablePlaceholders(on, tableName, hierarchy) {
	const rootEntityName = hierarchy.get(tableName) || tableName;
	return on.map(part => {
		if (part && part.val === 'ENTITY') return { ...part, val: tableName };
		if (part && part.val === 'ROOTENTITY') return { ...part, val: rootEntityName };
		return part;
	});
}

/**
 * Check if a facet already exists for the changes composition.
 */
const hasFacetForComp = (comp, facets) => facets.some((f) => f.Target === `${comp.name}/@UI.LineItem` || (f.Facets && hasFacetForComp(comp, f.Facets)));

// --- Model Enhancement ---

/**
 * Unfold @changelog annotations in loaded model.
 * Adds changes association and UI facets to change-tracked service entities.
 */
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
				const hasParentInfo = entity[hasParent];
				const entityName = hasParentInfo?.entityName;
				const parentEntity = entityName ? m.definitions[entityName] : null;
				const isParentRootAndHasFacets = parentEntity?.[isRoot] && parentEntity?.['@UI.Facets'];
				if (entity[isRoot] && entity['@UI.Facets']) {
					// Add side effects for root entity
					addSideEffects(entity.actions, true);
				} else if (isParentRootAndHasFacets) {
					// Add side effects for child entity
					addSideEffects(entity.actions, false, hasParentInfo?.associationName);
				}
			}
		}
	}
	(m.meta ??= {})[_enhanced] = true;
}

// Register plugin hooks
cds.on('loaded', enhanceModel);

cds.on('listening', ({ server, url }) => {

	cds.db.before(['INSERT', 'UPDATE', 'DELETE'], async (req) => {
		if (!req.target || req.target?.name.endsWith('.drafts')) return;
		const srv = req.target?._service; if (!srv) return;
		setSkipSessionVariables(req, srv, collectedEntities);
	});

	cds.db.after(['INSERT', 'UPDATE', 'DELETE'], async (_, req) => {
		if (!req.target || req.target?.name.endsWith('.drafts')) return;

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
	const isSQLite = kind === 'sqlite';
	const isPostgres = kind === 'postgres';

	if (!isSQLite && !isPostgres) return;

	const triggers = [];

	// Use collected entities with merged annotations for trigger generation
	const entities = getEntitiesForTriggerGeneration(cds.model.definitions, collectedEntities);

	for (const { dbEntityName, mergedAnnotations } of entities) {
		// Only generate triggers for SQLite in-memory (PostgreSQL triggers are deployed via compile.to.dbx)
		if (isSQLite) {
			const { generateSQLiteTriggers } = require('./lib/trigger/sqlite.js');
			const entity = cds.model.definitions[dbEntityName];
			if (!entity) continue;
			const rootEntityName = hierarchyMap.get(dbEntityName);
			const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null;
			const entityTrigger = generateSQLiteTriggers(entity, rootEntity, mergedAnnotations);
			triggers.push(...entityTrigger);
		}
	}

	const labels = getLabelTranslations(entities, cds.model.definitions);
	const { i18nKeys } = cds.entities('sap.changelog');

	await Promise.all([
		...triggers.map((t) => cds.db.run(t)),
		cds.delete(i18nKeys),
		cds.insert(labels).into(i18nKeys)
	]);
});

const _sql_original = cds.compile.to.sql;
cds.compile.to.sql = function (csn, options) {
	let ret = _sql_original.call(this, csn, options);
	const isH2 = options?.to === 'h2';
	if (!isH2) return ret;

	const triggers = [];
	const { generateH2Trigger } = require('./lib/trigger/h2.js');

	const clonedCSN = structuredClone(csn);
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	const h2HierarchyMap = analyzeCompositions(runtimeCSN);

	// Collect entities from CSN and merge annotations
	const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = runtimeCSN.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = h2HierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? runtimeCSN.definitions[rootEntityName] : null;
		const entityTrigger = generateH2Trigger(runtimeCSN, entity, rootEntity, mergedAnnotations);
		if (!entityTrigger) continue;
		triggers.push(entityTrigger);
	}

	// Add label translations if there are triggers
	if (triggers.length > 0) {
		const labels = getLabelTranslations(entities, runtimeCSN.definitions);
		const header = 'ID;locale;text';
		const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
		const content = [header, ...rows].join('\n') + '\n';
		fs.writeFileSync('db/data/sap.changelog-i18nKeys.csv', content);
	}

	// Add semicolon at the end of each DDL statement if not already present
	ret = ret.map(s => (s.endsWith(';') ? s + ';' : s));
	return [...ret, ...triggers];
};
Object.assign(cds.compile.to.sql, _sql_original);

// PostgreSQL trigger injection via compile.to.dbx event (auto-deploys triggers with cds deploy)
cds.on('compile.to.dbx', (csn, options, next) => {
	const ddl = next();
	if (options?.dialect !== 'postgres') return ddl;

	const { generatePostgresTriggers } = require('./lib/trigger/postgres.js');

	const clonedCSN = structuredClone(csn);
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	const pgHierarchyMap = analyzeCompositions(runtimeCSN);

	// Collect entities from CSN and merge annotations
	const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);

	const triggerCreates = [];
	const triggerDrops = [];

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = runtimeCSN.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = pgHierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? runtimeCSN.definitions[rootEntityName] : null;

		const { creates, drops } = generatePostgresTriggers(runtimeCSN, entity, rootEntity, mergedAnnotations);
		triggerCreates.push(...creates);
		triggerDrops.push(...drops);
	}

	if (triggerCreates.length === 0) return ddl;

	// For standard compilation (array) or delta compilation (object with createsAndAlters/drops)
	if (Array.isArray(ddl)) {
		// Standard mode: drops run first, then creates
		return [...triggerDrops, ...ddl, ...triggerCreates];
	} else if (ddl.createsAndAlters) {
		// Delta mode: separate drops and creates
		ddl.drops = [...(ddl.drops || []), ...triggerDrops];
		ddl.createsAndAlters.push(...triggerCreates);
		return ddl;
	}

	return ddl;
});

// Generate HDI artifacts for change tracking
const _hdi_migration = cds.compiler.to.hdi.migration;
cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
	const triggers = [];
	const { generateHANATriggers } = require('./lib/trigger/hdi.js');

	const clonedCSN = structuredClone(csn);
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	const hdiHierarchyMap = analyzeCompositions(runtimeCSN);

	// Collect entities from CSN and merge annotations
	const entities = getEntitiesForTriggerGeneration(runtimeCSN.definitions, collectedEntities);

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = runtimeCSN.definitions[dbEntityName];
		if (!entity) continue;
		const rootEntityName = hdiHierarchyMap.get(dbEntityName);
		const rootEntity = rootEntityName ? runtimeCSN.definitions[rootEntityName] : null;
		const entityTriggers = generateHANATriggers(runtimeCSN, entity, rootEntity, mergedAnnotations);
		triggers.push(...entityTriggers);
	}

	// Add label translations if there are triggers
	if (triggers.length > 0) {
		const labels = getLabelTranslations(entities, runtimeCSN.definitions);
		const header = 'ID;locale;text';
		const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
		const content = [header, ...rows].join('\n') + '\n';
		fs.writeFileSync('db/data/sap.changelog-i18nKeys.csv', content);
	}

	const ret = _hdi_migration(csn, options, beforeImage);
	ret.definitions = [...ret.definitions, ...triggers];
	return ret;
};
