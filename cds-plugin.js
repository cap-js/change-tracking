const cds = require ('@sap/cds')
console.trace()
cds.on('served', ()=>{
  for (let srv of cds.services) {
    for (let e of srv.entities) {
      console.debug(e.name)
      if (e['@ChangeTracked']) srv.before('UPDATE',e,(req)=>{
        let delta = diff(req.data,req.subject)
        // ctsrv.log (delta)
      })
    }
  }
  console.trace()
})
