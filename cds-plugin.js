const cds = require ('@sap/cds/lib')

// Unfold @changelog annotations in loaded model
cds.on('loaded', m => {

  // Get definitions from Dummy entity in our models
  const { 'sap.changelog.aspect': aspect } = m.definitions; if (!aspect) return // some other model
  const { '@UI.Facets': [facet], elements: {changes} } = aspect
  changes.on.pop() // remove ID -> filled in below

  for (let name in m.definitions) {
    const entity = m.definitions[name]
    if (entity['@changelog'] || entity['@changelog.keys']) {

      // Determine entity keys
      const keys = [], {elements:elms} = entity
      for (let e in elms) if (elms[e].key) keys.push(e)

      // Add association to ChangeView...
      const on = [...changes.on]; keys.forEach((k,i) => { i && on.push('||'); on.push({ref:[k]}) })
      const assoc = { ...changes, on }
      const query = entity.projection || entity.query?.SELECT
      if (query) {
        (query.columns ??= ['*']).push({ as: 'changes', cast: assoc})
      } else {
        entity.elements.changes = assoc
      }

      // Add defaults for @changelog.keys
      entity['@changelog.keys'] ??= keys

      // Add UI.Facet for Change History List
      entity['@UI.Facets']?.push(facet)
    }
  }
})

// Add generic change tracking handlers
cds.on('served', ()=> require("./lib/change-log")())
