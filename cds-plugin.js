const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

const { fs } = cds.utils;
const { setSkipSessionVariables, resetSkipSessionVariables, getEntitySkipVarName } = require('./lib/utils/session-variables.js');
const { isRoot, hasParent } = require('./lib/utils/legacy-entity-processing.js');

let hierarchyMap = new Map();
let collectedEntities = new Map();

const isChangeTracked = (entity) => {
	if (entity.query?.SET?.op === 'union') return false; // REVISIT: should that be an error or warning?
	if (entity['@changelog']) return true;
	return Object.values(entity.elements).some((e) => e['@changelog']);
};

const analyzeCompositions = (csn) => {
	const childParentMap = new Map();

	for (const [name, def] of Object.entries(csn.definitions)) {
		if (def.kind !== 'entity') continue;

		if (def.elements) {
			for (const element of Object.values(def.elements)) {
				if (element.type === "cds.Composition" && element.target) {
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
};

// Add the appropriate Side Effects attribute to the custom action
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

function _replaceTablePlaceholders(on, tableName, hierarchy) {
	const rootEntityName = hierarchy.get(tableName) || tableName;
	return on.map(part => {
		if (part && part.val === 'ENTITY') return { ...part, val: tableName };
		if (part && part.val === 'ROOTENTITY') return { ...part, val: rootEntityName };
		return part;
	});
}

const hasFacetForComp = (comp, facets) => facets.some((f) => f.Target === `${comp.name}/@UI.LineItem` || (f.Facets && hasFacetForComp(comp, f.Facets)));

/**
 * Compares two @changelog annotation values for equality.
 * Handles arrays of {['=']: path} objects and boolean/null values.
 */
function _annotationsEqual(a, b) {
	// Handle null/undefined/false cases
	if (a === b) return true;
	if (a == null || b == null) return false;
	// Deep equality via structuredClone + comparison (order-safe)
	return JSON.stringify(structuredClone(a)) === JSON.stringify(structuredClone(b));
}

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

function mergeChangelogAnnotations(dbEntity, serviceEntities) {
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
					`Conflicting @changelog annotations on entity '${dbEntity.name}': ` +
					`'${mergedEntityAnnotationSource}' has ${JSON.stringify(mergedEntityAnnotation)} but ` +
					`'${srvEntity.name}' has ${JSON.stringify(entityAnnotation)}`
				);
			}
			if (mergedEntityAnnotation === undefined) {
				mergedEntityAnnotation = entityAnnotation;
				mergedEntityAnnotationSource = srvEntity.name;
			}
		}

		// Merge element-level @changelog annotations
		for (const [srvElemName, annotation] of Object.entries(elementAnnotations)) {
			const dbElemName = _getDbElementName(srvEntity, srvElemName);

			// Skip if annotation is false/null (explicit opt-out)
			if (annotation === false || annotation === null) continue;

			const existing = mergedElementAnnotations.get(dbElemName);
			if (existing && !_annotationsEqual(existing.annotation, annotation)) {
				throw new Error(
					`Conflicting @changelog annotations on element '${dbElemName}' of entity '${dbEntity.name}': ` +
					`'${existing.sourceName}' has ${JSON.stringify(existing.annotation)} but ` +
					`'${srvEntity.name}' has ${JSON.stringify(annotation)}`
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
			const mergedAnnotations = mergeChangelogAnnotations(dbEntity, serviceEntities);
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

// Helper to get the base entity for projections (handles nested projections recursively)
function getBaseEntity(entity, model) {
	const baseRef = entity.projection?.from?.ref?.[0]
	if (!baseRef || !model) return null

	const baseEntity = model.definitions[baseRef]
	if (!baseEntity) return null

	// If base entity is also a projection, recurse
	if (baseEntity.projection?.from?.ref) {
		return getBaseEntity(baseEntity, model)
	}

	return { baseRef, baseEntity }
}

// Unfold @changelog annotations in loaded model
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

	//processEntities(m); // REVISIT: why is that required ?!?
	hierarchyMap = analyzeCompositions(m);
	collectedEntities = new Map();

	for (let name in m.definitions) {
		const entity = m.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
		if (isServiceEntity && isChangeTracked(entity)) {
			// Collect change-tracked service entity name with its underlying DB entity name
			const { baseRef: dbEntityName, baseEntity: dbEntity } = getBaseEntity(entity, m);
			if (!dbEntity) continue;

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

		const serviceEntityIsChangeTracked = isChangeTracked(req.target);

		// Check if this service entity should be skipped automatically
		// (DB entity has triggers from other service entities, but this one didn't opt-in)
		if (!serviceEntityIsChangeTracked && shouldSkipServiceEntity(req.target)) {
			// Set skip variable for the DB entity since this service entity didn't opt-in
			const dbEntity = cds.db?.resolve?.table(req.target);
			if (dbEntity) {
				const varName = getEntitySkipVarName(dbEntity.name);
				DEBUG(`Auto-skip: Service entity ${req.target.name} didn't opt-in, skipping DB entity ${dbEntity.name}`);
				req._tx.set({ [varName]: 'true' });
				req._ctAutoSkipEntity = dbEntity.name;
			}
			return;
		}

		// Only proceed with explicit skip handling if service entity is change-tracked
		if (!serviceEntityIsChangeTracked) return;

		setSkipSessionVariables(req, srv);
	});

	cds.db.after(['INSERT', 'UPDATE', 'DELETE'], async (_, req) => {
		if (!req.target || req.target?.name.endsWith('.drafts')) return;

		// Reset auto-skip variable if it was set
		if (req._ctAutoSkipEntity) {
			req._tx.set({ [getEntitySkipVarName(req._ctAutoSkipEntity)]: 'false' });
			delete req._ctAutoSkipEntity;
			return;
		}

		if (!isChangeTracked(req.target)) return;
		resetSkipSessionVariables(req);
	});
})

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

const _sql_original = cds.compile.to.sql
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
}
Object.assign(cds.compile.to.sql, _sql_original)

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


function getLabelTranslations(entities, model) {
	// Get translations for entity and attribute labels
	const allLabels = cds.i18n.labels.translations4('all');

	// Get translations for modification texts
	const bundle = cds.i18n.bundle4({ folders: [cds.utils.path.join(__dirname, '_i18n')] });
	const modificationLabels = bundle.translations4('all');

	// REVISIT: Map is needed to ensure uniqueness (elements can include associations + association_foreignKey)
	const rows = new Map();

	const addRow = (ID, locale, text) => {
		const compositeKey = `${ID}::${locale}`;
		rows.set(compositeKey, { ID, locale, text });
	};

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = model[dbEntityName];

		// Entity labels
		const entityLabelKey = cds.i18n.labels.key4(entity);
		if (entityLabelKey && entityLabelKey !== entity.name) {
			for (const [locale, localeTranslations] of Object.entries(allLabels)) {
				if (!locale) continue;
				const text = localeTranslations[entityLabelKey] || entityLabelKey;
				addRow(entity.name, locale, text);
			}
		}

		// Attribute labels
		for (const element of entity.elements) {
			// Use merged annotation if available, otherwise use element's own annotation
			const changelogAnnotation = mergedAnnotations?.elementAnnotations?.[element.name] ?? element['@changelog'];
			if (!changelogAnnotation) continue;
			if (element._foreignKey4) continue; // REVISIT: skip foreign keys
			const attrKey = cds.i18n.labels.key4(element);
			if (attrKey && attrKey !== element.name) {
				for (const [locale, localeTranslations] of Object.entries(allLabels)) {
					if (!locale) continue;
					const text = localeTranslations[attrKey] || attrKey;
					addRow(element.name, locale, text);
				}
			}
		}
	}

	// Modification labels
	const MODIF_I18N_MAP = {
		create: 'Changes.modification.create',
		update: 'Changes.modification.update',
		delete: 'Changes.modification.delete'
	};

	for (const [locale, localeTranslations] of Object.entries(modificationLabels)) {
		if (!locale) continue;
		for (const [key, i18nKey] of Object.entries(MODIF_I18N_MAP)) {
			const text = localeTranslations[i18nKey] || key;
			addRow(key, locale, text);
		}
	}

	return Array.from(rows.values());
}



function shouldSkipServiceEntity(serviceEntity) {
	const dbEntityName = cds.db.resolve.table(serviceEntity)?.name;
	const srvEntities = collectedEntities.get(dbEntityName);
	if (!srvEntities) return false; // No triggers for this DB entity, nothing to skip

	// If this service entity is NOT collected (didn't opt-in), skip it
	const isCollected = srvEntities.includes(serviceEntity.name);
	return !isCollected;
}