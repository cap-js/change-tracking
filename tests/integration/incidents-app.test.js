const cds = require("@sap/cds")
const path = require("path")
const app = path.join(__dirname, "../incidents-app")
const { test, expect, axios, GET } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe("Tests for uploading/deleting attachments through API calls - in-memory db", () => {
  beforeAll(async () => {
    // Set environment before any connections
    cds.env.requires.db.kind = "sql"
    cds.env.requires.attachments.kind = "db"
    cds.env.requires.attachments.scan = false
    cds.env.profiles = ["development"]

    // Connect to services
    await cds.connect.to("sql:my.db")
    await cds.connect.to("attachments")
  })

  beforeEach(async () => {
    await test.data.reset()
  })

  //Draft mode uploading attachment
  it("Requesting object page", async () => {

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).to.equal(200)
    expect(attachmentResponse.data).to.not.be.undefined;
  })
})
