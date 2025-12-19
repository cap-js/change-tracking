const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

const { fs } = require('@sap/cds/lib/utils/cds-utils.js');

const isRoot = 'change-tracking-isRootEntity';
const hasParent = 'change-tracking-parentEntity';
let hierarchyMap = new Map();

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

function setChangeTrackingIsRootEntity(entity, csn, val = true) {
	if (csn.definitions?.[entity.name]) {
		csn.definitions[entity.name][isRoot] = val;
	}
}

function checkAndSetRootEntity(parentEntity, entity, csn) {
	if (entity[isRoot] === false) {
		return entity;
	}
	if (parentEntity) {
		return compositionRoot(parentEntity, csn);
	} else {
		setChangeTrackingIsRootEntity(entity, csn);
		return { ...csn.definitions?.[entity.name], name: entity.name };
	}
}

function processEntities(m) {
	for (let name in m.definitions) {
		compositionRoot({ ...m.definitions[name], name }, m);
	}
}

function compositionRoot(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const parentEntity = compositionParent(entity, csn);
	return checkAndSetRootEntity(parentEntity, entity, csn);
}

function compositionParent(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const parentAssociation = compositionParentAssociation(entity, csn);
	return parentAssociation ?? null;
}

function compositionParentAssociation(entity, csn) {
	if (!entity || entity.kind !== 'entity') {
		return;
	}
	const elements = entity.elements ?? {};

	// Add the change-tracking-isRootEntity attribute of the child entity
	processCompositionElements(entity, csn, elements);

	const hasChildFlag = entity[isRoot] !== false;
	const hasParentEntity = entity[hasParent];

	if (hasChildFlag || !hasParentEntity) {
		// Find parent association of the entity
		const parentAssociation = findParentAssociation(entity, csn, elements);
		if (parentAssociation) {
			const parentAssociationTarget = elements[parentAssociation]?.target;
			if (hasChildFlag) setChangeTrackingIsRootEntity(entity, csn, false);
			return {
				...csn.definitions?.[parentAssociationTarget],
				name: parentAssociationTarget
			};
		} else return;
	}
	return { ...csn.definitions?.[entity.name], name: entity.name };
}

function processCompositionElements(entity, csn, elements) {
	for (const name in elements) {
		const element = elements[name];
		const target = element?.target;
		const definition = csn.definitions?.[target];
		if (element.type !== 'cds.Composition' || target === entity.name || !definition || definition[isRoot] === false) {
			continue;
		}
		setChangeTrackingIsRootEntity({ ...definition, name: target }, csn, false);
	}
}

function findParentAssociation(entity, csn, elements) {
	return Object.keys(elements).find((name) => {
		const element = elements[name];
		const target = element?.target;
		if (element.type === 'cds.Association' && target !== entity.name) {
			const parentDefinition = csn.definitions?.[target] ?? {};
			const parentElements = parentDefinition?.elements ?? {};
			return !!Object.keys(parentElements).find((parentEntityName) => {
				const parentElement = parentElements?.[parentEntityName] ?? {};
				if (parentElement.type === 'cds.Composition') {
					const isCompositionEntity = parentElement.target === entity.name;
					// add parent information in the current entity
					if (isCompositionEntity) {
						csn.definitions[entity.name][hasParent] = {
							associationName: name,
							entityName: target
						};
					}
					return isCompositionEntity;
				}
			});
		}
	});
}

/**
 * Returns an expression for the key of the given entity, which we can use as the right-hand-side of an ON condition.
 */
function entityKey4(entity) {
	const xpr = [];
	for (let k in entity.elements) {
		const e = entity.elements[k];
		if (!e.key) continue;
		if (xpr.length) xpr.push('||');
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

	for (let name in m.definitions) {
		const entity = m.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && (entity.query || entity.projection);
		if (isServiceEntity && isChangeTracked(entity)) {
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

cds.once('served', async () => {
	const kind = cds.env.requires?.db?.kind
	const isInMemory = cds.env.requires?.db?.credentials?.url === ':memory:';

	const isSQLite = kind === 'sqlite' && isInMemory;
	const isPostgres = kind === 'postgres';

	// Set appropriate trigger generator based on the database kind
	let generateTriggers;
	if (isSQLite) {
		const { generateSQLiteTriggers } = require('./lib/trigger/sqlite.js');
		generateTriggers = generateSQLiteTriggers;
	} else if (isPostgres) {
		const { generatePostgresTriggers } = require('./lib/trigger/postgres.js');
		generateTriggers = generatePostgresTriggers;
	} else {
		LOG.warn(`Change tracking triggers are not supported for database kind: ${kind}`);
		return;
	}

	const triggers = [], entities = [];

	for (const def of cds.model.definitions) {
		const isTableEntity = def.kind === 'entity' && !def.query && !def.projection;
		if (!isTableEntity || !isChangeTracked(def)) continue;

		// Resolve root entity name from your hierarchyMap
		const rootEntityName = hierarchyMap.get(def.name)
		const rootEntity = rootEntityName ? cds.model.definitions[rootEntityName] : null

		const entityTrigger = generateTriggers(def, rootEntity);
		triggers.push(...entityTrigger);
		entities.push(def);
	}

	// Get all label translations
	const labels = getLabelTranslations(entities);
	const { i18nKeys } = cds.entities('sap.changelog');

	// Create the DB triggers and add label translations
	await Promise.all([
		triggers.map((t) => cds.db.run(t)),
		cds.delete(i18nKeys),
		cds.insert(labels).into(i18nKeys)
	]);
});

const _sql_original = cds.compile.to.sql
cds.compile.to.sql = function (csn, options) {
	let ret = _sql_original.call(this, csn, options);
	const isH2 = options?.to === 'h2';
	if (!isH2) return ret; // skip for sqlite and postgres which are handled in 'served' hook

	const triggers = [], entities = [];
	const { generateH2Trigger } = require('./lib/trigger/h2.js');

	const clonedCSN = structuredClone(csn);
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);
	
	for (let def of runtimeCSN.entities) {
		const isTableEntity = def.kind === 'entity' && !def.query && !def.projection;
		if (!isTableEntity || !isChangeTracked(def)) continue;
		const entityTrigger = generateH2Trigger(runtimeCSN, def);
		if (!entityTrigger) continue;
		triggers.push(entityTrigger);
		entities.push(def);
	}

	// Add label translations if there are triggers
	if (triggers.length > 0) {
		const labels = getLabelTranslations(entities);
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

// Generate HDI artifacts for change tracking
const _hdi_migration = cds.compiler.to.hdi.migration;
cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
	const triggers = [];
	const entities = [];
	const { generateHANATriggers } = require('./lib/trigger/hdi.js');

	const clonedCSN = structuredClone(csn);
	const runtimeCSN = cds.compile.for.nodejs(clonedCSN);

	for (let def of runtimeCSN.definitions) {
		const isTableEntity = def.kind === 'entity' && !def.query && !def.projection;
		if (!isTableEntity || !isChangeTracked(def)) continue;
		const entityTriggers = generateHANATriggers(runtimeCSN, def);
		triggers.push(...entityTriggers);
		entities.push(def);
	}

	// Add label translations if there are triggers
	if (triggers.length > 0) {
		const labels = getLabelTranslations(entities);
		const header = 'ID;locale;text';
		const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
		const content = [header, ...rows].join('\n') + '\n';
		fs.writeFileSync('db/data/sap.changelog-i18nKeys.csv', content);
	}

	const ret = _hdi_migration(csn, options, beforeImage);
	ret.definitions = [...ret.definitions, ...triggers];
	return ret;
};

function getLabelTranslations(entities) {
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

	for (const entity of entities) {
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
			if (!element['@changelog']) continue;
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
