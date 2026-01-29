const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Composition Tracking', () => {
    cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('CompositionTestService');
    });

    afterEach(() => {
        Object.assign(cds.env.requires['change-tracking'], {
            preserveDeletes: false
        });
    });

    describe('Composition of Many', () => {
        it('should track child entity creation in composition via deep insert', async () => {
            const { Stores } = service.entities;
            const storeId = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'Book Store',
                books: [
                    {
                        ID: bookId,
                        title: 'New Book',
                        stock: 25
                    }
                ]
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Books',
                entityKey: storeId,
                modification: 'create'
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes[0].objectID).toEqual('New Book');
            expect(changes[0].parentObjectID).toEqual('Book Store');
        });

        it('should track child entity update in composition', async () => {
            const { Stores, Books } = service.entities;
            const storeId = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'Store',
                books: [
                    {
                        ID: bookId,
                        title: 'Book',
                        stock: 10
                    }
                ]
            });

            await UPDATE(Books).where({ ID: bookId }).with({ stock: 20 });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Books',
                entityKey: storeId,
                attribute: 'stock',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '10',
                valueChangedTo: '20'
            });
        });

        it('should track child entity deletion in composition', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Stores, Books } = service.entities;
            const storeId = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'Store',
                books: [
                    {
                        ID: bookId,
                        title: 'Book to Delete',
                        stock: 5
                    }
                ]
            });

            await DELETE.from(Books).where({ ID: bookId });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Books',
                entityKey: storeId,
                modification: 'delete'
            });

            expect(changes.length).toBeGreaterThan(0);
        });
    });

    describe('Composition of One', () => {
        it('should track composition of one creation', async () => {
            const { Orders, OrderHeaders } = service.entities;
            const orderId = cds.utils.uuid();
            const headerId = cds.utils.uuid();

            await INSERT.into(Orders).entries({ ID: orderId, name: 'Order #1' });
            await INSERT.into(OrderHeaders).entries({
                ID: headerId,
                status: 'New',
                note: 'Test note'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.OrderHeaders',
                entityKey: headerId,
                modification: 'create'
            });

            expect(changes.length).toBeGreaterThan(0);
        });

        it('should track composition of one update', async () => {
            const { OrderHeaders } = service.entities;
            const headerId = cds.utils.uuid();

            await INSERT.into(OrderHeaders).entries({
                ID: headerId,
                status: 'Pending',
                note: 'Initial'
            });

            await UPDATE(OrderHeaders).where({ ID: headerId }).with({ status: 'Completed' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.OrderHeaders',
                entityKey: headerId,
                attribute: 'status',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Pending',
                valueChangedTo: 'Completed'
            });
        });
    });

    describe('Deep Composition (3 levels)', () => {
        it('should track changes at all composition levels', async () => {
            const { Root } = service.entities;
            const rootId = cds.utils.uuid();
            const l1Id = cds.utils.uuid();
            const l2Id = cds.utils.uuid();
            const l3Id = cds.utils.uuid();

            await INSERT.into(Root).entries({
                ID: rootId,
                name: 'Root Entity',
                level1: [{
                    ID: l1Id,
                    title: 'Level 1',
                    level2: [{
                        ID: l2Id,
                        title: 'Level 2',
                        level3: [{
                            ID: l3Id,
                            title: 'Level 3',
                            value: 100
                        }]
                    }]
                }]
            });

            const rootChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Root',
                entityKey: rootId
            });
            expect(rootChanges.length).toBeGreaterThan(0);

            const l3Changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Level3',
                entityKey: rootId
            });
            expect(l3Changes.length).toBeGreaterThan(0);
            expect(l3Changes[0].objectID).toEqual('Level 3');
        });

        it('should track deep level update', async () => {
            const { Root, Level3 } = service.entities;
            const rootId = cds.utils.uuid();
            const l1Id = cds.utils.uuid();
            const l2Id = cds.utils.uuid();
            const l3Id = cds.utils.uuid();

            await INSERT.into(Root).entries({
                ID: rootId,
                name: 'Root',
                level1: [{
                    ID: l1Id,
                    title: 'L1',
                    level2: [{
                        ID: l2Id,
                        title: 'L2',
                        level3: [{
                            ID: l3Id,
                            title: 'L3',
                            value: 50
                        }]
                    }]
                }]
            });

            await UPDATE(Level3).where({ ID: l3Id }).with({ value: 75 });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Level3',
                entityKey: rootId,
                attribute: 'value',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '50',
                valueChangedTo: '75'
            });
        });
    });

    describe('Cascade Delete', () => {
        it('should track cascade delete of children when parent is deleted', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Stores } = service.entities;
            const storeId = cds.utils.uuid();
            const book1Id = cds.utils.uuid();
            const book2Id = cds.utils.uuid();

            await INSERT.into(Stores).entries({
                ID: storeId,
                name: 'Store to Delete',
                books: [
                    { ID: book1Id, title: 'Book 1', stock: 10 },
                    { ID: book2Id, title: 'Book 2', stock: 20 }
                ]
            });

            await DELETE.from(Stores).where({ ID: storeId });

            const storeChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Stores',
                entityKey: storeId,
                modification: 'delete'
            });
            expect(storeChanges.length).toBeGreaterThan(0);

            const bookChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.composition.Books',
                entityKey: storeId,
                modification: 'delete'
            });
            expect(bookChanges.length).toBeGreaterThan(0);
        });
    });
});
