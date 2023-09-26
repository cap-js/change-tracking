const cds = require('@sap/cds/lib')

const isChangeTracked = (entity) => (
  entity['@changelog'] || entity['@changelog.keys']
  || entity.elements && Object.values(entity.elements).some(e => e['@changelog'])
)


// Unfold @changelog annotations in loaded model
cds.on('loaded', m => {

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  // Shows how to add an action
  const { 'sap.changelog.show': action } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: { changes } } = aspect
  changes.on.pop() // remove ID -> filled in below

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    if (isChangeTracked(entity)) {

      // Determine entity keys
      const keys = [], { elements: elms } = entity
      for (let e in elms) if (elms[e].key) keys.push(e)

      // Add association to ChangeView...
      const on = [...changes.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({ ref: [k] }) })
      const assoc = { ...changes, on }
      const query = entity.projection || entity.query?.SELECT
      if (query) {
        (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
      } else {
        entity.elements.changes = assoc
      }

      // Shows how to add an unbound action to the service
      const srv = name.split('.')[0]
      if (m.definitions[srv].kind === 'service' && !m.definitions[`${srv}.show`]) {
        m.definitions[`${srv}.show`] = action;
        m.definitions['sap.changelog.ChangeView']['@UI.LineItem'].forEach(l => {
          if (l['$Type'] === 'UI.DataFieldForAction') {
            l['Action'] = l['Action'].replace('sap.changelog.', `${srv}.EntityContainer/`)
          }
        })
      }

      // Add UI.Facet for Change History List
      entity['@UI.Facets']?.push(facet)
    }
  }
})

// Add generic change tracking handlers
cds.on('served', () => {
  const { track_changes, _afterReadChangeView } = require("./lib/change-log")
  for (const srv of cds.services) {
    srv.on("show", (req) => {
      req.notify('Triggered the unbound action "show".')
    })
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
