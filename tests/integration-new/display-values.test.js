const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Association Display Values', () => {
    cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('DisplayValuesTestService');
    });

    describe('Multiple Display Fields', () => {
        it('should display multiple fields from association on create', async () => {
            const { Books, Authors } = service.entities;
            const authorId = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Authors).entries({
                ID: authorId,
                firstName: 'Jane',
                lastName: 'Austen'
            });

            await INSERT.into(Books).entries({
                ID: bookId,
                title: 'Pride and Prejudice',
                author_ID: authorId,
                stock: 50
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.display.Books',
                entityKey: bookId,
                attribute: 'author'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].valueChangedTo).toContain('Jane');
            expect(changes[0].valueChangedTo).toContain('Austen');
        });

        it('should display multiple fields from association on update', async () => {
            const { Books, Authors } = service.entities;
            const author1Id = cds.utils.uuid();
            const author2Id = cds.utils.uuid();
            const bookId = cds.utils.uuid();

            await INSERT.into(Authors).entries([
                { ID: author1Id, firstName: 'Charles', lastName: 'Dickens' },
                { ID: author2Id, firstName: 'Mark', lastName: 'Twain' }
            ]);

            await INSERT.into(Books).entries({
                ID: bookId,
                title: 'A Tale',
                author_ID: author1Id,
                stock: 30
            });

            await UPDATE(Books).where({ ID: bookId }).with({ author_ID: author2Id });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.display.Books',
                entityKey: bookId,
                attribute: 'author',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].valueChangedFrom).toContain('Charles');
            expect(changes[0].valueChangedFrom).toContain('Dickens');
            expect(changes[0].valueChangedTo).toContain('Mark');
            expect(changes[0].valueChangedTo).toContain('Twain');
        });
    });

    describe('Single Display Field', () => {
        it('should display single field from association', async () => {
            const { Orders, Customers } = service.entities;
            const customerId = cds.utils.uuid();
            const orderId = cds.utils.uuid();

            await INSERT.into(Customers).entries({
                ID: customerId,
                name: 'ACME Corp',
                city: 'New York'
            });

            await INSERT.into(Orders).entries({
                ID: orderId,
                title: 'Order #001',
                customer_ID: customerId
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.display.Orders',
                entityKey: orderId,
                attribute: 'customer'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].valueChangedTo).toEqual('ACME Corp');
        });
    });

    describe('Null Association Handling', () => {
        it('should handle null association gracefully', async () => {
            const { Books } = service.entities;
            const bookId = cds.utils.uuid();

            await INSERT.into(Books).entries({
                ID: bookId,
                title: 'Orphan Book',
                author_ID: null,
                stock: 10
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.display.Books',
                entityKey: bookId,
                attribute: 'author'
            });

            expect(changes.length).toEqual(0);
        });

        it('should track association removal (set to null)', async () => {
            const { Orders, Customers } = service.entities;
            const customerId = cds.utils.uuid();
            const orderId = cds.utils.uuid();

            await INSERT.into(Customers).entries({
                ID: customerId,
                name: 'Customer A'
            });

            await INSERT.into(Orders).entries({
                ID: orderId,
                title: 'Order',
                customer_ID: customerId
            });

            await UPDATE(Orders).where({ ID: orderId }).with({ customer_ID: null });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.display.Orders',
                entityKey: orderId,
                attribute: 'customer',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].valueChangedFrom).toEqual('Customer A');
            expect(changes[0].valueChangedTo).toEqual('');
        });
    });
});
