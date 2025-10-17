const cds = require('@sap/cds')
const DEBUG = cds.debug('changelog')

const isRoot = 'change-tracking-isRootEntity'
const hasParent = 'change-tracking-parentEntity'

const { generateTriggersForEntity, _changes, _change_logs } = require('./lib/hdi-utils.js')

const isChangeTracked = (entity) => {
  if (entity.query?.SET?.op === 'union') return false // REVISIT: should that be an error or warning?
  if (entity['@changelog']) return true
  if (Object.values(entity.elements).some(e => e['@changelog'])) return true
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

function setChangeTrackingIsRootEntity(entity, csn, val = true) {
  if (csn.definitions?.[entity.name]) {
    csn.definitions[entity.name][isRoot] = val
  }
}

function checkAndSetRootEntity(parentEntity, entity, csn) {
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

function processEntities(m) {
  for (let name in m.definitions) {
    compositionRoot({ ...m.definitions[name], name }, m)
  }
}

function compositionRoot(entity, csn) {
  if (!entity || entity.kind !== 'entity') {
    return
  }
  const parentEntity = compositionParent(entity, csn)
  return checkAndSetRootEntity(parentEntity, entity, csn)
}

function compositionParent(entity, csn) {
  if (!entity || entity.kind !== 'entity') {
    return
  }
  const parentAssociation = compositionParentAssociation(entity, csn)
  return parentAssociation ?? null
}

function compositionParentAssociation(entity, csn) {
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

function processCompositionElements(entity, csn, elements) {
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

function findParentAssociation(entity, csn, elements) {
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



/**
 * Returns an expression for the key of the given entity, which we can use as the right-hand-side of an ON condition.
 */
function entityKey4(entity) {
  const xpr = []
  for (let k in entity.elements) {
    const e = entity.elements[k]; if (!e.key) continue
    if (xpr.length) xpr.push('||')
    if (e.type === 'cds.Association') xpr.push({ ref: [k, e.keys?.[0]?.ref?.[0]] })
    else xpr.push({ ref: [k] })
  }
  return xpr
}


// Unfold @changelog annotations in loaded model
function enhanceModel(m) {

  const _enhanced = 'sap.changelog.enhanced'
  if (m.meta?.[_enhanced]) return // already enhanced

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: { changes } } = aspect
  // if (changes.on.length > 2) changes.on.pop() // remove ID -> filled in below

  processEntities(m) // REVISIT: why is that required ?!?

  for (let name in m.definitions) {

    const entity = m.definitions[name]
    if (entity.kind === 'entity' && isChangeTracked(entity)) {

      if (!entity['@changelog.disable_assoc']) {

        // Add association to ChangeView...
        const keys = entityKey4(entity); if (!keys.length) continue // If no key attribute is defined for the entity, the logic to add association to ChangeView should be skipped.
        const on = [];
        for (const part of changes.on) {
          if (part?.ref && part.ref[0] === 'ID') on.push(...keys)
          else on.push(part)
        }
        const assoc = new cds.builtin.classes.Association({ ...changes, on});

        // --------------------------------------------------------------------
        // PARKED: Add auto-exposed projection on ChangeView to service if applicable
        // const namespace = name.match(/^(.*)\.[^.]+$/)[1]
        // const service = m.definitions[namespace]
        // if (service) {
        //   const projection = {from:{ref:[assoc.target]}}
        //   m.definitions[assoc.target = namespace + '.' + Changes] = {
        //     '@cds.autoexposed':true, kind:'entity', projection
        //   }
        //   DEBUG?.(`\n
        //     extend service ${namespace} with {
        //       entity ${Changes} as projection on ${projection.from.ref[0]};
        //     }
        //   `.replace(/ {10}/g,''))
        // }
        // --------------------------------------------------------------------

        DEBUG?.(`\n
          extend ${name} with {
            changes : Association to many ${assoc.target} on ${assoc.on.map(x => x.ref?.join('.') || x).join(' ')};
          }
        `.replace(/ {8}/g, ''))
        const query = entity.projection || entity.query?.SELECT
        if (query) (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
        else if (entity.elements) entity.elements.changes = assoc

        // Add UI.Facet for Change History List
        if (!entity['@changelog.disable_facet'])
          entity['@UI.Facets']?.push(facet)
      }

      if (entity.actions) {
        const hasParentInfo = entity[hasParent]
        const entityName = hasParentInfo?.entityName
        const parentEntity = entityName ? m.definitions[entityName] : null
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
  (m.meta ??= {})[_enhanced] = true
}

// Add generic change tracking handlers
function addGenericHandlers() {
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
}


// Register plugin hooks
cds.on('compile.for.runtime', csn => { DEBUG?.('on', 'compile.for.runtime'); enhanceModel(csn) })
cds.on('compile.to.edmx', csn => { DEBUG?.('on', 'compile.to.edmx'); enhanceModel(csn) })
cds.on('compile.to.dbx', csn => { DEBUG?.('on', 'compile.to.dbx'); enhanceModel(csn) })
cds.on('served', addGenericHandlers)

// Generate HDI artifacts for change tracking
// const _hdi_migration = cds.compiler.to.hdi.migration;
// cds.compiler.to.hdi.migration = function (csn, options, beforeImage) {
//   const triggers = [];

//   for (let [name, def] of Object.entries(csn.definitions)) {
//     if (def.kind !== 'entity' || !isChangeTracked(def)) continue;
//     const entityTriggers = generateTriggersForEntity(name, def);
//     triggers.push(...entityTriggers);
//   }

//   // Load procedures for Changes and ChangeLog creation
//   if (triggers.length > 0) {
//     triggers.push({ name: 'CREATE_CHANGES', sql: _changes, suffix: '.hdbprocedure' })
//     triggers.push({ name: 'CREATE_CHANGE_LOG', sql: _change_logs, suffix: '.hdbprocedure' })
//   }

//   const ret = _hdi_migration(csn, options, beforeImage);
//   ret.definitions = [...ret.definitions, ...triggers];
//   return ret;
// }