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


// Unfold @changelog annotations in loaded model
cds.on('loaded', m => {

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: { changes } } = aspect
  changes.on.pop() // remove ID -> filled in below

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    if (isChangeTracked(entity)) {

      // Determine entity keys
      const keys = [], { elements: elms } = entity
      for (let e in elms) if (elms[e].key) keys.push(e)

      // Add association to ChangeView...
      const on = [...changes.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({
        ref: k === 'up_' ? [k,'ID'] : [k] // REVISIT: up_ handling is a dirty hack for now
      })})
      const assoc = { ...changes, on }
      const query = entity.projection || entity.query?.SELECT
      if (query) {
        (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
      } else {
        entity.elements.changes = assoc
      }

      // Add UI.Facet for Change History List
      entity['@UI.Facets']?.push(facet)

      // The changehistory list should be refreshed after the custom action is triggered
      if (entity.actions) {

        // Update the changehistory list on the current entity when the custom action of the entity is triggered
        if (entity['@UI.Facets']) {
          addSideEffects(entity.actions, true)
        }

        // When the custom action of the child entity is performed, the change history list of the parent entity is updated
        if (entity.elements) {
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
