const cds = require("@sap/cds");
const bookshop = require("path").resolve(__dirname, "./../bookshop");
const { expect, data, POST, PATCH, DELETE } = cds.test(bookshop);
const { RequestSend } = require("../utils/api");

jest.setTimeout(5 * 60 * 1000);

let adminService = null;
let ChangeView = null;
let db = null;
let ChangeEntity = null;
let utils = null;

describe("change log integration test", () => {
    beforeAll(async () => {
        adminService = await cds.connect.to("AdminService");
        ChangeView = adminService.entities.ChangeView;
        db = await cds.connect.to("sql:my.db");
        ChangeEntity = db.model.definitions["sap.changelog.Changes"];
        utils = new RequestSend(POST);
    });

    beforeEach(async () => {
        await data.reset();
    });

    it("2.1 Child entity creation - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b2",
                title: "test title",
                descr: "test descr",
                author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                stock: 1,
                price: 1.0,
                isUsed: true
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);
        const bookChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "books",
            })
        );
        expect(bookChanges.length).to.equal(1);

        const bookChange = bookChanges[0];
        expect(bookChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(bookChange.attribute).to.equal("Books");
        expect(bookChange.modification).to.equal("Create");
        expect(bookChange.objectID).to.equal("Shakespeare and Company");
        expect(bookChange.entity).to.equal("Book Store");
        expect(bookChange.valueChangedFrom).to.equal("");
        expect(bookChange.valueChangedTo).to.equal("test title");

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);

        const titleChange = titleChanges[0];
        expect(titleChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(titleChange.attribute).to.equal("Title");
        expect(titleChange.modification).to.equal("Create");
        expect(titleChange.objectID).to.equal("test title, Emily, Brontë");
        expect(titleChange.entity).to.equal("Book");
        expect(titleChange.valueChangedFrom).to.equal("");
        expect(titleChange.valueChangedTo).to.equal("test title");

        const authorChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "author",
            })
        );
        expect(authorChanges.length).to.equal(1);

        const authorChange = authorChanges[0];
        expect(authorChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(authorChange.attribute).to.equal("Author");
        expect(authorChange.modification).to.equal("Create");
        expect(authorChange.objectID).to.equal("test title, Emily, Brontë");
        expect(authorChange.entity).to.equal("Book");
        expect(authorChange.valueChangedFrom).to.equal("");
        expect(authorChange.valueChangedTo).to.equal("Emily, Brontë");

        const isUsedChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "isUsed",
            })
        );
        expect(isUsedChanges.length).to.equal(1);
        const isUsedChange = isUsedChanges[0];
        expect(isUsedChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(isUsedChange.attribute).to.equal("isUsed");
        expect(isUsedChange.modification).to.equal("Create");
        expect(isUsedChange.objectID).to.equal("test title, Emily, Brontë");
        expect(isUsedChange.entity).to.equal("Book");
        expect(isUsedChange.valueChangedFrom).to.equal("");
        expect(isUsedChange.valueChangedTo).to.equal("true");
    });

    it("2.2 Child entity update - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const action = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
            title: "new title",
            author_ID: "47f97f40-4f41-488a-b10b-a5725e762d5e",
            genre_ID: 16,
            isUsed: false
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);
        const bookChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "books",
            })
        );
        expect(bookChanges.length).to.equal(1);

        const bookChange = bookChanges[0];
        expect(bookChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(bookChange.attribute).to.equal("Books");
        expect(bookChange.modification).to.equal("Update");
        expect(bookChange.objectID).to.equal("Shakespeare and Company");
        expect(bookChange.entity).to.equal("Book Store");
        expect(bookChange.valueChangedFrom).to.equal("new title");
        expect(bookChange.valueChangedTo).to.equal("new title");

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);

        const titleChange = titleChanges[0];
        expect(titleChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(titleChange.attribute).to.equal("Title");
        expect(titleChange.modification).to.equal("Update");
        expect(titleChange.objectID).to.equal("new title, Charlotte, Brontë");
        expect(titleChange.entity).to.equal("Book");
        expect(titleChange.valueChangedFrom).to.equal("Wuthering Heights");
        expect(titleChange.valueChangedTo).to.equal("new title");

        // author has specify object ID
        const authorChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "author",
            })
        );
        expect(authorChanges.length).to.equal(1);

        const authorChange = authorChanges[0];
        expect(authorChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(authorChange.attribute).to.equal("Author");
        expect(authorChange.modification).to.equal("Update");
        expect(authorChange.objectID).to.equal("new title, Charlotte, Brontë");
        expect(authorChange.entity).to.equal("Book");
        expect(authorChange.valueChangedFrom).to.equal("Emily, Brontë");
        expect(authorChange.valueChangedTo).to.equal("Charlotte, Brontë");

        // genre has not specify object ID, record changes of technical ID
        const genreChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "genre",
            })
        );
        expect(genreChanges.length).to.equal(1);

        const genreChange = genreChanges[0];
        expect(genreChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(genreChange.attribute).to.equal("Genres");
        expect(genreChange.modification).to.equal("Update");
        expect(genreChange.objectID).to.equal("new title, Charlotte, Brontë");
        expect(genreChange.entity).to.equal("Book");
        expect(genreChange.valueChangedFrom).to.equal("11");
        expect(genreChange.valueChangedTo).to.equal("16");

        const isUsedChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "isUsed",
            })
        );
        expect(isUsedChanges.length).to.equal(1);
        const isUsedChange = isUsedChanges[0];
        expect(isUsedChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(isUsedChange.attribute).to.equal("isUsed");
        expect(isUsedChange.modification).to.equal("Update");
        expect(isUsedChange.objectID).to.equal("new title, Charlotte, Brontë");
        expect(isUsedChange.entity).to.equal("Book");
        expect(isUsedChange.valueChangedFrom).to.equal("true");
        expect(isUsedChange.valueChangedTo).to.equal("false");

    });

    it("2.3 Child entity delete - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)", async () => {
        const action = DELETE.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`);
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const bookChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "books",
            })
        );
        expect(bookChanges.length).to.equal(1);

        const bookChange = bookChanges[0];
        expect(bookChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(bookChange.attribute).to.equal("Books");
        expect(bookChange.modification).to.equal("Delete");
        expect(bookChange.objectID).to.equal("Shakespeare and Company");
        expect(bookChange.entity).to.equal("Book Store");
        expect(bookChange.valueChangedFrom).to.equal("Wuthering Heights");
        expect(bookChange.valueChangedTo).to.equal("");

        const bookTitleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(bookTitleChanges.length).to.equal(1);

        const bookTitleChange = bookTitleChanges[0];
        expect(bookTitleChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(bookTitleChange.attribute).to.equal("Title");
        expect(bookTitleChange.modification).to.equal("Delete");
        expect(bookTitleChange.objectID).to.equal("Wuthering Heights, Emily, Brontë");
        expect(bookTitleChange.entity).to.equal("Book");
        expect(bookTitleChange.valueChangedFrom).to.equal("Wuthering Heights");
        expect(bookTitleChange.valueChangedTo).to.equal("");

        const bookAuthorChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "author",
            })
        );
        expect(bookAuthorChanges.length).to.equal(1);

        const bookAuthorChange = bookAuthorChanges[0];
        expect(bookAuthorChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(bookAuthorChange.attribute).to.equal("Author");
        expect(bookAuthorChange.modification).to.equal("Delete");
        expect(bookAuthorChange.objectID).to.equal("Wuthering Heights, Emily, Brontë");
        expect(bookAuthorChange.entity).to.equal("Book");
        expect(bookAuthorChange.valueChangedFrom).to.equal("Emily, Brontë");
        expect(bookAuthorChange.valueChangedTo).to.equal("");

        const volumnTitleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Volumns",
                attribute: "title",
            })
        );
        expect(volumnTitleChanges.length).to.equal(1);

        const volumnTitleChange = volumnTitleChanges[0];
        expect(volumnTitleChange.entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(volumnTitleChange.attribute).to.equal("Title");
        expect(volumnTitleChange.modification).to.equal("Delete");
        expect(volumnTitleChange.objectID).to.equal("Wuthering Heights I");
        expect(volumnTitleChange.entity).to.equal("Volumn");
        expect(volumnTitleChange.valueChangedFrom).to.equal("Wuthering Heights I");
        expect(volumnTitleChange.valueChangedTo).to.equal("");
    });

    it("2.4 Child entity update without objectID annotation - should log object type for object ID (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613 ERP4SMEPREPWORKAPPPLAT-538)", async () => {
        delete cds.services.AdminService.entities.Books["@changelog"];
        delete cds.services.AdminService.entities.BookStores["@changelog"];
        delete cds.db.entities.Books["@changelog"];
        delete cds.db.entities.BookStores["@changelog"];

        const action = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
            title: "new title",
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const changes = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(changes.length).to.equal(1);

        const change = changes[0];
        // if object type is localized, use the localized object type as object ID
        expect(change.objectID).to.equal("Book");
        expect(change.parentObjectID).to.equal("Book Store");

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];
        cds.services.AdminService.entities.BookStores["@changelog"] = [
            {
                "=": "name",
            },
        ];
    });

    it("4.1 Annotate multiple native and attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        // After appending object id as below, the object ID sequence should be:
        // title, author.name.firstName, author.name.lastName, stock, bookStore.name, bookStore.location
        cds.services.AdminService.entities.Books["@changelog"].push(
            { "=": "stock" },
            { "=": "bookStore.name" },
            { "=": "bookStore.location" }
        );

        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b2",
                title: "test title",
                descr: "test descr",
                author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                stock: 1,
                price: 1.0,
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);

        const titleChange = titleChanges[0];
        expect(titleChange.objectID).to.equal("test title, Emily, Brontë, 1, Shakespeare and Company, Paris");

        const authorChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "author",
            })
        );
        expect(authorChanges.length).to.equal(1);

        const authorChange = authorChanges[0];
        expect(authorChange.objectID).to.equal("test title, Emily, Brontë, 1, Shakespeare and Company, Paris");

        // After adjusting object id as below, the object ID sequence should be:
        // title, bookStore.name, bookStore.location, stock, author.name.firstName, author.name.lastName
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "bookStore.name" },
            { "=": "bookStore.location" },
            { "=": "stock" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];

        const actionPH = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
            title: "test title 1",
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", actionPH);

        const updateTitleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
                modification: "update",
            })
        );
        expect(updateTitleChanges.length).to.equal(1);

        const updateTitleChange = updateTitleChanges[0];
        expect(updateTitleChange.objectID).to.equal("test title 1, Shakespeare and Company, Paris, 1, Emily, Brontë");

        // After adjusting object id as below, the object ID sequence should be:
        // bookStore.name, title, bookStore.location, author.name.firstName, stock, author.name.lastName
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "bookStore.name" },
            { "=": "title" },
            { "=": "bookStore.location" },
            { "=": "author.name.firstName" },
            { "=": "stock" },
            { "=": "author.name.lastName" },
        ];

        const actionDE = DELETE.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`);
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", actionDE);

        const deleteTitleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
                modification: "delete",
            })
        );
        expect(deleteTitleChanges.length).to.equal(1);

        const deleteTitleChange = deleteTitleChanges[0];
        expect(deleteTitleChange.objectID).to.equal("Shakespeare and Company, test title 1, Paris, Emily, 1, Brontë");

        // Recover the object ID of entity Books as defined in admin-service
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];
    });

    it("4.2 Annotate multiple native attributes as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "price" },
            { "=": "title" },
            { "=": "stock" },
        ];

        const action = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
            title: "new title",
            author_ID: "47f97f40-4f41-488a-b10b-a5725e762d5e",
            genre_ID: 16,
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);

        const titleChange = titleChanges[0];
        expect(titleChange.objectID).to.equal("11.11, new title, 12");

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];
    });

    it("4.3 Annotate multiple attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)", async () => {
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "bookStore.location" },
            { "=": "author.name.lastName" },
            { "=": "author.name.firstName" },
            { "=": "bookStore.name" },
            { "=": "genre.ID" },
        ];

        const action = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
            title: "new title",
            author_ID: "47f97f40-4f41-488a-b10b-a5725e762d5e",
            genre_ID: 16,
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);

        const titleChange = titleChanges[0];
        expect(titleChange.objectID).to.equal("Paris, Brontë, Charlotte, Shakespeare and Company, 16");

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];
    });

    it("5.1 Value data type records data type of native attributes of the entity or attributes from association table which are annotated as the displayed value(ERP4SMEPREPWORKAPPPLAT-873)", async () => {
        cds.services.AdminService.entities.Books.elements.author_ID["@changelog"] = [
            { "=": "author.name.firstName" },
            { "=": "author.dateOfBirth" },
            { "=": "author.name.lastName" },
        ];

        cds.services.AdminService.entities.Books.elements.author["@changelog"] = [
            { "=": "author.name.firstName" },
            { "=": "author.dateOfBirth" },
            { "=": "author.name.lastName" },
        ];

        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b2",
                author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                title: "test title",
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const authorChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.Books",
            attribute: "author",
            modification: "create",
        });
        expect(authorChangesInDb.length).to.equal(1);

        const authorChangeInDb = authorChangesInDb[0];
        expect(authorChangeInDb.valueChangedFrom).to.equal("");
        expect(authorChangeInDb.valueChangedTo).to.equal("Emily, 1818-07-30, Brontë");
        expect(authorChangeInDb.valueDataType).to.equal("cds.String, cds.Date, cds.String");

        // recover @changelog annotation on the association table author
        cds.services.AdminService.entities.Books.elements.author_ID["@changelog"] = [
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];

        cds.services.AdminService.entities.Books.elements.author["@changelog"] = [
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];

        const actionPH = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
            author_ID: "47f97f40-4f41-488a-b10b-a5725e762d5e",
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", actionPH);

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const authorUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.Books",
            attribute: "author",
            modification: "update",
        });
        expect(authorUpdateChangesInDb.length).to.equal(1);

        const authorUpdateChangeInDb = authorUpdateChangesInDb[0];
        expect(authorUpdateChangeInDb.valueChangedFrom).to.equal("Emily, Brontë");
        expect(authorUpdateChangeInDb.valueChangedTo).to.equal("Charlotte, Brontë");
        expect(authorUpdateChangeInDb.valueDataType).to.equal("cds.String, cds.String");
    });

    it("5.2 Value data type records data type of native attributes of the entity or attributes from composition which are annotated as the displayed value (ERP4SMEPREPWORKAPPPLAT-873)", async () => {
        cds.services.AdminService.entities.BookStores.elements.books["@changelog"] = [
            { "=": "books.title" },
            { "=": "books.stock" },
            { "=": "books.price" },
        ];

        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b2",
                title: "test title",
                stock: 2,
                price: 2.3,
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const booksChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.BookStores",
            attribute: "books",
            modification: "create",
        });
        expect(booksChangesInDb.length).to.equal(1);

        const bookChangesInDb = booksChangesInDb[0];
        expect(bookChangesInDb.valueChangedFrom).to.equal("");
        expect(bookChangesInDb.valueChangedTo).to.equal("test title, 2, 2.3");
        expect(bookChangesInDb.valueDataType).to.equal("cds.String, cds.Integer, cds.Decimal");

        // adjust sequence
        cds.services.AdminService.entities.BookStores.elements.books["@changelog"] = [
            { "=": "books.stock" },
            { "=": "books.title" },
            { "=": "books.price" },
        ];

        const actionPH = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
            stock: 3,
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", actionPH);

        // valueDataType field only appears in db table Changes
        // there are no localization features for table Changes
        const booksUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
            entity: "sap.capire.bookshop.BookStores",
            attribute: "books",
            modification: "update",
        });
        expect(booksUpdateChangesInDb.length).to.equal(1);

        const bookUpdateChangesInDb = booksUpdateChangesInDb[0];
        expect(bookUpdateChangesInDb.valueChangedFrom).to.equal("3, test title, 2.3");
        expect(bookUpdateChangesInDb.valueChangedTo).to.equal("3, test title, 2.3");
        expect(bookUpdateChangesInDb.valueDataType).to.equal("cds.Integer, cds.String, cds.Decimal");

        // recover @changelog context on composition books
        cds.services.AdminService.entities.BookStores.elements.books["@changelog"] = [{ "=": "books.title" }];
    });

    it("6.1 Single attribute from the code list could be annotated as value (ERP4SMEPREPWORKAPPPLAT-1055)", async () => {
        // When BookStore is created, the lifecycle status will be set to "in preparation" by default
        const action = POST.bind({}, `/admin/BookStores`, {
            ID: "01234567-89ab-cdef-0123-456789abcdef",
            name: "test name",
        });

        await utils.apiAction(
            "admin",
            "BookStores",
            "01234567-89ab-cdef-0123-456789abcdef",
            "AdminService",
            action,
            true
        );

        const lifecycleStatusChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "lifecycleStatus",
            })
        );
        expect(lifecycleStatusChanges.length).to.equal(1);

        const lifecycleStatusChange = lifecycleStatusChanges[0];
        expect(lifecycleStatusChange.modification).to.equal("Create");
        expect(lifecycleStatusChange.valueChangedFrom).to.equal("");
        expect(lifecycleStatusChange.valueChangedTo).to.equal("In Preparation");

        const actionPH = PATCH.bind(
            {},
            `/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`,
            {
                lifecycleStatus: {
                    code: "CL",
                },
            }
        );

        await utils.apiAction("admin", "BookStores", "01234567-89ab-cdef-0123-456789abcdef", "AdminService", actionPH);

        const lifecycleStatusUpdateChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "lifecycleStatus",
                modification: "update",
            })
        );
        expect(lifecycleStatusUpdateChanges.length).to.equal(1);

        const lifecycleStatusUpdateChange = lifecycleStatusUpdateChanges[0];
        expect(lifecycleStatusUpdateChange.modification).to.equal("Update");
        expect(lifecycleStatusUpdateChange.valueChangedFrom).to.equal("In Preparation");
        expect(lifecycleStatusUpdateChange.valueChangedTo).to.equal("Closed");
    });

    it("6.2 Multiple attributes from the code list could be annotated as value (ERP4SMEPREPWORKAPPPLAT-1055)", async () => {
        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "7e9d4199-4602-47f1-8767-85dae82ce639",
                bookType: {
                    code: "MAN",
                },
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const bookTypeChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "bookType",
            })
        );
        expect(bookTypeChanges.length).to.equal(1);

        const bookTypeChange = bookTypeChanges[0];
        expect(bookTypeChange.modification).to.equal("Create");
        expect(bookTypeChange.valueChangedFrom).to.equal("");
        expect(bookTypeChange.valueChangedTo).to.equal("Management, Management Books");

        const actionPH = PATCH.bind({}, `/admin/Books(ID=7e9d4199-4602-47f1-8767-85dae82ce639,IsActiveEntity=false)`, {
            bookType: {
                code: "SCI",
            },
        });

        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", actionPH);

        const bookTypeUpdateChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "bookType",
                modification: "update",
            })
        );
        expect(bookTypeUpdateChanges.length).to.equal(1);

        const bookTypeUpdateChange = bookTypeUpdateChanges[0];
        expect(bookTypeUpdateChange.modification).to.equal("Update");
        expect(bookTypeUpdateChange.valueChangedFrom).to.equal("Management, Management Books");
        expect(bookTypeUpdateChange.valueChangedTo).to.equal("Science, Science Books");
    });

    it("6.3 Attributes from the code list could be annotated as object ID (ERP4SMEPREPWORKAPPPLAT-1055)", async () => {
        cds.services.AdminService.entities.BookStores["@changelog"] = [
            { "=": "name" },
            { "=": "lifecycleStatus.name" },
        ];

        const action = POST.bind({}, `/admin/BookStores`, {
            ID: "01234567-89ab-cdef-0123-456789abcdef",
            name: "test name",
        });

        await utils.apiAction(
            "admin",
            "BookStores",
            "01234567-89ab-cdef-0123-456789abcdef",
            "AdminService",
            action,
            true
        );

        const lifecycleStatusChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "lifecycleStatus",
                modification: "create",
            })
        );
        expect(lifecycleStatusChanges.length).to.equal(1);

        const lifecycleStatusChange = lifecycleStatusChanges[0];
        expect(lifecycleStatusChange.modification).to.equal("Create");
        expect(lifecycleStatusChange.objectID).to.equal("test name, In Preparation");

        cds.services.AdminService.entities.BookStores["@changelog"] = [
            { "=": "lifecycleStatus.name" },
            { "=": "name" },
        ];
        const actionPH = PATCH.bind(
            {},
            `/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`,
            {
                lifecycleStatus: {
                    code: "CL",
                },
                name: "new test name",
            }
        );

        await utils.apiAction("admin", "BookStores", "01234567-89ab-cdef-0123-456789abcdef", "AdminService", actionPH);

        const lifecycleStatusUpdateChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "lifecycleStatus",
                modification: "update",
            })
        );
        expect(lifecycleStatusUpdateChanges.length).to.equal(1);

        const lifecycleStatusUpdateChange = lifecycleStatusUpdateChanges[0];
        expect(lifecycleStatusUpdateChange.modification).to.equal("Update");
        expect(lifecycleStatusUpdateChange.objectID).to.equal("Closed, new test name");

        cds.services.AdminService.entities.BookStores["@changelog"] = [{ "=": "name" }];
    });

    it("7.1 Annotate fields from chained associated entities as objectID (ERP4SMEPREPWORKAPPPLAT-993)", async () => {
        cds.services.AdminService.entities.BookStores["@changelog"].push({ "=": "city.name" })
        
        const createBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
            ID: "9d703c23-54a8-4eff-81c1-cdce6b6587c4",
            name: "new name",
        });
        await utils.apiAction(
            "admin",
            "BookStores",
            "9d703c23-54a8-4eff-81c1-cdce6b6587c4",
            "AdminService",
            createBookStoresAction,
            true
        );

        const BookStoresChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "name",
            })
        );
        expect(BookStoresChanges.length).to.equal(1);
        const BookStoresChange = BookStoresChanges[0];
        expect(BookStoresChange.objectID).to.equal("new name");

        delete cds.services.AdminService.entities.BookStores["@changelog"];

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "bookStore.lifecycleStatus.name" },
            { "=": "bookStore.location" },
            { "=": "bookStore.city.name" },
            { "=": "bookStore.city.country.countryName.code" },
        ];

        const action = PATCH.bind({}, `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
            title: "new title",
            author_ID: "47f97f40-4f41-488a-b10b-a5725e762d5e",
        });
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const titleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
            })
        );
        expect(titleChanges.length).to.equal(1);
        const titleChange = titleChanges[0];
        expect(titleChange.objectID).to.equal("In Preparation, Paris, Paris, FR");

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "bookStore.lifecycleStatus.name" },
            { "=": "bookStore.city.country.countryName.name" },
        ];

        const deleteAction = DELETE.bind(
            {},
            `/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`
        );
        await utils.apiAction(
            "admin",
            "BookStores",
            "64625905-c234-4d0d-9bc1-283ee8946770",
            "AdminService",
            deleteAction
        );

        const deleteTitleChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
                modification: "delete",
            })
        );
        expect(deleteTitleChanges.length).to.equal(1);
        const deleteTitleChange = deleteTitleChanges[0];
        expect(deleteTitleChange.objectID).to.equal("new title, In Preparation, France");

        // Check object ID "bookStore.city.country.countryName.code" when creating BookStores/Books
        // (parent/child) at the same time.
        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "bookStore.city.country.countryName.code" },
        ];

        const createBooksAndBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
            ID: "48268451-8552-42a6-a3d7-67564be86634",
            city_ID: "60b4c55d-ec87-4edc-84cb-2e4ecd60de48",
            books: [
                {
                    ID: "12ed5dd8-d45b-11ed-afa1-1942bd119007",
                    title: "New title",
                },
            ],
        });

        await utils.apiAction(
            "admin",
            "BookStores",
            "48268451-8552-42a6-a3d7-67564be86634",
            "AdminService",
            createBooksAndBookStoresAction,
            true,
        );

        const createBooksAndBookStoresChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.Books",
                attribute: "title",
                modification: "create",
            }),
        );
        expect(createBooksAndBookStoresChanges.length).to.equal(1);
        const createBooksAndBookStoresChange = createBooksAndBookStoresChanges[0];
        expect(createBooksAndBookStoresChange.objectID).to.equal("USA");

        cds.services.AdminService.entities.Books["@changelog"] = [
            { "=": "title" },
            { "=": "author.name.firstName" },
            { "=": "author.name.lastName" },
        ];
    });

    it("8.1 Annotate fields from chained associated entities as displayed value (ERP4SMEPREPWORKAPPPLAT-1094)", async () => {
        const action = POST.bind({}, `/admin/BookStores`, {
            ID: "01234567-89ab-cdef-0123-456789abcdef",
            city_ID: "bc21e0d9-a313-4f52-8336-c1be5f66e257",
        });

        await utils.apiAction(
            "admin",
            "BookStores",
            "01234567-89ab-cdef-0123-456789abcdef",
            "AdminService",
            action,
            true
        );

        const cityChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "city",
                modification: "create",
            })
        );
        expect(cityChanges.length).to.equal(1);

        const cityChange = cityChanges[0];
        expect(cityChange.modification).to.equal("Create");
        expect(cityChange.valueChangedFrom).to.equal("");
        expect(cityChange.valueChangedTo).to.equal("Paris, FR");

        const updateAction = PATCH.bind(
            {},
            `/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`,
            {
                city_ID: "60b4c55d-ec87-4edc-84cb-2e4ecd60de48",
            }
        );
        await utils.apiAction(
            "admin",
            "BookStores",
            "01234567-89ab-cdef-0123-456789abcdef",
            "AdminService",
            updateAction
        );

        const updateCityChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStores",
                attribute: "city",
                modification: "update",
            })
        );
        expect(updateCityChanges.length).to.equal(1);
        const updateCityChange = updateCityChanges[0];
        expect(updateCityChange.valueChangedFrom).to.equal("Paris, FR");
        expect(updateCityChange.valueChangedTo).to.equal("New York, USA");
    });

    it("9.1 Localization should handle the cases that reading the change view without required parameters obtained (ERP4SMEPREPWORKAPPPLAT-1414)", async () => {
        delete cds.services.AdminService.entities.BookStores["@changelog"];
        const action = POST.bind(
            {},
            `/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`,
            {
                ID: "9d703c23-54a8-4eff-81c1-cdce6b8376b2",
                title: "test title",
                descr: "test descr",
                author_ID: "d4d4a1b3-5b83-4814-8a20-f039af6f0387",
                stock: 1,
                price: 1.0,
            }
        );
        await utils.apiAction("admin", "BookStores", "64625905-c234-4d0d-9bc1-283ee8946770", "AdminService", action);

        const selectedColumns = ["attribute", "modification", "entity", "objectID", "parentObjectID"];
        const bookElementChanges = [];
        for (const selectedColumn of selectedColumns) {
            const bookChanges = await adminService.run(
                SELECT.from(ChangeView)
                    .where({
                        entity: "sap.capire.bookshop.BookStores",
                        attribute: "books",
                    })
                    .columns(`${selectedColumn}`)
            );
            bookElementChanges.push(bookChanges[0]);
        }

        // To do localization, attribute needs parameters attribute and service entity, so the localization could not be done
        const bookChangeAttr = bookElementChanges[0];
        expect(bookChangeAttr.attribute).to.equal("books");

        // To do localization, modification only needs parameters modification itself, so the localization could be done
        const bookChangeModification = bookElementChanges[1];
        expect(bookChangeModification.modification).to.equal("Create");

        // To do localization, entity only needs parameters entity itself, so the localization could be done
        const bookChangeEntity = bookElementChanges[2];
        expect(bookChangeEntity.entity).to.equal("sap.capire.bookshop.BookStores");

        // To do localization, object id needs parameters entity (if no object id is annotated), so the localization could not be done
        // If no object id is annotated, the real value stored in db of object id should be "".
        const bookChangeObjectId = bookElementChanges[3];
        expect(bookChangeObjectId.objectID).to.equal("");

        cds.services.AdminService.entities.BookStores["@changelog"] = [
            {
                "=": "name",
            },
        ];
    });

    it("10.4 Composition of one node creation - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913)", async () => {
        const action = POST.bind({}, `/admin/BookStores`, {
            ID: "01234567-89ab-cdef-0123-456789abcdef",
            name: "Murder on the Orient Express",
            registry: {
                ID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                code: "San Francisco-2",
                validOn: "2022-01-01",
                DraftAdministrativeData: {
                    DraftUUID: "12ed5dd8-d45b-11ed-afa1-0242ac120003",
                },
            },
        });
        await utils.apiAction(
            "admin",
            "BookStores",
            "01234567-89ab-cdef-0123-456789abcdef",
            "AdminService",
            action,
            true
        );

        const registryChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStoreRegistry",
                attribute: "validOn",
            })
        );

        expect(registryChanges.length).to.equal(1);
        const registryChange = registryChanges[0];
        expect(registryChange.entityKey).to.equal("01234567-89ab-cdef-0123-456789abcdef");
        expect(registryChange.attribute).to.equal("Valid On");
        expect(registryChange.modification).to.equal("Create");
        expect(registryChange.objectID).to.equal("San Francisco-2");
        expect(registryChange.entity).to.equal("Book Store Registry");
        expect(registryChange.valueChangedFrom).to.equal("");
        expect(registryChange.valueChangedTo).to.equal("2022-01-01");
        expect(registryChange.parentKey).to.equal("01234567-89ab-cdef-0123-456789abcdef");
        expect(registryChange.parentObjectID).to.equal("Murder on the Orient Express");
    });

    it("10.5.1 Composition of one node updated on root node - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913)", async () => {
        const action = PATCH.bind(
            {},
            `/admin/BookStores(ID=5ab2a87b-3a56-4d97-a697-7af72334a384,IsActiveEntity=false)`,
            {
                registry: {
                    ID: "12ed5dd8-d45b-11ed-afa1-0242ac120001",
                    validOn: "2022-01-01",
                    DraftAdministrativeData: {
                        DraftUUID: "12ed5dd8-d45b-11ed-afa1-0242ac120004",
                    },
                },
            }
        );
        await utils.apiAction("admin", "BookStores", "5ab2a87b-3a56-4d97-a697-7af72334a384", "AdminService", action);

        const registryChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStoreRegistry",
                attribute: "validOn",
            })
        );
        expect(registryChanges.length).to.equal(1);
        const registryChange = registryChanges[0];
        expect(registryChange.attribute).to.equal("Valid On");
        expect(registryChange.modification).to.equal("Update");
        expect(registryChange.valueChangedFrom).to.equal("2022-10-15");
        expect(registryChange.valueChangedTo).to.equal("2022-01-01");
        expect(registryChange.parentKey).to.equal("5ab2a87b-3a56-4d97-a697-7af72334a384");
        expect(registryChange.parentObjectID).to.equal("The Strand");
    });

    it("10.5.2 Composition of one node updated on child node - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913)", async () => {
        // Update by calling API on child node
        const action = PATCH.bind(
            {},
            `/admin/BookStoreRegistry(ID=12ed5dd8-d45b-11ed-afa1-0242ac120002,IsActiveEntity=false)`,
            {
                validOn: "2022-01-01",
            }
        );
        await utils.apiAction("admin", "BookStores", "8aaed432-8336-4b0d-be7e-3ef1ce7f13ea", "AdminService", action);
        const registryChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStoreRegistry",
                attribute: "validOn",
            })
        );
        expect(registryChanges.length).to.equal(1);
        const registryChange = registryChanges[0];
        expect(registryChange.attribute).to.equal("Valid On");
        expect(registryChange.modification).to.equal("Update");
        expect(registryChange.valueChangedFrom).to.equal("2018-09-01");
        expect(registryChange.valueChangedTo).to.equal("2022-01-01");
        expect(registryChange.parentKey).to.equal("8aaed432-8336-4b0d-be7e-3ef1ce7f13ea");
        expect(registryChange.parentObjectID).to.equal("City Lights Books");
    });

    it("10.6 Composition of one node deleted - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913)", async () => {
        const action = DELETE.bind(
            {},
            `/admin/BookStoreRegistry(ID=12ed5dd8-d45b-11ed-afa1-0242ac120002,IsActiveEntity=false)`
        );
        await utils.apiAction("admin", "BookStores", "8aaed432-8336-4b0d-be7e-3ef1ce7f13ea", "AdminService", action);
        const registryChanges = await adminService.run(
            SELECT.from(ChangeView).where({
                entity: "sap.capire.bookshop.BookStoreRegistry",
                attribute: "validOn",
            })
        );
        expect(registryChanges.length).to.equal(1);
        const registryChange = registryChanges[0];
        expect(registryChange.attribute).to.equal("Valid On");
        expect(registryChange.modification).to.equal("Delete");
        expect(registryChange.valueChangedFrom).to.equal("2018-09-01");
        expect(registryChange.valueChangedTo).to.equal("");
        expect(registryChange.parentKey).to.equal("8aaed432-8336-4b0d-be7e-3ef1ce7f13ea");
        expect(registryChange.parentObjectID).to.equal("City Lights Books");
    });

    it("11.1 The change log should be captured when a child entity in draft-enabled mode triggers a custom action (ERP4SMEPREPWORKAPPPLAT-6211)", async () => {
        await POST(
            `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=true)/books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=true)/volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf,IsActiveEntity=true)/AdminService.activate`,
            {
                ActivationStatus_code: "VALID",
            },
        );
        let changes = await SELECT.from(ChangeView).where({
            entity: "sap.capire.bookshop.Volumns",
            attribute: "ActivationStatus",
        });
        expect(changes.length).to.equal(1);
        expect(changes[0].valueChangedFrom).to.equal("");
        expect(changes[0].valueChangedTo).to.equal("VALID");
        expect(changes[0].entityKey).to.equal("64625905-c234-4d0d-9bc1-283ee8946770");
        expect(changes[0].parentKey).to.equal("9d703c23-54a8-4eff-81c1-cdce6b8376b1");
    });
});
