const cds = require('@sap/cds');
const DEBUG = cds.debug('change-tracking');

const { isChangeTracked, getBaseEntity, analyzeCompositions, getService } = require('../utils/entity-collector.js');
const { addSideEffects, addUIFacet } = require('./annotations.js');
const { enhanceChangeViewWithTimeZones } = require('./timezoneProperties.js');
const { enhanceChangeViewWithLocalization } = require('./dynamicLocalization.js');

/**
 * Returns a CQN expression for the composite key of an entity.
 * Used for the ON condition when associating changes.
 */
function entityKey4(entity, model) {
	const keys = [];
	for (const k in entity.elements) {
		const e = entity.elements[k];
		if (!e.key) continue;

		// e.type === 'cds.Association' doesn't consider custom types based on associations
		if (e.target) {
			const foreignKeyName = e.keys?.[0]?.ref?.[0];
			const targetEntity = e._target || model?.definitions?.[e.target];
			const $type = targetEntity?.elements?.[foreignKeyName]?.type;
			keys.push({ ref: [k, foreignKeyName], $type });
		} else {
			keys.push({ ref: [k], $type: e.type });
		}
	}

	const needsCast = ($type) => $type !== 'cds.String' && $type !== 'cds.UUID';
	const asStr = (key) => (needsCast(key.$type) ? { ...key, cast: { type: 'cds.String' } } : key);

	if (keys.length === 1) return keys.map(asStr);

	const xpr = [];
	for (let i = 0; i < keys.length; i++) {
		if (i > 0) {
			xpr.push('||');
			xpr.push({ val: ';' });
			xpr.push('||');
		}
		const keyRef = asStr(keys[i]);
		xpr.push({ func: 'LENGTH', args: [keyRef] });
		xpr.push('||');
		xpr.push({ val: ',' });
		xpr.push('||');
		xpr.push(keyRef);
	}
	return xpr;
}

/**
 * Replace ENTITY placeholders in ON conditions.
 */
function _replaceTablePlaceholders(on, tableName) {
	return on.map((part) => {
		if (part?.val === 'ENTITY') return { ...part, val: tableName };
		return part;
	});
}

/**
 * Enhance the CDS model with change tracking associations, facets, and side effects.
 * Returns the updated hierarchyMap and collectedEntities for use by trigger generation.
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
	const {
		elements: { changes }
	} = aspect;

	const hierarchyMap = analyzeCompositions(m);
	const collectedEntities = new Map();

	const replaceReferences = (xpr, depth) => {
		const parents = [];
		for (let i = 0; i < depth; i++) parents.push('parent');
		for (const ele of xpr) {
			if (ele.ref && ele.ref[0] === 'changes') {
				const lastEle = ele.ref.pop();
				ele.ref.push(parents.join('_') + '_' + lastEle);
			}
		}
		return xpr;
	};
	if (cds.env.requires['change-tracking'].maxDisplayHierarchyDepth > 1) {
		const depth = cds.env.requires['change-tracking'].maxDisplayHierarchyDepth;
		const parents = [];
		for (let i = 1; i < depth; i++) {
			parents.push('parent');
			m.definitions['sap.changelog.ChangeView'].query.SELECT.columns.push(
				{
					ref: ['change', ...parents, 'entityKey'],
					as: parents.join('_') + '_' + 'entityKey'
				},
				{
					ref: ['change', ...parents, 'entity'],
					as: parents.join('_') + '_' + 'entity'
				}
			);
			m.definitions['sap.changelog.ChangeView'].elements[parents.join('_') + '_' + 'entityKey'] = structuredClone(m.definitions['sap.changelog.ChangeView'].elements.entityKey);
			m.definitions['sap.changelog.ChangeView'].elements[parents.join('_') + '_' + 'entity'] = structuredClone(m.definitions['sap.changelog.ChangeView'].elements.entity);
		}
		enhanceChangeViewWithTimeZones(m.definitions['sap.changelog.ChangeView'], m);
	}
	for (let name in m.definitions) {
		const entity = m.definitions[name];
		const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
		const serviceName = getService(name, m);
		if (isServiceEntity && isChangeTracked(entity) && serviceName) {
			// Collect change-tracked service entity name with its underlying DB entity name
			const baseInfo = getBaseEntity(entity, m);
			if (!baseInfo) continue;
			const { baseRef: dbEntityName } = baseInfo;

			if (!collectedEntities.has(dbEntityName)) collectedEntities.set(dbEntityName, []);
			collectedEntities.get(dbEntityName).push(name);

			// Skip adding association to ChangeView if the entity has only association keys, as it cannot be independently identified and is likely an inline composition target
			const entityKeys = Object.values(entity.elements).filter((e) => e.key);
			const hasOnlyAssociationKeys = entityKeys.length > 0 && entityKeys.every((e) => e.type === 'cds.Association');
			if (hasOnlyAssociationKeys) {
				DEBUG?.(`Skipping changes association for ${name} - inline composition target with no independent key`);
			} else if (!entity['@changelog.disable_assoc']) {
				// Add association to ChangeView
				const keys = entityKey4(entity, m);
				if (!keys.length) continue; // skip if no key attribute is defined

				const onCondition = changes.on.flatMap((p) => (p?.ref && p.ref[0] === 'ID' ? keys : [p]));
				const tableName = (entity.projection ?? entity.query?.SELECT)?.from?.ref[0];
				const onTemplate = _replaceTablePlaceholders(onCondition, tableName);
				const on = cds.env.requires['change-tracking'].maxDisplayHierarchyDepth > 1 ? [{ xpr: structuredClone(onTemplate) }] : onTemplate;
				for (let i = 1; i < cds.env.requires['change-tracking'].maxDisplayHierarchyDepth; i++) {
					on.push('or', { xpr: replaceReferences(structuredClone(onTemplate), i) });
				}
				const assoc = new cds.builtin.classes.Association({ ...changes, on });
				assoc.target = `${serviceName}.ChangeView`;
				if (!m.definitions[`${serviceName}.ChangeView`]) {
					m.definitions[`${serviceName}.ChangeView`] = structuredClone(m.definitions['sap.changelog.ChangeView']);
					m.definitions[`${serviceName}.ChangeView`].query = {
						SELECT: {
							from: {
								ref: ['sap.changelog.ChangeView']
							},
							columns: ['*']
						}
					};

					for (const ele in m.definitions[`${serviceName}.ChangeView`].elements) {
						if (m.definitions[`${serviceName}.ChangeView`].elements[ele]?.target && !m.definitions[`${serviceName}.ChangeView`].elements[ele]?.target.startsWith(serviceName)) {
							const target = m.definitions[`${serviceName}.ChangeView`].elements[ele]?.target;
							const serviceEntity = Object.keys(m.definitions)
								.filter((e) => e.startsWith(serviceName))
								.find((e) => {
									let baseE = e;
									while (baseE) {
										if (baseE === target) {
											return true;
										}
										const artefact = m.definitions[baseE];
										const cqn = artefact.projection ?? artefact.query?.SELECT;
										if (!cqn) {
											return false;
										}
										// from.args is the case for joins //REVISIT: only works in case it is one join, multiple joins and the ref is nested in further args
										baseE = cqn.from?.ref?.[0] ?? cqn.from?.args?.[0]?.ref?.[0];
									}
									return false;
								});
							if (serviceEntity) {
								m.definitions[`${serviceName}.ChangeView`].elements[ele].target = serviceEntity;
							}
						}
					}
					enhanceChangeViewWithLocalization(serviceName, `${serviceName}.ChangeView`, m);
				}

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
					entity.elements.changes = assoc;
				}
				addUIFacet(entity, m);
			}

			if (entity.actions) {
				const { baseRef: dbEntityName } = baseInfo;
				addSideEffects(entity.actions, dbEntityName, hierarchyMap, m);
			}
		}
	}
	(m.meta ??= {})[_enhanced] = true;
}

module.exports = { enhanceModel };
