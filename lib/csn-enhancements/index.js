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
  const _enhanced = 'sap.changelog.enhanced';
  if (m.meta?.[_enhanced]) return; // already enhanced

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions;
  if (!aspect) return; // some other model
  const {
    elements: { changes }
  } = aspect;

  // For xtended models, compile to inferred to get .elements on projections.
  // All work is done on inferredCSN; mutations are copied back to m at the end.
  const inferredCSN =
    m.meta?.flavor === 'xtended'
      ? cds.compile({ 'csn.csn': JSON.stringify(m) })
      : m;

  const hierarchyMap = analyzeCompositions(inferredCSN);
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
    const changeView = inferredCSN.definitions['sap.changelog.ChangeView'];
    const parents = [];
    for (let i = 1; i < depth; i++) {
      parents.push('parent');
      const aliasKey = parents.join('_') + '_' + 'entityKey';
      const aliasEntity = parents.join('_') + '_' + 'entity';
      const cols = changeView.query.SELECT.columns;
      if (!cols.some((c) => c?.as === aliasKey)) {
        cols.push({
          ref: ['change', ...parents, 'entityKey'],
          as: aliasKey
        });
      }
      if (!cols.some((c) => c?.as === aliasEntity)) {
        cols.push({
          ref: ['change', ...parents, 'entity'],
          as: aliasEntity
        });
      }
      if (changeView.elements) {
        changeView.elements[aliasKey] ??= structuredClone(changeView.elements.entityKey);
        changeView.elements[aliasEntity] ??= structuredClone(changeView.elements.entity);
      }
    }
    enhanceChangeViewWithTimeZones(changeView, inferredCSN);
  }
  for (let name in inferredCSN.definitions) {
    const entity = inferredCSN.definitions[name];
    const isServiceEntity = entity.kind === 'entity' && !!(entity.query || entity.projection);
    const serviceName = getService(name, inferredCSN);
    if (isServiceEntity && isChangeTracked(entity, inferredCSN) && serviceName) {
      // Collect change-tracked service entity name with its underlying DB entity name
      const baseInfo = getBaseEntity(entity, inferredCSN);
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
        const keys = entityKey4(entity, inferredCSN);
        if (!keys.length) continue; // skip if no key attribute is defined

        const onCondition = changes.on.flatMap((p) => (p?.ref && p.ref[0] === 'ID' ? keys : [p]));
        const tableName = (entity.projection ?? entity.query?.SELECT)?.from?.ref?.[0];
        const onTemplate = _replaceTablePlaceholders(onCondition, tableName);
        const on = cds.env.requires['change-tracking'].maxDisplayHierarchyDepth > 1 ? [{ xpr: structuredClone(onTemplate) }] : onTemplate;
        for (let i = 1; i < cds.env.requires['change-tracking'].maxDisplayHierarchyDepth; i++) {
          on.push('or', { xpr: replaceReferences(structuredClone(onTemplate), i) });
        }
        const assoc = new cds.builtin.classes.Association({ ...changes, on });
        assoc.target = `${serviceName}.ChangeView`;
        if (!inferredCSN.definitions[`${serviceName}.ChangeView`]) {
          const srvChangeView = structuredClone(inferredCSN.definitions['sap.changelog.ChangeView']);
          srvChangeView.query = {
            SELECT: {
              from: {
                ref: ['sap.changelog.ChangeView']
              },
              columns: ['*']
            }
          };
          inferredCSN.definitions[`${serviceName}.ChangeView`] = srvChangeView;
          for (const ele in srvChangeView.elements) {
            if (srvChangeView.elements[ele]?.target && !srvChangeView.elements[ele]?.target.startsWith(serviceName)) {
              const target = srvChangeView.elements[ele]?.target;
              const serviceEntity = Object.keys(inferredCSN.definitions)
                .filter((e) => e.startsWith(serviceName))
                .find((e) => {
                  let baseE = e;
                  while (baseE) {
                    if (baseE === target) {
                      return true;
                    }
                    const artefact = inferredCSN.definitions[baseE];
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
                srvChangeView.elements[ele].target = serviceEntity;
              }
            }
          }
          enhanceChangeViewWithLocalization(serviceName, `${serviceName}.ChangeView`, inferredCSN);
          inferredCSN.definitions[`${serviceName}.ChangeView`]['@Capabilities.ReadRestrictions.Readable'] = false;
        } else {
          enhanceChangeViewWithLocalization(serviceName, `${serviceName}.ChangeView`, inferredCSN);
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
          (query.columns ??= ['*']);
          if (!query.columns.some((c) => c?.as === 'changes')) {
            query.columns.push({ as: 'changes', cast: assoc });
          }
          entity.elements.changes = assoc;
          entity['@Capabilities.NavigationRestrictions.RestrictedProperties'] ??= [];
          const alreadyRestricted = entity['@Capabilities.NavigationRestrictions.RestrictedProperties'].some((p) => p.NavigationProperty?.['='] === 'changes');
          if (!alreadyRestricted) {
            entity['@Capabilities.NavigationRestrictions.RestrictedProperties'].push({
              NavigationProperty: { '=': 'changes' },
              ReadRestrictions: {
                Readable: true
              }
            });
          }
        }
        addUIFacet(entity, inferredCSN);
      }

      if (entity.actions) {
        addSideEffects(entity.actions, dbEntityName, hierarchyMap, inferredCSN);
      }
    }
  }

  // Copy mutations from inferredCSN back to the original model
  if (inferredCSN !== m) {
    for (const name of Object.keys(inferredCSN.definitions)) {
      const artefact = inferredCSN.definitions[name];
      if (!m.definitions[name] && name.endsWith('.ChangeView')) {
        m.definitions[name] = artefact;
      } else if (m.definitions[name]){
        // append 'changes' column to query/projection columns
        const inferredQuery = artefact.projection ?? artefact.query?.SELECT;
        const mQuery = m.definitions[name].projection ?? m.definitions[name].query?.SELECT;
        if (inferredQuery?.columns && mQuery) {
          const changesCol = inferredQuery.columns.find((c) => c.as === 'changes');
          if (changesCol && !mQuery.columns?.some((c) => c.as === 'changes')) {
            (mQuery.columns ??= ['*']).push(changesCol);
          }
        }
        // copy added annotations
        for (const key of Object.keys(artefact)) {
          if (key.startsWith('@') && m.definitions[name]?.[key] === undefined) {
            m.definitions[name][key] = artefact[key];
          }
        }
      }
    }
    // Append parent_entityKey/parent_entity columns to ChangeView (if added)
    if (m.definitions['sap.changelog.ChangeView'] && inferredCSN.definitions['sap.changelog.ChangeView']) {
      const mColumns = m.definitions['sap.changelog.ChangeView'].query?.SELECT?.columns;
      const inferredColumns = inferredCSN.definitions['sap.changelog.ChangeView'].query?.SELECT?.columns;
      if (mColumns && inferredColumns) {
        for (const col of inferredColumns) {
          if (col.as && col.as.startsWith('parent_') && !mColumns.some((c) => c.as === col.as)) {
            mColumns.push(col);
          }
        }
      }
    }
  }

  (m.meta ??= {})[_enhanced] = true;
}

module.exports = { enhanceModel };
