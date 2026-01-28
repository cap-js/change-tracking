const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, '../bookshop');

describe('CRUD Operations', () => {
    cds.test(bookshop);
    let service, ChangeView;

    beforeAll(async () => {
        service = await cds.connect.to('CrudTestService');
        ChangeView = service.entities.ChangeView;
    });

    afterEach(() => {
        Object.assign(cds.env.requires['change-tracking'], {
            preserveDeletes: false,
            disableCreateTracking: false,
            disableUpdateTracking: false,
            disableDeleteTracking: false
        });
    });

    describe('Create Tracking', () => {
        it('should track simple field creation', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({
                ID: id,
                name: 'New Item',
                quantity: 10,
                isActive: true,
                price: 99.99
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toEqual(4); // name, quantity, isActive, price

            expect(changes.find(c => c.attribute === 'name')).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: 'New Item',
                modification: 'create'
            });

            expect(changes.find(c => c.attribute === 'quantity')).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: '10'
            });

            expect(changes.find(c => c.attribute === 'isActive')).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: 'true'
            });
        });

        it('should track multiple records creation simultaneously', async () => {
            const { Products } = service.entities;
            const id1 = cds.utils.uuid();
            const id2 = cds.utils.uuid();
            const id3 = cds.utils.uuid();

            await INSERT.into(Products).entries([
                { ID: id1, title: 'Product 1', stock: 100 },
                { ID: id2, title: 'Product 2', stock: 200 },
                { ID: id3, title: 'Product 3', stock: 300 }
            ]);

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Products',
                attribute: 'stock',
                modification: 'create'
            });

            expect(changes.length).toEqual(3);
            expect(changes.find(c => c.entityKey === id1)).toMatchObject({ valueChangedTo: '100' });
            expect(changes.find(c => c.entityKey === id2)).toMatchObject({ valueChangedTo: '200' });
            expect(changes.find(c => c.entityKey === id3)).toMatchObject({ valueChangedTo: '300' });
        });

        it('should track numeric value 0 on create', async () => {
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Products).entries({ ID: id, title: 'Zero Stock Item', stock: 0 });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Products',
                entityKey: id,
                attribute: 'stock',
                modification: 'create'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: '0'
            });
        });

        it('should track boolean false value on create', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({
                ID: id,
                name: 'Inactive Item',
                isActive: false
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                attribute: 'isActive',
                modification: 'create'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: 'false'
            });
        });

        it('should track DateTime and Timestamp values', async () => {
            const { Events } = service.entities;
            const id = cds.utils.uuid();
            const testDateTime = new Date('2024-10-16T08:53:48Z');
            const testTimestamp = new Date('2024-10-23T08:53:54.000Z');

            await INSERT.into(Events).entries({
                ID: id,
                name: 'Test Event',
                eventDate: testDateTime,
                timestamp: testTimestamp
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Events',
                entityKey: id
            });

            const dateChange = changes.find(c => c.attribute === 'eventDate' && c.modification === 'create');
            expect(dateChange.valueChangedFrom).toEqual('');
            expect(dateChange.valueChangedTo).toContain('2024');
            expect(dateChange.valueChangedTo).toContain('Oct');
            expect(dateChange.valueChangedTo).toContain('16');
        });
    });

    describe('Update Tracking', () => {
        it('should track simple field update', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            // Create item first
            await INSERT.into(Items).entries({
                ID: id,
                name: 'Item for Update',
                quantity: 10
            });

            // Now update it
            await UPDATE(Items).where({ ID: id }).with({ name: 'Updated Item Name' });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                attribute: 'name',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Item for Update',
                valueChangedTo: 'Updated Item Name'
            });
        });

        it('should not create change log when value does not change', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            // Create item first
            await INSERT.into(Items).entries({
                ID: id,
                name: 'Item for Update',
                quantity: 10
            });

            // Update with same value
            await UPDATE(Items).where({ ID: id }).with({ name: 'Item for Update' });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                modification: 'update'
            });

            expect(changes.length).toEqual(0);
        });

        it('should track update from non-null to null value', async () => {
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            // Create product with category
            await INSERT.into(Products).entries({
                ID: id,
                title: 'Product with Category',
                stock: 10,
                category: 'Electronics'
            });

            const before = await SELECT.one.from(Products).where({ ID: id });
            expect(before.category).toEqual('Electronics');

            // Update category to null
            await UPDATE(Products).where({ ID: id }).with({ category: null });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Products',
                entityKey: id,
                attribute: 'category',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Electronics',
                valueChangedTo: ''
            });
        });

        it('should track update from null to non-null value', async () => {
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            // Create with null category
            await INSERT.into(Products).entries({ ID: id, title: 'No Category', category: null });

            await UPDATE(Products).where({ ID: id }).with({ category: 'New Category' });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Products',
                entityKey: id,
                attribute: 'category',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '',
                valueChangedTo: 'New Category'
            });
        });
    });

    describe('Delete Tracking', () => {
        it('should track simple field deletion when preserveDeletes is enabled', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Item To Delete', quantity: 5 });

            await DELETE.from(Items).where({ ID: id });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                modification: 'delete'
            });

            expect(changes.length).toEqual(2); // name and quantity
            expect(changes.find(c => c.attribute === 'name')).toMatchObject({
                valueChangedFrom: 'Item To Delete',
                valueChangedTo: ''
            });
        });

        it('should track numeric value 0 on delete', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Products).entries({ ID: id, title: 'Zero Stock', stock: 0 });
            await DELETE.from(Products).where({ ID: id });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Products',
                entityKey: id,
                attribute: 'stock',
                modification: 'delete'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '0',
                valueChangedTo: ''
            });
        });

        it('should track boolean false value on delete', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Inactive Delete', isActive: false });
            await DELETE.from(Items).where({ ID: id });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.crud.Items',
                entityKey: id,
                attribute: 'isActive',
                modification: 'delete'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'false',
                valueChangedTo: ''
            });
        });
    });
});
