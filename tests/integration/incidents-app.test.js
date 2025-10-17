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

  it("Localized values are stored - EN", async () => {
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
  });

  it("Localized values are stored - DE", async () => {
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {}
    )

    await PATCH(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)?sap-locale=de`, {
        status_code: 'R'
      }
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {}
    )

    const {data: {value: changes}} = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`
    )
    const statusChangeGerman = changes.find(change => change.attribute === 'status');
    expect(statusChangeGerman).to.have.property('valueChangedFrom', 'Neu')
    expect(statusChangeGerman).to.have.property('valueChangedTo', 'Gelöst')

  });

  //Draft mode uploading attachment
  it("Requesting object page to ensure change tracking works with attachments combined", async () => {

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).to.equal(200)
    expect(attachmentResponse.data).to.not.be.undefined;
  })

  //REVISIT: Ideally use OData dynamic types so UI does the formatting and not the backend
  it("Date and time values are localized", async () => {

    await POST(
      `odata/v4/processor/Incidents(ID=${'3583f982-d7df-4aad-ab26-301d4a157cd7'},IsActiveEntity=true)/ProcessorService.draftEdit`, {}
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${'3583f982-d7df-4aad-ab26-301d4a157cd7'},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {}
    )

    const {data: {value: changes}} = await GET(
      `odata/v4/processor/Incidents(ID=${'3583f982-d7df-4aad-ab26-301d4a157cd7'},IsActiveEntity=true)/changes?sap-locale=en`
    )
    const dbChanges = await SELECT.from('sap.changelog.Changes').where({attribute: {in: ['date', 'time', 'datetime', 'timestamp']}})
    const dateChange = changes.find(change => change.attribute === 'date');
    const dateDBChange = dbChanges.find(change => change.attribute === 'date');
    expect(dateChange.valueChangedFrom).to.not.equal(dateDBChange.valueChangedFrom);
    expect(dateChange.valueChangedTo).to.not.equal(dateDBChange.valueChangedTo);
    const timeChange = changes.find(change => change.attribute === 'time');
    const timeDBChange = dbChanges.find(change => change.attribute === 'time');
    expect(timeChange.valueChangedFrom).to.not.equal(timeDBChange.valueChangedFrom);
    expect(timeChange.valueChangedTo).to.not.equal(timeDBChange.valueChangedTo);
    const dateTimeChange = changes.find(change => change.attribute === 'datetime');
    const dateTimeDBChange = dbChanges.find(change => change.attribute === 'datetime');
    expect(dateTimeChange.valueChangedFrom).to.not.equal(dateTimeDBChange.valueChangedFrom);
    expect(dateTimeChange.valueChangedTo).to.not.equal(dateTimeDBChange.valueChangedTo);
    const timestampChange = changes.find(change => change.attribute === 'timestamp');
    const timestampDBChange = dbChanges.find(change => change.attribute === 'timestamp');
    expect(timestampChange.valueChangedFrom).to.not.equal(timestampDBChange.valueChangedFrom);
    expect(timestampChange.valueChangedTo).to.not.equal(timestampDBChange.valueChangedTo);
  })
})
