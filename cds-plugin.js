const cds = require('@sap/cds/lib')

const isChangeTracked = (entity) => (
  entity['@changelog'] || entity['@changelog.keys']
  || entity.elements && Object.values(entity.elements).some(e => e['@changelog'])
)

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

      // Add association to Changes
      const on = [...changes.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({ ref: [k] }) })
      const assoc = { ...changes, on }
      const query = entity.projection || entity.query?.SELECT
      if (query) {
        (query.columns ??= ['*']).push({ as: 'changes', cast: assoc })
      } else {
        entity.elements.changes = assoc
      }

      // Add UI.Facet for Change History List
      entity['@UI.Facets']?.push(facet)
    }
  }
})

// TODO: Remove this later. This demonstrates how to intercept
// ODATA batch request to flatten Changes data
function afterReadHandler(results, req) {
  if (results.length === 0) return;

  if (results && results[0].changes) {
    const changesDisplayKeys = ['valueChangedFrom', 'valueChangedTo']
    let flatData = []
    let i = 0;
    for (const result of req.results) {
      const changesDisplayValues = []
      for (const change of result.changes) {
        const changeDisplay = {}
        for (const key of changesDisplayKeys) {
          changeDisplay[key] = change[key]
        }
        changesDisplayValues.push(changeDisplay)
      }
      req.results[i].changelist = JSON.stringify(changesDisplayValues, null, 2)
      i++
    }

  }
}

function actionHandler(req) {
  console.log(req)
}

// Add generic change tracking handlers
cds.on('served', (req) => {
  const { track_changes, _afterReadChangeView } = require("./lib/change-log")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {

      /** Register READ handler to flatten changes */
      srv.after('READ', `${srv.name}.ChangeLog`, afterReadHandler)

      /** Register listChanges action */
      srv.on('listChanges',  `${srv.name}.ChangeLog`, actionHandler)

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
        //srv.after("READ", srv.entities.ChangeView, _afterReadChangeView)
      }
    }
  }
})
