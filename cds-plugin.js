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

      // Add association to ChangeView...
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

async function readHandler(req, next) {
  const data = await next()

  if (req.entity.endsWith('.ChangeLog') && data.length > 0) {
  const params = cds.context._params
  const opts = cds._queryOptions
  //req.results[0].createdBy = 'MARA'
  //req.results[0].changes = 'asdlöfkölskdfölksadlöfksöldkö'
  // data.forEach((d, i) => {
  //   if (d && d.changes) {
  //     //Object.assign(d, ...d.changes)
  //     req.results[i].changes = ''
  //     Object.entries(d.changes).forEach(([k, v]) => {
  //       req.results[i].changes += k + ':' + v + ','
  //     })
  //      // res.send(req.results)
  //   }
  //})
  }
  //return data
}

// Add generic change tracking handlers
cds.on('served', (req) => {
  const { track_changes, _afterReadChangeView } = require("./lib/change-log")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      let any = false
      for (const entity of Object.values(srv.entities)) {
        if (isChangeTracked(entity)) {
          // TODO: Limit this further ---
          //srv.prepend(() => srv.on('READ', readHandler))
          // ----------------------------
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
