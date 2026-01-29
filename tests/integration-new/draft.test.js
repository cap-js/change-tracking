const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Draft-Enabled Entities', () => {
    const test = cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('DraftTestService');
    });

    afterEach(() => {
        Object.assign(cds.env.requires['change-tracking'], {
            preserveDeletes: false
        });
    });

    describe('Draft Creation and Activation', () => {
        it('should track changes only after draft activation', async () => {
            const { Orders } = service.entities;
            const id = cds.utils.uuid();

            const { data: draft } = await test.POST('/odata/v4/draft-test/Orders', {
                ID: id,
                name: 'Draft Order',
                amount: 100
            });

            let changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: id,
                modification: 'create'
            });
            expect(changes.length).toEqual(0);

            await test.POST(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=false)/DraftTestService.draftActivate`);

            changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes.find(c => c.attribute === 'name')).toMatchObject({
                valueChangedTo: 'Draft Order'
            });
        });

        it('should track changes when editing and activating existing entity', async () => {
            const { Orders } = service.entities;
            const id = cds.utils.uuid();

            const { data: draft } = await test.POST('/odata/v4/draft-test/Orders', {
                ID: id,
                name: 'Original Name',
                amount: 50
            });
            await test.POST(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=false)/DraftTestService.draftActivate`);

            await test.POST(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=true)/DraftTestService.draftEdit`, {
                PreserveChanges: false
            });

            await test.PATCH(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=false)`, {
                name: 'Updated Name'
            });

            await test.POST(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=false)/DraftTestService.draftActivate`);

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: id,
                attribute: 'name',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Original Name',
                valueChangedTo: 'Updated Name'
            });
        });
    });

    describe('Draft Discard', () => {
        it('should not track changes when draft is discarded', async () => {
            const id = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: id,
                name: 'Discarded Order',
                amount: 200
            });

            await test.DELETE(`/odata/v4/draft-test/Orders(ID=${id},IsActiveEntity=false)`);

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: id
            });

            expect(changes.length).toEqual(0);
        });
    });

    describe('Draft with Composition', () => {
        it('should track composition child changes after draft activation', async () => {
            const orderId = cds.utils.uuid();
            const itemId = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: orderId,
                name: 'Order with Items',
                amount: 300,
                items: [{
                    ID: itemId,
                    product: 'Widget',
                    quantity: 5,
                    price: 10.00,
                    isActive: true
                }]
            });

            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            const orderChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: orderId,
                modification: 'create'
            });
            expect(orderChanges.length).toBeGreaterThan(0);

            const itemChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.OrderItems',
                entityKey: orderId,
                modification: 'create'
            });
            expect(itemChanges.length).toBeGreaterThan(0);
            expect(itemChanges.find(c => c.attribute === 'product')).toMatchObject({
                valueChangedTo: 'Widget'
            });
        });

        it('should track composition child update after draft edit and activation', async () => {
            const orderId = cds.utils.uuid();
            const itemId = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: orderId,
                name: 'Order',
                amount: 100,
                items: [{
                    ID: itemId,
                    product: 'Original Product',
                    quantity: 1,
                    price: 5.00,
                    isActive: true
                }]
            });
            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=true)/DraftTestService.draftEdit`, {
                PreserveChanges: false
            });

            await test.PATCH(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/items(ID=${itemId},IsActiveEntity=false)`, {
                quantity: 10
            });

            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.OrderItems',
                entityKey: orderId,
                attribute: 'quantity',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: '1',
                valueChangedTo: '10'
            });
        });
    });

    describe('Draft Delete', () => {
        it('should track delete after draft activation when preserveDeletes is enabled', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const orderId = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: orderId,
                name: 'Order to Delete',
                amount: 500
            });
            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            await test.DELETE(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=true)`);

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: orderId,
                modification: 'delete'
            });

            expect(changes.length).toBeGreaterThan(0);
        });
    });

    describe('Draft Boolean and Numeric Fields', () => {
        it('should track boolean false value in draft', async () => {
            const orderId = cds.utils.uuid();
            const itemId = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: orderId,
                name: 'Order',
                amount: 100,
                items: [{
                    ID: itemId,
                    product: 'Item',
                    quantity: 1,
                    price: 10.00,
                    isActive: false
                }]
            });

            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.OrderItems',
                entityKey: orderId,
                attribute: 'isActive',
                modification: 'create'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedTo: 'false'
            });
        });

        it('should track numeric value 0 in draft', async () => {
            const orderId = cds.utils.uuid();
            const itemId = cds.utils.uuid();

            await test.POST('/odata/v4/draft-test/Orders', {
                ID: orderId,
                name: 'Order',
                amount: 0,
                items: [{
                    ID: itemId,
                    product: 'Free Item',
                    quantity: 0,
                    price: 0.00,
                    isActive: true
                }]
            });

            await test.POST(`/odata/v4/draft-test/Orders(ID=${orderId},IsActiveEntity=false)/DraftTestService.draftActivate`);

            const orderChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.Orders',
                entityKey: orderId,
                attribute: 'amount',
                modification: 'create'
            });

            expect(orderChanges.length).toEqual(1);
            expect(orderChanges[0]).toMatchObject({
                valueChangedTo: '0'
            });

            const itemChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.draft.OrderItems',
                entityKey: orderId,
                attribute: 'quantity',
                modification: 'create'
            });

            expect(itemChanges.length).toEqual(1);
            expect(itemChanges[0]).toMatchObject({
                valueChangedTo: '0'
            });
        });
    });
});
