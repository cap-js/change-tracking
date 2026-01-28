const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, '../bookshop');

describe('ObjectID - Human-readable IDs', () => {
    const { data } = cds.test(bookshop);
    let service, ChangeView;

    beforeAll(async () => {
        service = await cds.connect.to('ObjectIdTestService');
        ChangeView = service.entities.ChangeView;
    });

    beforeEach(async () => {
        await data.reset();
    });

    afterEach(() => {
        Object.assign(cds.env.requires['change-tracking'], {
            preserveDeletes: false,
            disableCreateTracking: false,
            disableUpdateTracking: false,
            disableDeleteTracking: false
        });
    });

    describe('Single Field ObjectID', () => {
        it('should use single field as objectID', async () => {
            const { Stores } = service.entities;
            const storeId = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'My Unique Bookstore',
                location: 'Tokyo'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Stores',
                entityKey: storeId
            });

            expect(changes.length).toEqual(2); // name and location
            expect(changes[0].objectID).toEqual('My Unique Bookstore');
            expect(changes[1].objectID).toEqual('My Unique Bookstore');
        });

        it('should update objectID when the referenced field is included in the change', async () => {
            const { Stores } = service.entities;
            const storeId = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'Original Store Name'
            });

            const createChanges = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Stores',
                entityKey: storeId,
                modification: 'create'
            });

            expect(createChanges.length).toEqual(1);
            expect(createChanges[0].objectID).toEqual('Original Store Name');

            const updatedName = 'Updated Store Name';
            await UPDATE(Stores).where({ ID: storeId }).with({ name: updatedName });

            const updateChanges = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Stores',
                entityKey: storeId,
                modification: 'update'
            });

            expect(updateChanges.length).toEqual(1);
            expect(updateChanges[0].objectID).toEqual(updatedName);
        });
    });

    describe('Multiple Fields ObjectID', () => {
        it('should use multiple fields as objectID (concatenation)', async () => {
            const { Books } = service.entities;
            const bookId = cds.utils.uuid();
            const authorId = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'; // existing author Emily Bronte

            await INSERT.into(Books).entries({
                ID: bookId,
                title: 'Test Book Title',
                author_ID: authorId,
                stock: 10
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Books',
                entityKey: bookId
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes[0].objectID).toEqual('Test Book Title, Emily, Bronte');
        });

        it('should use multiple fields as objectID even when one field is null', async () => {
            const { Books } = service.entities;
            const bookId = cds.utils.uuid();
            const authorId = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387';

            // Book without title
            await INSERT.into(Books).entries({
                ID: bookId,
                author_ID: authorId,
                stock: 10
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Books',
                entityKey: bookId
            });

            // Both stock and author are tracked
            expect(changes.length).toEqual(2);
            // All changes should have the same objectID (without title, only author name)
            expect(changes.every(c => c.objectID === 'Emily, Bronte')).toEqual(true);
        });

        it('should be empty string when all objectID fields are null', async () => {
            const { Books } = service.entities;
            const bookId = cds.utils.uuid();

            // Book without title and without author
            await INSERT.into(Books).entries({
                ID: bookId,
                stock: 10
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Books',
                entityKey: bookId
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('');
        });
    });

    describe('Struct Field ObjectID', () => {
        it('should use struct field as objectID', async () => {
            const { Authors } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Authors).entries({
                ID: id,
                name_firstName: 'William',
                name_lastName: 'Shakespeare',
                placeOfBirth: 'Stratford'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Authors',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes[0].objectID).toEqual('William, Shakespeare');
        });

        it('should handle partial struct field in objectID', async () => {
            const { Authors } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Authors).entries({
                ID: id,
                name_firstName: 'SingleName',
                placeOfBirth: 'Unknown'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Authors',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(0);
            // Only firstName is set, lastName is null
            expect(changes[0].objectID).toEqual('SingleName');
        });
    });

    describe('Chained Association ObjectID', () => {
        it('should use one level chained association as objectID', async () => {
            const { Level1Entity } = service.entities;
            const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812';

            await INSERT.into(Level1Entity).entries({
                ID: cds.utils.uuid(),
                title: 'Level1 Test Entry',
                parent_ID: existingRootEntity
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Level1Entity',
                entityKey: existingRootEntity
            });

            expect(changes.find(c => c.attribute === 'title' && c.modification === 'create')).toMatchObject({
                objectID: 'In Preparation'
            });
        });

        it('should use deep chained association as objectID', async () => {
            const { Level3Entity } = service.entities;
            const existingLevel2Entity = 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff';
            const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812';

            await INSERT.into(Level3Entity).entries({
                ID: cds.utils.uuid(),
                title: 'Level3 Deep Test',
                parent_ID: existingLevel2Entity
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.Level3Entity',
                entityKey: existingRootEntity
            });

            expect(changes.find(c => c.attribute === 'title' && c.modification === 'create')).toMatchObject({
                objectID: 'In Preparation'
            });
        });
    });

    describe('ParentObjectID', () => {
        it('should resolve parentObjectID for child entities', async () => {
            const { ParentEntity } = service.entities;
            const parentId = cds.utils.uuid();

            await INSERT.into(ParentEntity).entries({
                ID: parentId,
                name: 'Parent Store Name',
                location: 'Sydney',
                children: [
                    {
                        ID: cds.utils.uuid(),
                        title: 'Child Item Title',
                        value: 100
                    }
                ]
            });

            const parentChanges = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.ParentEntity',
                entityKey: parentId
            });
            const parentObjectID = parentChanges[0].objectID;
            expect(parentObjectID).toEqual('Parent Store Name');

            const childChanges = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.ChildEntity',
                entityKey: parentId
            });

            expect(childChanges.length).toBeGreaterThan(0);
            expect(childChanges[0]).toMatchObject({
                parentObjectID: parentObjectID,
                objectID: 'Child Item Title'
            });
        });

        it('should maintain parentObjectID on child updates', async () => {
            const { ParentEntity, ChildEntity } = service.entities;
            const parentId = cds.utils.uuid();
            const childId = cds.utils.uuid();

            await INSERT.into(ParentEntity).entries({
                ID: parentId,
                name: 'Parent For Update Test',
                location: 'Melbourne',
                children: [
                    {
                        ID: childId,
                        title: 'Original Child Title',
                        value: 50
                    }
                ]
            });

            await UPDATE(ChildEntity).where({ ID: childId }).with({
                title: 'Updated Child Title'
            });

            const updateChanges = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.objectid.ChildEntity',
                entityKey: parentId,
                modification: 'update'
            });

            expect(updateChanges.length).toEqual(1);
            expect(updateChanges[0]).toMatchObject({
                parentObjectID: 'Parent For Update Test',
                objectID: 'Updated Child Title',
                valueChangedFrom: 'Original Child Title',
                valueChangedTo: 'Updated Child Title'
            });
        });
    });
});
