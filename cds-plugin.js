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

async function changelistHandler(results, req) {
  if (results.length === 0) return;
  /** For each data (ID) entry, get changes from database */
  let i = 0
  for (const result of results) {
    const query = SELECT.from(req.target.name).where({ ID:result.ID })
    const queryResult = await cds.db.run(query)
   /** Write changes to (UI) table */
    if (queryResult && queryResult[0].changes) {
      const changes = []
      for (const change of queryResult[0].changes) {
        const entry = {}
        const headers = ['attribute', 'modification', 'valueChangedFrom', 'valueChangedTo']
        headers.forEach(h => { entry[h] = change[h] })
        changes.push(entry)
      }
      /** Change are displayed as a string */
      const changelist = JSON.stringify(changes, null, 2)
        .replace( /[\[{",}\]]/g, '').replace(/\n+/g, '\n')
      req.results[i].changelist = changelist
      i++
    }
  }
}

// Add generic change tracking handlers
cds.on('served', (req) => {
  const { track_changes, _afterReadChangeLog } = require("./srv/changelog-service")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {

      /** Register READ handler to flatten changes */
      srv.after('READ', `${srv.name}.ChangeLog`, changelistHandler)

      let any = false
      for (const entity of Object.values(srv.entities)) {
        if (isChangeTracked(entity)) {

          cds.db.before("CREATE", entity, track_changes)
          cds.db.before("UPDATE", entity, track_changes)
          cds.db.before("DELETE", entity, track_changes)
          any = true
        }
      }
      if (any && srv.entities.ChangeLog) {
        srv.after("READ", srv.entities.ChangeLog, _afterReadChangeLog)
      }
    }
  }
})
