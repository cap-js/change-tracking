const cds = require("@sap/cds");
const bookshop = require("path").resolve(__dirname, "./../bookshop");
const { expect, data } = cds.test(bookshop);

jest.setTimeout(5 * 60 * 1000);

let adminService = null;
let ChangeView = null;
let ChangeLog = null;
let db = null;

describe("change log integration test", () => {
    beforeAll(async () => {
        adminService = await cds.connect.to("AdminService");
        db = await cds.connect.to("sql:my.db");
        ChangeView = adminService.entities.ChangeView;
        ChangeView["@cds.autoexposed"] = false;
        ChangeLog = db.model.definitions["sap.changelog.ChangeLog"];
    });

    beforeEach(async () => {
        await data.reset();
    });

    it("1.6 When the global switch is on, all changelogs should be retained after the root entity is deleted, and a changelog for the deletion operation should be generated", async () => {
        cds.env.requires["change-tracking"].preserveDeletes = true;

        const authorData = [
            {
                ID: "64625905-c234-4d0d-9bc1-283ee8940812",
                name_firstName: "Sam",
                name_lastName: "Smiths",
                placeOfBirth: "test place",
            }
        ]

        await INSERT.into(adminService.entities.Authors).entries(authorData);
        const beforeChanges = await adminService.run(SELECT.from(ChangeView));
        expect(beforeChanges.length > 0).to.be.true;

        await DELETE.from(adminService.entities.Authors).where({ ID: "64625905-c234-4d0d-9bc1-283ee8940812" });

        const afterChanges = await adminService.run(SELECT.from(ChangeView));
        expect(afterChanges.length).to.equal(6);
    });

    it("1.8 When creating or deleting a record with a numeric type of 0 and a boolean type of false, a changelog should also be generated", async () => {
        cds.env.requires["change-tracking"].preserveDeletes = true;
        cds.services.AdminService.entities.Order.elements.netAmount["@changelog"] = true;
        cds.services.AdminService.entities.Order.elements.isUsed["@changelog"] = true;

        const ordersData = {
            ID: "0faaff2d-7e0e-4494-97fe-c815ee973fa1",
            isUsed: false,
            netAmount: 0
        };
        
        await INSERT.into(adminService.entities.Order).entries(ordersData);
        let changes = await adminService.run(SELECT.from(ChangeView));

        expect(changes).to.have.length(2);
        expect(
            changes.map((change) => ({
              entityKey: change.entityKey,
              entity: change.entity,
              valueChangedFrom: change.valueChangedFrom,
              valueChangedTo: change.valueChangedTo,
              modification: change.modification,
              attribute: change.attribute
            }))
          ).to.have.deep.members([
            {
              entityKey: "0faaff2d-7e0e-4494-97fe-c815ee973fa1",
              modification: "Create",
              entity: "sap.capire.bookshop.Order",
              attribute: "netAmount",
              valueChangedFrom: "",
              valueChangedTo: "0"
            },
            {
              entityKey: "0faaff2d-7e0e-4494-97fe-c815ee973fa1",
              modification: "Create",
              entity: "sap.capire.bookshop.Order",
              attribute: "isUsed",
              valueChangedFrom: "",
              valueChangedTo: "false"
            },
        ]);

        await DELETE.from(adminService.entities.Order).where({ ID: "0faaff2d-7e0e-4494-97fe-c815ee973fa1" });
        changes = await adminService.run(
            SELECT.from(ChangeView).where({
                modification: "delete",
            })
        );

        expect(changes).to.have.length(2);
        expect(
            changes.map((change) => ({
              entityKey: change.entityKey,
              entity: change.entity,
              valueChangedFrom: change.valueChangedFrom,
              valueChangedTo: change.valueChangedTo,
              modification: change.modification,
              attribute: change.attribute
            }))
          ).to.have.deep.members([
            {
              entityKey: "0faaff2d-7e0e-4494-97fe-c815ee973fa1",
              modification: "Delete",
              entity: "sap.capire.bookshop.Order",
              attribute: "netAmount",
              valueChangedFrom: "0",
              valueChangedTo: ""
            },
            {
              entityKey: "0faaff2d-7e0e-4494-97fe-c815ee973fa1",
              modification: "Delete",
              entity: "sap.capire.bookshop.Order",
              attribute: "isUsed",
              valueChangedFrom: "false",
              valueChangedTo: ""
            },
        ]);
        
        delete cds.services.AdminService.entities.Order.elements.netAmount["@changelog"];
        delete cds.services.AdminService.entities.Order.elements.isUsed["@changelog"];
    });
    
    it("1.9 For DateTime and Timestamp, support for input via Date objects.", async () => {
        cds.env.requires["change-tracking"].preserveDeletes = true;
        cds.services.AdminService.entities.RootEntity.elements.dateTime["@changelog"] = true;
        cds.services.AdminService.entities.RootEntity.elements.timestamp["@changelog"] = true;
        const rootEntityData = [
            {
                ID: "64625905-c234-4d0d-9bc1-283ee8940717",
                dateTime: new Date("2024-10-16T08:53:48Z"),
                timestamp: new Date("2024-10-23T08:53:54.000Z")
            }
        ]
        await INSERT.into(adminService.entities.RootEntity).entries(rootEntityData);
        let changes = await adminService.run(SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.RootEntity",
            attribute: "dateTime",
        }));
        expect(changes.length).to.equal(1);
        let change = changes[0];
        expect(change.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8940717");
        expect(change.attribute).to.equal("dateTime");
        expect(change.modification).to.equal("Create");
        expect(change.valueChangedFrom).to.equal("");
        /**
         * REVISIT: Currently, when using '@cap-js/sqlite' or '@cap-js/hana' and inputting values of type Date in javascript,
         * there is an issue with inconsistent formats before and after, which requires a fix from cds-dbs (Issue-873).
         */
        expect(change.valueChangedTo).to.equal(`${new Date("2024-10-16T08:53:48Z")}`);
        delete cds.services.AdminService.entities.RootEntity.elements.dateTime["@changelog"];
        delete cds.services.AdminService.entities.RootEntity.elements.timestamp["@changelog"];
        cds.env.requires["change-tracking"].preserveDeletes = false;
    });

    it("2.5 Root entity deep creation by service API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const bookStoreData = {
            ID: "843b3681-8b32-4d30-82dc-937cdbc68b3a",
            name: "test bookstore name",
            location: "test location",
            books: [
                {
                    ID: "f35b2d4c-9b21-4b9a-9b3c-ca1ad32a0d1a",
                    title: "test title",
                    descr: "test",
                    stock: 333,
                    price: 13.13,
                    author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                },
            ],
        };

        // CAP currently support run queries on the draft-enabled entity on application service, so we can re-enable it. (details in CAP/Issue#16292)
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

    it("3.6 Composition operation of inline entity operation by QL API", async () => {
        await UPDATE(adminService.entities["Order.Items"])
            .where({
                up__ID: "3b23bb4b-4ac7-4a24-ac02-aa10cabd842c", 
                ID: "2b23bb4b-4ac7-4a24-ac02-aa10cabd842c"
            })
            .with({
                quantity: 12
            });

        const changes = await adminService.run(SELECT.from(ChangeView));
        
        expect(changes.length).to.equal(1);
        const change = changes[0];
        expect(change.attribute).to.equal("quantity");
        expect(change.modification).to.equal("Update");
        expect(change.valueChangedFrom).to.equal("10");
        expect(change.valueChangedTo).to.equal("12");
        expect(change.parentKey).to.equal("3b23bb4b-4ac7-4a24-ac02-aa10cabd842c");
        expect(change.keys).to.equal("ID=2b23bb4b-4ac7-4a24-ac02-aa10cabd842c");
    });

    it("7.3 Annotate fields from chained associated entities as objectID (ERP4SMEPREPWORKAPPPLAT-4542)", async () => {
        cds.services.AdminService.entities.BookStores["@changelog"].push({ "=": "city.name" })

        const bookStoreData = {
            ID: "9d703c23-54a8-4eff-81c1-cdce6b6587c4",
            name: "new name",
        };
        await INSERT.into(adminService.entities.BookStores).entries(bookStoreData);
        let createBookStoresChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.BookStores",
            attribute: "name",
            modification: "create",
        });
        expect(createBookStoresChanges.length).to.equal(1);
        const createBookStoresChange = createBookStoresChanges[0];
        expect(createBookStoresChange.objectID).to.equal("new name");

        await UPDATE(adminService.entities.BookStores)
        .where({ 
            ID: "9d703c23-54a8-4eff-81c1-cdce6b6587c4"
        })
        .with({
            name: "BookStores name changed"
        });
        const updateBookStoresChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "name",
                modification: "update",
            }),
        );
        expect(updateBookStoresChanges.length).to.equal(1);
        const updateBookStoresChange = updateBookStoresChanges[0];
        expect(updateBookStoresChange.objectID).to.equal("BookStores name changed");

        cds.services.AdminService.entities.BookStores["@changelog"].pop();
        
        const level3EntityData = [
            {
                ID: "12ed5dd8-d45b-11ed-afa1-0242ac654321",
                title: "Service api Level3 title",
                parent_ID: "dd1fdd7d-da2a-4600-940b-0baf2946c4ff",
            },
        ];
        await INSERT.into(adminService.entities.Level3Entity).entries(level3EntityData);
        let createChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Level3Entity",
            attribute: "title",
            modification: "create",
        });
        expect(createChanges.length).to.equal(1);
        const createChange = createChanges[0];
        expect(createChange.objectID).to.equal("In Preparation");
        expect(createChange.parentKey).to.equal("dd1fdd7d-da2a-4600-940b-0baf2946c4ff");
        expect(createChange.parentObjectID).to.equal("In Preparation");

        // Check the changeLog to make sure the entity information is root
        const changeLogs = await SELECT.from(ChangeLog).where({
            entity: "sap.capire.bookshop.RootEntity",
            entityKey: "64625905-c234-4d0d-9bc1-283ee8940812",
            serviceEntity: "AdminService.RootEntity",
        })

        expect(changeLogs.length).to.equal(1);
        expect(changeLogs[0].entity).to.equal("sap.capire.bookshop.RootEntity");
        expect(changeLogs[0].entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8940812");
        expect(changeLogs[0].serviceEntity).to.equal("AdminService.RootEntity");

        await UPDATE(adminService.entities.Level3Entity, "12ed5dd8-d45b-11ed-afa1-0242ac654321").with({
            title: "L3 title changed by QL API",
        });
        let updateChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Level3Entity",
            attribute: "title",
            modification: "update",
        });
        expect(createChanges.length).to.equal(1);
        const updateChange = updateChanges[0];
        expect(updateChange.objectID).to.equal("In Preparation");
        expect(createChange.parentKey).to.equal("dd1fdd7d-da2a-4600-940b-0baf2946c4ff");
        expect(createChange.parentObjectID).to.equal("In Preparation");

        await DELETE.from(adminService.entities.Level3Entity).where({ ID: "12ed5dd8-d45b-11ed-afa1-0242ac654321" });
        let deleteChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Level3Entity",
            attribute: "title",
            modification: "delete",
        });
        expect(deleteChanges.length).to.equal(1);
        const deleteChange = deleteChanges[0];
        expect(deleteChange.objectID).to.equal("In Preparation");
        expect(createChange.parentKey).to.equal("dd1fdd7d-da2a-4600-940b-0baf2946c4ff");
        expect(createChange.parentObjectID).to.equal("In Preparation");

        // Test object id when parent and child nodes are created at the same time
        const RootEntityData = {
            ID: "01234567-89ab-cdef-0123-987654fedcba",
            name: "New name for RootEntity",
            lifecycleStatus_code: "IP",
            child: [
                {
                    ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                    title: "New name for Level1Entity",
                    parent_ID: "01234567-89ab-cdef-0123-987654fedcba",
                    child: [
                        {
                            ID: "12ed5dd8-d45b-11ed-afa1-0242ac124446",
                            title: "New name for Level2Entity",
                            parent_ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003"
                        },
                    ],
                },
            ],
        };
        await INSERT.into(adminService.entities.RootEntity).entries(RootEntityData);

        const createEntityChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Level2Entity",
                attribute: "title",
                modification: "create",
            }),
        );
        expect(createEntityChanges.length).to.equal(1);
        const createEntityChange = createEntityChanges[0];
        expect(createEntityChange.objectID).to.equal("In Preparation");

        // Test the object id when the parent node and child node are modified at the same time
        await UPDATE(adminService.entities.RootEntity)
        .with({
            ID: "01234567-89ab-cdef-0123-987654fedcba",
            name: "RootEntity name changed",
            lifecycleStatus_code: "AC",
            child: [
                {
                    ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                    parent_ID: "01234567-89ab-cdef-0123-987654fedcba",
                    child: [
                        {
                            ID: "12ed5dd8-d45b-11ed-afa1-0242ac124446",
                            parent_ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                            title : "Level2Entity title changed"
                        },
                    ],
                },
            ],
        });
        const updateEntityChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Level2Entity",
                attribute: "title",
                modification: "update",
            }),
        );
        expect(updateEntityChanges.length).to.equal(1);
        const updateEntityChange = updateEntityChanges[0];
        expect(updateEntityChange.objectID).to.equal("Open");

        // Tests the object id when the parent node update and child node deletion occur simultaneously
        await UPDATE(adminService.entities.RootEntity)
        .with({
            ID: "01234567-89ab-cdef-0123-987654fedcba",
            name: "RootEntity name del",
            lifecycleStatus_code: "CL",
            child: [
                {
                    ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                    parent_ID: "01234567-89ab-cdef-0123-987654fedcba",
                    child: [],
                },
            ],
        });
        const deleteEntityChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Level2Entity",
                attribute: "title",
                modification: "delete",
            }),
        );
        expect(deleteEntityChanges.length).to.equal(1);
        const deleteEntityChange = deleteEntityChanges[0];
        expect(deleteEntityChange.objectID).to.equal("Closed");
    });

    it("8.3 Annotate fields from chained associated entities as displayed value (ERP4SMEPREPWORKAPPPLAT-4542)", async () => {
        const rootEntityData = [
            {
                ID: "01234567-89ab-cdef-0123-456789dcbafe",
                info_ID: "bc21e0d9-a313-4f52-8336-c1be5f88c346",
            },
        ];
        await INSERT.into(adminService.entities.RootEntity).entries(rootEntityData);
        let createChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.RootEntity",
            attribute: "info",
            modification: "create",
        });
        expect(createChanges.length).to.equal(1);
        const createChange = createChanges[0];
        expect(createChange.valueChangedFrom).to.equal("");
        expect(createChange.valueChangedTo).to.equal("Super Mario1");

        await UPDATE(adminService.entities.RootEntity, "01234567-89ab-cdef-0123-456789dcbafe").with({
            info_ID: "bc21e0d9-a313-4f52-8336-c1be5f44f435",
        });

        let updateChanges = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.RootEntity",
            attribute: "info",
            modification: "update",
        });
        expect(updateChanges.length).to.equal(1);
        const updateChange = updateChanges[0];
        expect(updateChange.valueChangedFrom).to.equal("Super Mario1");
        expect(updateChange.valueChangedTo).to.equal("Super Mario3");
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

        // CAP currently support run queries on the draft-enabled entity on application service, so we can re-enable it. (details in CAP/Issue#16292)
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
        cds.services.AdminService.entities.BookStoreRegistry["@changelog"] = [
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
        cds.services.AdminService.entities.BookStoreRegistry["@changelog"] = [{ "=": "code" }];
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

    it("Do not change track personal data", async () => {
        const allCustomers = await SELECT.from(adminService.entities.Customers);
        await UPDATE(adminService.entities.Customers).where({ ID: allCustomers[0].ID }).with({
            name: 'John Doe',
        });

        const changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Customers",
        });

        expect(changes.length).to.equal(0);
    });
});
