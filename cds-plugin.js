const cds = require('@sap/cds')

const isChangeTracked = (entity) => (
  (entity['@changelog']
  || entity.elements && Object.values(entity.elements).some(e => e['@changelog'])) && entity.query?.SET?.op !== 'union'
)

// Add the appropriate Side Effects attribute to the custom action
const addSideEffects = (actions, flag, element) => {
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
    csn.definitions[entity.name]['change-tracking-isRootEntity'] = val;
  }
}

function checkAndSetRootEntity(parentEntity, entity, csn) {
  if (entity['change-tracking-isRootEntity'] === false) {
    return entity;
  }
  if (parentEntity) {
    return compositionRoot(parentEntity, csn);
  } else {
    setChangeTrackingIsRootEntity(entity, csn);
    // Update the changehistory list on the root entity when the custom action of the entity is triggered
    if (entity.actions && entity['@UI.Facets']) {
      addSideEffects(entity.actions, true);
    }
    return { ...csn.definitions?.[entity.name], name: entity.name };
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

  for (const name in elements) {
    const element = elements[name];
    const target = element.target;
    const definition = csn.definitions?.[target];
    if (
      element.type !== "cds.Composition" ||
      target === entity.name ||
      !definition ||
      definition["change-tracking-isRootEntity"] === false
    ) {
      continue;
    }
    setChangeTrackingIsRootEntity({ ...definition, name: target }, csn, false);
  }

  const isRootEntity = entity['change-tracking-isRootEntity'] !== false;
  const hasActions = !!entity.actions;

  if (isRootEntity || hasActions) {
    const parentAssociation = findParentAssociation(entity, csn, elements);
    if (parentAssociation) {
      const parentAssociationTarget = elements[parentAssociation]?.target;
      if (isRootEntity) {
        setChangeTrackingIsRootEntity(entity, csn, false);
      }
      return {
        ...csn.definitions?.[parentAssociationTarget],
        name: parentAssociationTarget
      };
    } else return;
  }
  return { ...csn.definitions?.[entity.name], name: entity.name };
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
          // When the custom action of the child entity is performed, the change history list of the parent entity is updated
          if (parentDefinition['@UI.Facets'] && isCompositionEntity) {
            addSideEffects(entity.actions, false, name);
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

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    compositionRoot({...m.definitions[name], name}, m)
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
