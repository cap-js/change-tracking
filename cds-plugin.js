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

// const compositionParentAssociation = (entity, csn, entityName = '', facets = '') => {
//   if (!entity || entity.kind !== "entity") {
//     return;
//   }
//   let isAddedWrapper = {value: false };
//   const elements = entity.elements ? entity.elements : {};
//   const parentAssociation = Object.keys(elements).find((name) => {
//     const element = elements[name];
//     if (!isAddedWrapper.value && element.type === "cds.Association") {
//       compositionParentElements({ csn, element, entity, entityName, isAddedWrapper }, name, facets)
//     }
//   });
//   if (parentAssociation && !facets) {
//     return elements[parentAssociation];
//   }
// }

// const compositionParentElements = ({ csn, element, entity, entityName, isAddedWrapper = {} }, ele, facets) => {
//   const parentDefinition = csn.definitions?.[element?.target]?.name
//     ? csn.definitions[element.target]
//     : { ...csn.definitions?.[element?.target], name: element?.target };

//   const parentElements = parentDefinition?.elements
//     ? parentDefinition.elements
//     : {};

//   const currentEntity = entity?.name
//     ? entity
//     : { ...entity, name: entityName };
//   if (facets && parentDefinition[`${facets}`]) {
//     //ToDo: Revisit Breaklook with node.js Expert
//     breakLoop: for (const value of Object.values(parentElements)) {
//       if (value.target === currentEntity.name) {
//         addSideEffects(currentEntity.actions, false, ele)
//         isAddedWrapper.value = true;
//         break breakLoop
//       }
//     }
//   } else {
//     return !!Object.keys(parentElements).find((name) => {
//       const parentElement = parentElements[name];
//       if (parentElement.type === "cds.Composition") {
//         return parentElement.target === entity.name;
//       }
//     });
//   }
// }


// Unfold @changelog annotations in loaded model

function setRootEntityForChangeTracking(entity, csn) {
  return csn.definitions[entity.name]['change-tracking-isRootEntity'] = true;
}

function setChangeTrackingIsRootEntity(entity, csn, val = true) {
  if (csn.definitions && csn.definitions[entity.name]) {
    csn.definitions[entity.name]['change-tracking-isRootEntity'] = val;
  }
}

function checkAndSetRootEntity(parentEntity, entity, csn) {
  if (entity['change-tracking-isRootEntity'] === false) {
    return entity;
  }
  if (parentEntity) {
    if (parentEntity['change-tracking-isRootEntity'] === true) {
      return parentEntity;
    } else {
      return compositionRoot(parentEntity, csn);
    }
  } else {
    // if (entity['change-tracking-isRootEntity'] === false) {
    //   return entity;
    // }
    setChangeTrackingIsRootEntity(entity, csn);
    return {...csn.definitions[entity.name], name: entity.name}
    // return entity;
  }
}

function compositionRoot(entity, csn) {
  if (!entity || entity.kind !== "entity") {
    return;
  }
  // const compositionEntity = setRootEntityForChangeTracking(entity, csn);
  const parentEntity = compositionParent(entity, csn);
  return checkAndSetRootEntity(parentEntity, entity, csn);
  // return parentEntity ? compositionRoot(parentEntity, csn) : setChangeTrackingIsRootEntity(entity, csn);
  // return parentEntity ? compositionRoot(parentEntity, csn) : entity;
}

function compositionParent(entity, csn) {
  if (!entity || entity.kind !== "entity") {
    return;
  }
  const parentAssociation = compositionParentAssociation(entity, csn);
  
  if (parentAssociation) {
    const targetName = parentAssociation.target? parentAssociation.target : parentAssociation.name;
    return { ...csn.definitions?.[targetName], name: targetName }
  } else return null;
  // return parentAssociation ? { ...csn.definitions?.[targetName], name: targetName } : null;
  // return parentAssociation ? { ...csn.definitions?.[parentAssociation.target], name: parentAssociation.target } : null;
}

function compositionParentAssociation(entity, csn) {
  if (!entity || entity.kind !== "entity") {
    return;
  }
  const elements = entity.elements ? entity.elements : {};

  for (const name in elements) {
    const element = elements[name];
    const target = element.target;
    if (element.type === "cds.Composition" && name !== 'texts' && target !== entity.name && target['change-tracking-isRootEntity'] !== false) {
      setChangeTrackingIsRootEntity({ ...csn.definitions[target], name: target }, csn, false)
    } 
  }
  // Object.keys(elements).forEach((name)=>{
  //   const element = elements[name];
  //   if (element.type === "cds.Composition" && name !== 'texts' && element.target !== entity.name) {
  //     setChangeTrackingIsRootEntity({ ...csn.definitions[element.target], name: element.target }, csn, false)
  //   } 
  // })
  if (entity['change-tracking-isRootEntity'] !== false) {
    const parentAssociation = Object.keys(elements).find((name) => {
      const element = elements[name];
      const target = element.target;
      // if (element.type === "cds.Composition" && name !== 'texts' && target !== entity.name) {
      //   setChangeTrackingIsRootEntity({ ...csn.definitions[target], name: target }, csn, false)
      // } else 
      if (element.type === "cds.Association" && target !== entity.name) {
        const parentDefinition = csn.definitions[target];
        const parentElements = parentDefinition.elements ? parentDefinition.elements : {};
        // if (parentDefinition['change-tracking-isRootEntity'] === false) {
        //   setChangeTrackingIsRootEntity(entity, csn, false)
        //   loopStop.value = true;
        //   return;
        // }
        return !!Object.keys(parentElements).find((name) => {
          const parentElement = parentElements[name];
          if (parentElement.type === "cds.Composition") {
            return parentElement.target === entity.name;
          }
        });
      }
    });
    if (parentAssociation) {
      setChangeTrackingIsRootEntity(entity, csn, false);
      return elements[parentAssociation];
    } else return undefined;
  }
  return { ...csn.definitions?.[`${entity.name}`], name: entity.name };
}

cds.on('loaded', m => {

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: { changes } } = aspect
  changes.on.pop() // remove ID -> filled in below

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    const compositionEntity = {...m.definitions[name], name};
    const rootEntity = compositionRoot(compositionEntity, m)
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
      // The changehistory list should be refreshed after the custom action is triggered
      if (entity.actions) {

        // Update the changehistory list on the current entity when the custom action of the entity is triggered
        if (entity['@UI.Facets']) {
          addSideEffects(entity.actions, true)
        }

        // When the custom action of the child entity is performed, the change history list of the parent entity is updated
        if (entity.elements) {
          //ToDo: Revisit Breaklook with node.js Expert
          breakLoop: for (const [ele, eleValue] of Object.entries(entity.elements)) {
            const parentEntity = m.definitions[eleValue.target]
            if (parentEntity && parentEntity['@UI.Facets'] && eleValue.type === 'cds.Association') {
              for (const value of Object.values(parentEntity.elements)) {
                if (value.target === name) {
                  addSideEffects(entity.actions, false, ele)
                  break breakLoop
                }
              }
            }
          }
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
