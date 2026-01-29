const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Object ID Resolution', () => {
    cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('ObjectIdTestService');
    });

    describe('Single Field ObjectID', () => {
        it('should use single field as objectID when @changelog: [name] is set', async () => {
            const { Stores } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: id,
                name: 'Main Store',
                location: 'New York'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Stores',
                entityKey: id,
                attribute: 'location'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('Main Store');
        });

        it('should update objectID when the objectID field itself changes', async () => {
            const { Stores } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Stores).entries({ ID: id, name: 'Old Name', location: 'City' });
            await UPDATE(Stores).where({ ID: id }).with({ name: 'New Name' });

            const updateChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Stores',
                entityKey: id,
                modification: 'update',
                attribute: 'name'
            });

            expect(updateChanges.length).toEqual(1);
            expect(updateChanges[0].objectID).toEqual('New Name');
        });
    });

    describe('Multiple Fields ObjectID', () => {
        it('should use multiple fields as objectID including association path', async () => {
            const { Books, Authors } = service.entities;
            const authorId = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Authors).entries({
                ID: authorId,
                name_firstName: 'John',
                name_lastName: 'Doe'
            });

            await INSERT.into(Books).entries({
                ID: bookId,
                title: 'My Book',
                author_ID: authorId,
                stock: 100
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Books',
                entityKey: bookId,
                attribute: 'stock'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toContain('My Book');
            expect(changes[0].objectID).toContain('John');
            expect(changes[0].objectID).toContain('Doe');
        });
    });

    describe('Struct Field ObjectID', () => {
        it('should resolve struct fields in objectID', async () => {
            const { Authors } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Authors).entries({
                ID: id,
                name_firstName: 'Jane',
                name_lastName: 'Smith',
                placeOfBirth: 'London'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Authors',
                entityKey: id,
                attribute: 'placeOfBirth'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toContain('Jane');
            expect(changes[0].objectID).toContain('Smith');
        });
    });

    describe('Code List ObjectID', () => {
        it('should resolve code list name in objectID', async () => {
            const { Projects, Status } = service.entities;
            const projectId = cds.utils.uuid();

            await INSERT.into(Status).entries({
                code: 'AC',
                name: 'Active'
            });

            await INSERT.into(Projects).entries({
                ID: projectId,
                title: 'Project Alpha',
                status_code: 'AC'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Projects',
                entityKey: projectId,
                attribute: 'title'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('Active');
        });
    });

    describe('Chained Association ObjectID', () => {
        it('should resolve 1-level chained association in objectID', async () => {
            const { Level1Items, Projects, Status } = service.entities;
            const projectId = cds.utils.uuid();
            const level1Id = cds.utils.uuid();

            await INSERT.into(Status).entries({ code: 'IP', name: 'In Progress' });
            await INSERT.into(Projects).entries({
                ID: projectId,
                title: 'Parent Project',
                status_code: 'IP'
            });

            await INSERT.into(Level1Items).entries({
                ID: level1Id,
                title: 'Level 1 Item',
                parent_ID: projectId
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Level1Items',
                entityKey: level1Id,
                attribute: 'title'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('In Progress');
        });

        it('should resolve 3-level chained association in objectID', async () => {
            const { Level1Items, Level2Items, Level3Items, Projects, Status } = service.entities;
            const projectId = cds.utils.uuid();
            const level1Id = cds.utils.uuid();
            const level2Id = cds.utils.uuid();
            const level3Id = cds.utils.uuid();

            await INSERT.into(Status).entries({ code: 'DN', name: 'Done' });
            await INSERT.into(Projects).entries({
                ID: projectId,
                title: 'Root Project',
                status_code: 'DN'
            });
            await INSERT.into(Level1Items).entries({
                ID: level1Id,
                title: 'L1',
                parent_ID: projectId
            });
            await INSERT.into(Level2Items).entries({
                ID: level2Id,
                title: 'L2',
                parent_ID: level1Id
            });
            await INSERT.into(Level3Items).entries({
                ID: level3Id,
                title: 'L3',
                parent_ID: level2Id
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Level3Items',
                entityKey: level3Id,
                attribute: 'title'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('Done');
        });
    });

    describe('Parent ObjectID', () => {
        it('should show parentObjectID for child entity changes via deep insert', async () => {
            const { Parents } = service.entities;
            const parentId = cds.utils.uuid();
            const childId = cds.utils.uuid();

            await INSERT.into(Parents).entries({
                ID: parentId,
                name: 'Parent Entity',
                children: [
                    {
                        ID: childId,
                        title: 'Child Entity',
                        value: 42
                    }
                ]
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Children',
                entityKey: parentId,
                attribute: 'value'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('Child Entity');
            expect(changes[0].parentObjectID).toEqual('Parent Entity');
        });
    });

    describe('Empty ObjectID Handling', () => {
        it('should handle empty objectID gracefully', async () => {
            const { Stores } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: id,
                name: null,
                location: 'Unknown'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.objectid.Stores',
                entityKey: id,
                attribute: 'location'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].objectID).toEqual('');
        });
    });
});
