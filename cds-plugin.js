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

      // Add association to ChangeLog...
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

// Add generic change tracking handlers
cds.on('served', () => {
  const { track_changes, _afterReadChangeLog } = require("./lib/change-log")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      let any = false
      for (const entity of Object.values(srv.entities)) {
        if (isChangeTracked(entity)) {
          // For (nested) changes, dump to table
          srv.after('READ', `${srv.name}.ChangeLog`, changeViewHandler)

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

/** For each ChangeLog entries, write corresponding
 * changes (json) to table as plain text
 */
async function changeViewHandler(results, req) {
  if (results.length === 0) return;
  let i = 0
  for (const result of results) {
    const { ID } = result;
    const query = SELECT.from(`${this.name}.ChangeLog`).where({ID})
    const queryResult = await cds.db.run(query)
    if (!queryResult || queryResult.length === 0) return;
    results[i].changelist = JSON.stringify(queryResult[0].changes, null, 4)
    i++
  }
}
