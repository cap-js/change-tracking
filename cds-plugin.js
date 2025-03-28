const cds = require('@sap/cds')

const isRoot = 'change-tracking-isRootEntity'
const hasParent = 'change-tracking-parentEntity'

const isChangeTracked = (entity) => (
  (entity['@changelog']
  || entity.elements && Object.values(entity.elements).some(e => e['@changelog'])) && entity.query?.SET?.op !== 'union'
)

// Add the appropriate Side Effects attribute to the custom action
const addSideEffects = (actions, flag, element) => {
  if (!flag && (element === undefined || element === null)) {
    return
  }

  for (const se of Object.values(actions)) {
    const target = flag ? 'TargetProperties' : 'TargetEntities'
    const sideEffectAttr = se[`@Common.SideEffects.${target}`]
    const property = flag ? 'changes' : { '=': `${element}.changes` }
    if (sideEffectAttr?.length >= 0) {
      sideEffectAttr.findIndex(
        (item) =>
          (item['='] ? item['='] : item) ===
          (property['='] ? property['='] : property)
      ) === -1 && sideEffectAttr.push(property)
    } else {
      se[`@Common.SideEffects.${target}`] = [property]
    }
  }
}

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
    compositionRoot({...m.definitions[name], name}, m)
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
    if (
      element.type !== 'cds.Composition' ||
      target === entity.name ||
      !definition ||
      definition[isRoot] === false
    ) {
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

// Unfold @changelog annotations in loaded model
cds.on('loaded', m => {

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: { changes } } = aspect
  changes.on.pop() // remove ID -> filled in below
  
  // Process entities to define the relation
  processEntities(m)

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    if (isChangeTracked(entity)) {

      // Determine entity keys
      const keys = [], { elements: elms } = entity
      for (let e in elms) if (elms[e].key) keys.push(e)

      // If no key attribute is defined for the entity, the logic to add association to ChangeView should be skipped.
      if(keys.length === 0) {
        continue;
      }

      // Add association to ChangeView...
      const on = [...changes.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({
        ref: k === 'up_' ? [k,'ID'] : [k] // REVISIT: up_ handling is a dirty hack for now
      })})
      const assoc = { ...changes, on }
      const query = entity.projection || entity.query?.SELECT
      if(!entity['@changelog.disable_assoc'])
      {
      if (query) {
        (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
      } else {
        entity.elements.changes = assoc
      }

      // Add UI.Facet for Change History List
      if(!entity['@changelog.disable_facet'])
        entity['@UI.Facets']?.push(facet)
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
})

// Add generic change tracking handlers
cds.on('served', () => {
  const { track_changes, _afterReadChangeView } = require("./lib/change-log")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      let any = false
      for (const entity of Object.values(srv.entities)) {
        if (isChangeTracked(entity)) {
          cds.db.before("CREATE", entity, track_changes)
          cds.db.before("UPDATE", entity, track_changes)
          cds.db.before("DELETE", entity, track_changes)
          any = true
        }
      }
      if (any && srv.entities.ChangeView) {
        srv.after("READ", srv.entities.ChangeView, _afterReadChangeView)
      }
    }
  }
})
