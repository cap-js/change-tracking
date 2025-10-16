const cds = require("@sap/cds")
const path = require("path")
const app = path.join(__dirname, "../incidents-app")
const { test, expect, axios, GET, POST, PATCH } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe("Tests for uploading/deleting attachments through API calls - in-memory db", () => {

  beforeEach(async () => {
    await test.data.reset()
  })

  it("Localized values are stored", async () => {
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {}
    )

    await PATCH(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
        status_code: 'R'
      }
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {}
    )

    const {data: {value: changes}} = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`
    )
    const statusChange = changes.find(change => change.attribute === 'status');
    expect(statusChange).to.have.property('valueChangedFrom', 'New')
    expect(statusChange).to.have.property('valueChangedTo', 'Resolved')

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {}
    )

    await PATCH(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)?sap-locale=de`, {
        status_code: 'N'
      }
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {}
    )

    const {data: {value: changes2}} = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`
    )
    const statusChangeGerman = changes2.sort((a,b) => b.createdAt - a.createdAt).find(change => change.attribute === 'status');
    expect(statusChangeGerman).to.have.property('valueChangedFrom', 'Gelöst')
    expect(statusChangeGerman).to.have.property('valueChangedTo', 'Neu')
  })
})
