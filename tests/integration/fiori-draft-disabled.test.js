const cds = require("@sap/cds");
const bookshop = require("path").resolve(__dirname, "./../bookshop");
const { expect, data, POST, PATCH, DELETE } = cds.test(bookshop);

jest.setTimeout(5 * 60 * 1000);

let adminService = null;
let ChangeView = null;
let db = null;
let ChangeEntity = null;

describe("change log draft disabled test", () => {
    beforeAll(async () => {
        adminService = await cds.connect.to("AdminService");
        ChangeView = adminService.entities.ChangeView;
        db = await cds.connect.to("sql:my.db");
        ChangeEntity = db.model.definitions["sap.sme.changelog.Changes"];
    });

    beforeEach(async () => {
        await data.reset();
    });

    it("1.1 Root entity creation - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const author = await POST(`/admin/Authors`, {
            name_firstName: "Sam",
            name_lastName: "Smiths",
            placeOfBirth: "test place",
        });

        const changes = await adminService.run(SELECT.from(ChangeView));
        const nameLog = changes.find((change) => change.attribute === "Author Name");
        const placeOfBirthLog = changes.find((change) => change.attribute === "Place Of Birth");

        expect(nameLog).to.not.be.undefined;
        expect(nameLog.entityKey).to.equal(author.data.ID);
        expect(nameLog.modification).to.equal("Create");
        expect(nameLog.objectID).to.equal("Sam, Smiths");
        expect(nameLog.entity).to.equal("Author");
        expect(!nameLog.parentObjectID).to.be.true;
        expect(!nameLog.parentKey).to.be.true;
        expect(nameLog.valueChangedFrom).to.equal("");
        expect(nameLog.valueChangedTo).to.equal("Sam");

        expect(placeOfBirthLog).to.not.be.undefined;
        expect(placeOfBirthLog.entityKey).to.equal(author.data.ID);
        expect(placeOfBirthLog.modification).to.equal("Create");
        expect(placeOfBirthLog.objectID).to.equal("Sam, Smiths");
        expect(placeOfBirthLog.entity).to.equal("Author");
        expect(!placeOfBirthLog.parentObjectID).to.be.true;
        expect(!placeOfBirthLog.parentKey).to.be.true;
        expect(placeOfBirthLog.valueChangedFrom).to.equal("");
        expect(placeOfBirthLog.valueChangedTo).to.equal("test place");
    });

    it("1.2 Root entity update - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        await PATCH(`/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
            placeOfBirth: "new placeOfBirth",
        });

        const changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);

        const change = changes[0];
        expect(change.attribute).to.equal("Place Of Birth");
        expect(change.entityKey).to.equal("d4d4a1b3-5b83-4814-8a20-f039af6f0387");
        expect(change.modification).to.equal("Update");
        expect(change.objectID).to.equal("Emily, Brontë");
        expect(change.entity).to.equal("Author");
        expect(!change.parentObjectID).to.be.true;
        expect(!change.parentKey).to.be.true;
        expect(change.valueChangedFrom).to.equal("Thornton, Yorkshire");
        expect(change.valueChangedTo).to.equal("new placeOfBirth");
    });

    it("1.3 Root entity delete - should delete related changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const author = await POST(`/admin/Authors`, {
            name_firstName: "Sam",
            name_lastName: "Smiths",
            placeOfBirth: "test place",
        });

        const beforeChanges = await adminService.run(SELECT.from(ChangeView));
        expect(beforeChanges.length > 0).to.be.true;

        await DELETE(`/admin/Authors(ID=${author.data.ID})`);

        const afterChanges = await adminService.run(SELECT.from(ChangeView));
        expect(afterChanges.length).to.equal(0);
    });

    it("3.1 Composition creatition by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)", async () => {
        await POST(
            `/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes`,
            {
                content: "new content",
            }
        );
        let changes = await adminService.run(SELECT.from(ChangeView));
        const orderChanges = changes.filter((change) => {
            return change.entityKey === "0a41a187-a2ff-4df6-bd12-fae8996e6e31";
        });
        expect(orderChanges.length).to.equal(1);
        const orderChange = orderChanges[0];
        expect(orderChange.entity).to.equal("sap.capire.bookshop.OrderItemNote");
        expect(orderChange.attribute).to.equal("content");
        expect(orderChange.modification).to.equal("Create");
        expect(orderChange.valueChangedFrom).to.equal("");
        expect(orderChange.valueChangedTo).to.equal("new content");
        expect(orderChange.parentKey).to.equal("9a61178f-bfb3-4c17-8d17-c6b4a63e0097");
        expect(orderChange.parentObjectID).to.equal("sap.capire.bookshop.OrderItem");
    });

    it("3.2 Composition update by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)", async () => {
        await PATCH(
            `/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`,
            {
                content: "new content",
            }
        );

        let changes = await adminService.run(SELECT.from(ChangeView));
        const orderChanges = changes.filter((change) => {
            return change.entityKey === "0a41a187-a2ff-4df6-bd12-fae8996e6e31";
        });
        expect(orderChanges.length).to.equal(1);
        const orderChange = orderChanges[0];
        expect(orderChange.entity).to.equal("sap.capire.bookshop.OrderItemNote");
        expect(orderChange.attribute).to.equal("content");
        expect(orderChange.modification).to.equal("Update");
        expect(orderChange.valueChangedFrom).to.equal("note 1");
        expect(orderChange.valueChangedTo).to.equal("new content");
        expect(orderChange.parentKey).to.equal("9a61178f-bfb3-4c17-8d17-c6b4a63e0097");
        expect(orderChange.parentObjectID).to.equal("sap.capire.bookshop.OrderItem");
    });

    it("3.3 Composition delete by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)", async () => {
        await DELETE(
            `/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`
        );

        let changes = await adminService.run(SELECT.from(ChangeView));
        const orderChanges = changes.filter((change) => {
            return change.entityKey === "0a41a187-a2ff-4df6-bd12-fae8996e6e31";
        });
        expect(orderChanges.length).to.equal(1);
        const orderChange = orderChanges[0];
        expect(orderChange.entity).to.equal("sap.capire.bookshop.OrderItemNote");
        expect(orderChange.attribute).to.equal("content");
        expect(orderChange.modification).to.equal("Delete");
        expect(orderChange.valueChangedFrom).to.equal("note 1");
        expect(orderChange.valueChangedTo).to.equal("");
        expect(orderChange.parentKey).to.equal("9a61178f-bfb3-4c17-8d17-c6b4a63e0097");
        expect(orderChange.parentObjectID).to.equal("sap.capire.bookshop.OrderItem");
    });

    it("3.4 Composition create by odata request on draft disabled entity - should log changes for root entity if url path contains association entity (ERP4SMEPREPWORKAPPPLAT-670)", async () => {
        // Report has association to many Orders, changes on OrderItem shall be logged on Order
        await POST(
            `admin/Report(ID=0a41a666-a2ff-4df6-bd12-fae8996e6666)/orders(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems`,
            {
                order_ID: "0a41a187-a2ff-4df6-bd12-fae8996e6e31",
                quantity: 10,
                price: 5,
            }
        );

        let changes = await adminService.run(SELECT.from(ChangeView));
        const orderChanges = changes.filter((change) => {
            return change.entityKey === "0a41a187-a2ff-4df6-bd12-fae8996e6e31";
        });
        expect(orderChanges.length).to.equal(2);
    });

    it("4.1 Annotate multiple native and attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        cds.services.AdminService.entities.OrderItem["@changehistory.objectID"] = [
            { "=": "customer.city" },
            { "=": "order.status" },
            { "=": "price" },
            { "=": "quantity" },
        ];
        await PATCH(`/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
            quantity: 14,
        });

        let changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);
        const change = changes[0];
        expect(change.objectID).to.equal("Ōsaka, Post, 5, 14");

        delete cds.services.AdminService.entities.OrderItem["@changehistory.objectID"];
    });

    it("4.2 Annotate multiple native attributes as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        cds.services.AdminService.entities.Authors["@changehistory.objectID"] = [
            { "=": "placeOfBirth" },
            { "=": "name.firstName" },
            { "=": "name.lastName" },
            { "=": "placeOfDeath" },
            { "=": "dateOfDeath" },
            { "=": "dateOfBirth" },
        ];
        await PATCH(`/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
            placeOfBirth: "new placeOfBirth",
        });

        const changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);

        const change = changes[0];
        expect(change.objectID).to.equal("new placeOfBirth, Emily, Brontë, Haworth, Yorkshire, 1848-12-19, 1818-07-30");

        cds.services.AdminService.entities.Authors["@changehistory.objectID"] = [
            { "=": "name.firstName" },
            { "=": "name.lastName" },
        ];
    });

    it("4.3 Annotate multiple attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        cds.services.AdminService.entities.OrderItem["@changehistory.objectID"] = [
            { "=": "customer.city" },
            { "=": "order.status" },
            { "=": "customer.country" },
            { "=": "customer.name" },
        ];
        await PATCH(`/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
            quantity: 14,
        });

        let changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);
        const change = changes[0];
        expect(change.objectID).to.equal("Ōsaka, Post, Japan, Honda");

        delete cds.services.AdminService.entities.OrderItem["@changehistory.objectID"];
    });

    it("5.1 value data type records data type of native attributes of the entity or attributes from association table which are annotated as the displayed value(ERP4SMEPREPWORKAPPPLAT-873)", async () => {
        await POST(`/admin/OrderItem`, {
            ID: "9a61178f-bfb3-4c17-8d17-c6b4a63e0422",
            customer_ID: "47f97f40-4f41-488a-b10b-a5725e762d57",
            quantity: 27,
        });

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const customerChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.OrderItem",
            attribute: "customer",
            modification: "create",
        });
        expect(customerChangesInDb.length).to.equal(1);

        const customerChangeInDb = customerChangesInDb[0];
        expect(customerChangeInDb.valueChangedFrom).to.equal("");
        expect(customerChangeInDb.valueChangedTo).to.equal("Japan, Honda, Ōsaka");
        expect(customerChangeInDb.valueDataType).to.equal("cds.String, cds.String, cds.String");

        await PATCH(`/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
            customer_ID: "5c30d395-db0a-4095-bd7e-d4de3464660a",
        });

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const customerUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.OrderItem",
            attribute: "customer",
            modification: "update",
        });
        expect(customerUpdateChangesInDb.length).to.equal(1);

        const customerUpdateChangeInDb = customerUpdateChangesInDb[0];
        expect(customerUpdateChangeInDb.valueChangedFrom).to.equal("Japan, Honda, Ōsaka");
        expect(customerUpdateChangeInDb.valueChangedTo).to.equal("America, Dylan, Dallas");
        expect(customerUpdateChangeInDb.valueDataType).to.equal("cds.String, cds.String, cds.String");
    });

    it("7.2 Annotate fields from chained associated entities as objectID (ERP4SMEPREPWORKAPPPLAT-993)", async () => {
        cds.services.AdminService.entities.OrderItem["@changehistory.objectID"] = [
            { "=": "order.report.comment" },
            { "=": "order.status" },
            { "=": "customer.name" },
        ];
        await PATCH(`/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
            quantity: 14,
        });

        let changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);
        const change = changes[0];
        expect(change.objectID).to.equal("some comment, Post, Honda");

        delete cds.services.AdminService.entities.OrderItem["@changehistory.objectID"];
    });

    it("8.2 Annotate fields from chained associated entities as displayed value (ERP4SMEPREPWORKAPPPLAT-1094)", async () => {
        await PATCH(`/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
            order_ID: "6ac4afbf-deda-45ae-88e6-2883157cc010",
        });

        let changes = await adminService.run(SELECT.from(ChangeView));
        expect(changes.length).to.equal(1);
        const change = changes[0];
        expect(change.valueChangedTo).to.equal("some report comment, Post");
    });

    it("10.1 Composition of one creatition by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        await POST(`/admin/Order`, {
            ID: "11234567-89ab-cdef-0123-456789abcdef",
            header: {
                status: "Ordered",
            },
        });
        const changes = await adminService.run(SELECT.from(ChangeView));
        const headerChanges = changes.filter((change) => {
            return change.entity === "sap.capire.bookshop.OrderHeader";
        });
        expect(headerChanges.length).to.equal(1);
        const headerChange = headerChanges[0];
        expect(headerChange.attribute).to.equal("status");
        expect(headerChange.modification).to.equal("Create");
        expect(headerChange.valueChangedFrom).to.equal("");
        expect(headerChange.valueChangedTo).to.equal("Ordered");
        expect(headerChange.parentKey).to.equal("11234567-89ab-cdef-0123-456789abcdef");
        expect(headerChange.parentObjectID).to.equal("sap.capire.bookshop.Order");
    });

    it("10.2 Composition of one update by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        cds.services.AdminService.entities.Order["@changehistory.objectID"] = [{ "=": "status" }];
        await PATCH(`/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)`, {
            header: {
                ID: "8567d0de-d44f-11ed-afa1-0242ac120002",
                status: "Ordered",
            },
        });

        const changes = await adminService.run(SELECT.from(ChangeView));
        const headerChanges = changes.filter((change) => {
            return change.entity === "sap.capire.bookshop.OrderHeader";
        });
        expect(headerChanges.length).to.equal(1);
        const headerChange = headerChanges[0];
        expect(headerChange.attribute).to.equal("status");
        expect(headerChange.modification).to.equal("Update");
        expect(headerChange.valueChangedFrom).to.equal("Shipped");
        expect(headerChange.valueChangedTo).to.equal("Ordered");
        expect(headerChange.parentKey).to.equal("0a41a187-a2ff-4df6-bd12-fae8996e6e31");
        expect(headerChange.parentObjectID).to.equal("Post");
        delete cds.services.AdminService.entities.Order["@changehistory.objectID"];
    });

    it("10.3 Composition of one delete by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)", async () => {
        // Check if the object ID obtaining failed due to lacking parentKey would lead to dump
        cds.services.AdminService.entities.Order["@changehistory.objectID"] = [{ "=": "status" }];
        await DELETE(`/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/header`);

        const changes = await adminService.run(SELECT.from(ChangeView));
        const headerChanges = changes.filter((change) => {
            return change.entity === "sap.capire.bookshop.OrderHeader";
        });
        expect(headerChanges.length).to.equal(1);
        const headerChange = headerChanges[0];
        expect(headerChange.attribute).to.equal("status");
        expect(headerChange.modification).to.equal("Delete");
        expect(headerChange.valueChangedFrom).to.equal("Shipped");
        expect(headerChange.valueChangedTo).to.equal("");
        expect(headerChange.parentKey).to.equal("0a41a187-a2ff-4df6-bd12-fae8996e6e31");
        expect(headerChange.parentObjectID).to.equal("Post");
        delete cds.services.AdminService.entities.Order["@changehistory.objectID"];
    });
});
