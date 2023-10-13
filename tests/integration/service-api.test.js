const cds = require("@sap/cds");
const bookshop = require("path").resolve(__dirname, "./../bookshop");
const { expect, data } = cds.test(bookshop);

jest.setTimeout(5 * 60 * 1000);

let adminService = null;
let ChangeView = null;

describe("change log integration test", () => {
    beforeAll(async () => {
        adminService = await cds.connect.to("AdminService");
        ChangeView = adminService.entities.ChangeView;
    });

    beforeEach(async () => {
        await data.reset();
    });

    it("2.5 Root entity deep creation by service API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const bookStoreData = {
            ID: "843b3681-8b32-4d30-82dc-937cdbc68b3a",
            name: "test bookstore name",
            location: "test location",
            books: [
                {
                    title: "test title",
                    descr: "test",
                    stock: 333,
                    price: 13.13,
                    author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                },
            ],
        };
        await adminService.run(INSERT.into(adminService.entities.BookStores).entries(bookStoreData));

        let changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.BookStores",
            attribute: "name",
        });
        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal(bookStoreData.ID);
        expect(changes[0].objectID).to.equal("test bookstore name");

        changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Books",
            attribute: "title",
        });
        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal(bookStoreData.ID);
        expect(changes[0].objectID).to.equal("test title, Emily, Brontë");
    });

    it("2.6 Root entity deep update by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        await UPDATE(adminService.entities.BookStores)
            .where({ ID: "64625905-c234-4d0d-9bc1-283ee8946770" })
            .with({
                books: [{ ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b1", title: "Wuthering Heights Test" }],
            });

        let changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Books",
            attribute: "title",
        });

        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(changes[0].objectID).to.equal("Wuthering Heights Test, Emily, Brontë");
        expect(changes[0].parentObjectID).to.equal("Shakespeare and Company");
    });

    it("10.7 Composition of one node deep created by service API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        const bookStoreData = {
            ID: "843b3681-8b32-4d30-82dc-937cdbc68b3a",
            name: "test bookstore name",
            registry: {
                ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                code: "San Francisco-2",
                validOn: "2022-01-01",
            },
        };
        await adminService.run(INSERT.into(adminService.entities.BookStores).entries(bookStoreData));

        let changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.BookStoreRegistry",
            attribute: "validOn",
        });
        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal(bookStoreData.ID);
        expect(changes[0].objectID).to.equal("San Francisco-2");
        expect(changes[0].valueChangedFrom).to.equal("");
        expect(changes[0].valueChangedTo).to.equal("2022-01-01");
        expect(changes[0].parentKey).to.equal("843b3681-8b32-4d30-82dc-937cdbc68b3a");
        expect(changes[0].parentObjectID).to.equal("test bookstore name");
    });

    it("10.8 Composition of one node deep updated by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        cds.services.AdminService.entities.BookStoreRegistry["@changelog.keys"] = [
            { "=": "code" },
            { "=": "validOn" },
        ];
        await UPDATE(adminService.entities.BookStores)
            .where({ ID: "64625905-c234-4d0d-9bc1-283ee8946770" })
            .with({
                registry: {
                    ID: "12ed5ac2-d45b-11ed-afa1-0242ac120001",
                    validOn: "2022-01-01",
                },
            });

        let changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.BookStoreRegistry",
            attribute: "validOn",
        });

        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(changes[0].objectID).to.equal("Paris-1, 2022-01-01");
        expect(changes[0].modification).to.equal("update");
        expect(changes[0].valueChangedFrom).to.equal("2012-01-01");
        expect(changes[0].valueChangedTo).to.equal("2022-01-01");
        expect(changes[0].parentKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(changes[0].parentObjectID).to.equal("Shakespeare and Company");
        cds.services.AdminService.entities.BookStoreRegistry["@changelog.keys"] = [{ "=": "code" }];
    });

    it("10.9 Child entity deep delete by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        await UPDATE(adminService.entities.BookStores).where({ ID: "64625905-c234-4d0d-9bc1-283ee8946770" }).with({
            registry: null,
            registry_ID: null,
        });

        const changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.BookStoreRegistry",
            attribute: "validOn",
        });

        expect(changes.length).to.equal(1);
        expect(changes[0].entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(changes[0].objectID).to.equal("Paris-1");
        expect(changes[0].modification).to.equal("delete");
        expect(changes[0].parentObjectID).to.equal("Shakespeare and Company");
        expect(changes[0].valueChangedFrom).to.equal("2012-01-01");
        expect(changes[0].valueChangedTo).to.equal("");
    });
});
