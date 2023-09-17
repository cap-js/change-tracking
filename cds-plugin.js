const cds = require('@sap/cds/lib')

const Changelists = new Map();

const isChangeTracked = (entity) => (
  entity['@changelog'] || entity['@changelog.keys']
  || entity.elements && Object.values(entity.elements).some(e => e['@changelog'])
)

/** TODO: Preferable have this on the service, but how to we annotate this? */
cds.on('bootstrap', async app => {
  app.get('/changelist/', async (req, res) => {
    const { ID, entityKey } = req.query
    /** For each data (ID) entry, get changes from database */
    if (!Changelists.get(ID)) {
      if (req.query.ID) {
        // TODO: Get service name instead of 'ProcessorService' string
        const query = SELECT.from('ProcessorsService.ChangeLog').where({ID})
        const queryResult = await cds.db.run(query)
        if (queryResult) {
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
            Changelists.set(entityKey, { text: changelist, json: changes })
        }
      }
    } else {
      Changelists.delete(ID)
    }

    /** OPTION 1: Show table at new URL */
    res.send(createTableFromObj(Changelists.get(entityKey).json))

    /** OPTION 2: Show in changes column */
    //const url = `/incidents/#/Incidents(ID=${entityKey},IsActiveEntity=true)`
    //res.redirect(url)
  })
})

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

/** Need this for DISPLAY OPTION 2 */
// async function changeViewHandler(results, req) {
//   if (results.length === 0) return;
//   if (!results[0].changelist) {
//     results.forEach((result, i) => {
//       req.results[i].changelist = Changelists.get(result.ID.text)
//     })
//   }
// }

// Add generic change tracking handlers
cds.on('served', (req) => {
  const { track_changes, _afterReadChangeLog } = require("./srv/changelog-service")
  for (const srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {

      /** Need this for DISPLAY OPTION 2 */
      /** Register READ handler to flatten changes */
      //srv.after('READ', `${srv.name}.ChangeLog`, changeViewHandler)

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

function createTableFromObj(obj) {
  let html = ''
  html += `<!DOCTYPE html><html><head><style>
  #customers {
    font-family: Arial, Helvetica, sans-serif;
    border-collapse: collapse;
    width: 100%;
  }
  
  #customers td, #customers th {
    border: 1px solid #ddd;
    padding: 8px;
  }
  
  #customers tr:nth-child(even){background-color: #f2f2f2;}
  
  #customers tr:hover {background-color: #ddd;}
  
  #customers th {
    padding-top: 12px;
    padding-bottom: 12px;
    text-align: left;
    background-color: gray;
    color: white;
  }
  </style></head><body>`
  let body = '<tr>';
  for (const key of Object.keys(obj[0])) {
    body += '<th>' + key + '</th>'
  }
  body += '</tr>'
  for (let i = 0; i < obj.length; i++) {
    body += '<tr>'
    for (const value of Object.values(obj[i])) {
      body += '<td>' + value + '</td>'
    }
    body += '</tr>'
  }
  html +=  `<table id="customers">${body}</table></body></html>`
  return html
}
