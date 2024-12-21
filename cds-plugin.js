const cds = require('@sap/cds')
const DEBUG = cds.debug('changelog')

const isRoot = 'change-tracking-isRootEntity'
const hasParent = 'change-tracking-parentEntity'

const isChangeTracked = (entity) => {
  if (entity.query?.SET?.op === 'union') return false
  if (entity['@cds.autoexposed']) return false
  if (entity['@changelog']) return true
  if (entity.elements && Object.values(entity.elements).some(e => e['@changelog'])) return true
}

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

function setChangeTrackingIsRootEntity (entity, csn, val = true) {
  if (csn.definitions?.[entity.name]) {
    csn.definitions[entity.name][isRoot] = val
  }
}

function checkAndSetRootEntity (parentEntity, entity, csn) {
  if (entity[isRoot] === false) {
    return entity
  }
  if (parentEntity) {
    return compositionRoot(parentEntity, csn)
  } else {
    setChangeTrackingIsRootEntity(entity, csn)
    return { ...csn.definitions?.[entity.name], name: entity.name }
  }
}

function processEntities (m) {
  for (let name in m.definitions) {
    compositionRoot({ ...m.definitions[name], name }, m)
  }
}

function compositionRoot (entity, csn) {
  if (!entity || entity.kind !== 'entity') {
    return
  }
  const parentEntity = compositionParent(entity, csn)
  return checkAndSetRootEntity(parentEntity, entity, csn)
}

function compositionParent (entity, csn) {
  if (!entity || entity.kind !== 'entity') {
    return
  }
  const parentAssociation = compositionParentAssociation(entity, csn)
  return parentAssociation ?? null
}

function compositionParentAssociation (entity, csn) {
  if (!entity || entity.kind !== 'entity') {
    return
  }
  const elements = entity.elements ?? {}

  // Add the change-tracking-isRootEntity attribute of the child entity
  processCompositionElements(entity, csn, elements)

  const hasChildFlag = entity[isRoot] !== false
  const hasParentEntity = entity[hasParent]

  if (hasChildFlag || !hasParentEntity) {
    // Find parent association of the entity
    const parentAssociation = findParentAssociation(entity, csn, elements)
    if (parentAssociation) {
      const parentAssociationTarget = elements[parentAssociation]?.target
      if (hasChildFlag) setChangeTrackingIsRootEntity(entity, csn, false)
      return {
        ...csn.definitions?.[parentAssociationTarget],
        name: parentAssociationTarget
      }
    } else return
  }
  return { ...csn.definitions?.[entity.name], name: entity.name }
}

function processCompositionElements (entity, csn, elements) {
  for (const name in elements) {
    const element = elements[name]
    const target = element?.target
    const definition = csn.definitions?.[target]
    if (
      element.type !== 'cds.Composition' ||
      target === entity.name ||
      !definition ||
      definition[isRoot] === false
    ) {
      continue
    }
    setChangeTrackingIsRootEntity({ ...definition, name: target }, csn, false)
  }
}

function findParentAssociation (entity, csn, elements) {
  return Object.keys(elements).find((name) => {
    const element = elements[name]
    const target = element?.target
    if (element.type === 'cds.Association' && target !== entity.name) {
      const parentDefinition = csn.definitions?.[target] ?? {}
      const parentElements = parentDefinition?.elements ?? {}
      return !!Object.keys(parentElements).find((parentEntityName) => {
        const parentElement = parentElements?.[parentEntityName] ?? {}
        if (parentElement.type === 'cds.Composition') {
          const isCompositionEntity = parentElement.target === entity.name
          // add parent information in the current entity
          if (isCompositionEntity) {
            csn.definitions[entity.name][hasParent] = {
              associationName: name,
              entityName: target
            }
          }
          return isCompositionEntity
        }
      })
    }
  })
}



const _enhanced = 'sap.changelog.enhanced'
const namespace = 'sap.changelog'
const Changes = 'ChangeView'
const changes = {
  type: 'cds.Association', target: namespace +'.' + Changes,
  on: [ {ref:['changes','entityKey']}, '=', /* filled in below */ ],
  cardinality: { max:'*' },
}
const UIFacet = {
  $Type  : 'UI.ReferenceFacet',
  Target : 'changes/@UI.PresentationVariant',
  Label  : '{i18n>ChangeHistory}',
  // ID     : 'ChangeHistoryFacet',
  '@UI.PartOfPreview': false
}


/**
 * Returns an expression for the key of the given entity, which we can use as the right-hand-side of an ON condition.
 */
function entityKey4 (entity) {
  const xpr = []
  for (let k in entity.elements) {
    const e = entity.elements[k]; if (!e.key) continue
    if (xpr.length) xpr.push('||')
    if (e.type === 'cds.Association') xpr.push({ ref: [k, e.keys?.[0]?.ref?.[0]] })
    else xpr.push({ ref:[k] })
  }
  return xpr
}


// Unfold @changelog annotations in loaded model
function enhanceModel (csn) {

  if (!csn.definitions?.[changes.target]) return // no change tracking in this model
  if (csn.meta?.[_enhanced]) return // already enhanced

  // Process entities to define the relation
  processEntities(csn) // REVISIT: why is that required ?!?

  for (let name in csn.definitions) {

    const entity = csn.definitions[name]
    if (isChangeTracked(entity)) {

      if (!entity['@changelog.disable_assoc']) { // REVISIT: why do we need that annotation?

        // Add association to ChangeView...
        const assoc = { ...changes, on: [ ...changes.on, ...entityKey4(entity) ] } // clone the changes assoc
        if (assoc.on < 3) continue // If no key attribute is defined for the entity, the logic to add association to ChangeView should be skipped.

        // Add auto-exposed projection on ChangeView to service if applicable
        const namespace = name.match(/^(.*)\.[^.]+$/)[1]
        const service = csn.definitions[namespace]
        if (service) {
          const projection = {from:{ref:[assoc.target]}}
          csn.definitions[assoc.target = namespace + '.' + Changes] = {
            '@cds.autoexposed':true, kind:'entity', projection
          }
          DEBUG?.(`\n
            extend service ${namespace} with {
              entity ${Changes} as projection on ${projection.from.ref[0]};
            }
          `.replace(/ {10}/g,''))
        }

        DEBUG?.(`\n
          extend ${name} with {
            changes : Association to many ${assoc.target} on ${ assoc.on.map(x => x.ref?.join('.') || x).join(' ') };
          }
        `.replace(/ {8}/g,''))
        const query = entity.projection || entity.query?.SELECT
        if (query) (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
        if (entity.elements) entity.elements.changes = assoc

        // Add UI.Facet for Change History List
        if (!entity['@changelog.disable_facet']) // REVISIT: why do we need that annotation?
          entity['@UI.Facets']?.push(UIFacet)
      }

      if (entity.actions) {
        const hasParentInfo = entity[hasParent]
        const entityName = hasParentInfo?.entityName
        const parentEntity = entityName ? csn.definitions[entityName] : null
        const isParentRootAndHasFacets = parentEntity?.[isRoot] && parentEntity?.['@UI.Facets']
        if (entity[isRoot] && entity['@UI.Facets']) {
          // Add side effects for root entity
          addSideEffects(entity.actions, true)
        } else if (isParentRootAndHasFacets) {
          // Add side effects for child entity
          addSideEffects(entity.actions, false, hasParentInfo?.associationName)
        }
      }
    }
  }
  (csn.meta ??= {})[_enhanced] = true
}

// Add generic change tracking handlers
function addGenericHandlers (services) {
  const { track_changes, _afterReadChangeView } = require("./lib/change-log")
  for (const srv of services) {
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
}


// Register plugin hooks
cds.on('compile.for.runtime', csn => { DEBUG?.('on','compile.for.runtime'); enhanceModel(csn) })
cds.on('compile.to.edmx', csn => { DEBUG?.('on','compile.to.edmx'); enhanceModel(csn) })
cds.on('compile.to.dbx', csn => { DEBUG?.('on','compile.to.dbx'); enhanceModel(csn) })
cds.on('served', addGenericHandlers)
