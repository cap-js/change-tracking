const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Edge Cases', () => {
    cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('EdgeCasesTestService');
    });

    describe('Personal Data', () => {
        it('should NOT track fields marked with @PersonalData.IsPotentiallyPersonal', async () => {
            const { Customers } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Customers).entries({
                ID: id,
                name: 'John Doe',
                city: 'Berlin'
            });

            const nameChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Customers',
                entityKey: id,
                attribute: 'name'
            });
            expect(nameChanges.length).toEqual(0);

            const cityChanges = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Customers',
                entityKey: id,
                attribute: 'city'
            });
            expect(cityChanges.length).toEqual(1);
        });
    });

    describe('String Keys', () => {
        it('should track entities with string keys', async () => {
            const { Items } = service.entities;
            const stringId = 'item-' + Date.now();

            await INSERT.into(Items).entries({
                ID: stringId,
                title: 'String Key Item',
                category: 'Test'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: stringId
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes.find(c => c.attribute === 'title')).toMatchObject({
                entityKey: stringId,
                valueChangedTo: 'String Key Item'
            });
        });

        it('should handle special characters in string keys', async () => {
            const { Items } = service.entities;
            const specialId = 'item/with-special_chars.123';

            await INSERT.into(Items).entries({
                ID: specialId,
                title: 'Special Chars',
                category: 'Special'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: specialId
            });

            expect(changes.length).toBeGreaterThan(0);
        });
    });

    describe('Special Characters in Values', () => {
        it('should track values with special characters', async () => {
            const { Items } = service.entities;
            const id = 'item-special-value';

            await INSERT.into(Items).entries({
                ID: id,
                title: 'Test <script>alert("XSS")</script>',
                category: "O'Reilly & Sons"
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: id
            });

            const titleChange = changes.find(c => c.attribute === 'title');
            expect(titleChange.valueChangedTo).toContain('<script>');

            const categoryChange = changes.find(c => c.attribute === 'category');
            expect(categoryChange.valueChangedTo).toContain("O'Reilly");
        });

        it('should track values with unicode characters', async () => {
            const { Items } = service.entities;
            const id = 'item-unicode';

            await INSERT.into(Items).entries({
                ID: id,
                title: '日本語テスト',
                category: 'Emoji 🎉🚀'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: id
            });

            const titleChange = changes.find(c => c.attribute === 'title');
            expect(titleChange.valueChangedTo).toEqual('日本語テスト');

            const categoryChange = changes.find(c => c.attribute === 'category');
            expect(categoryChange.valueChangedTo).toContain('🎉');
        });
    });

    describe('Localized Values', () => {
        it('should track localized field changes', async () => {
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Products).entries({
                ID: id,
                title: 'Product Title',
                descr: 'Product Description'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Products',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes.find(c => c.attribute === 'title')).toMatchObject({
                valueChangedTo: 'Product Title'
            });
        });

        it('should track update to localized field', async () => {
            const { Products } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Products).entries({
                ID: id,
                title: 'Original Title',
                descr: 'Original Description'
            });

            await UPDATE(Products).where({ ID: id }).with({ title: 'Updated Title' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Products',
                entityKey: id,
                attribute: 'title',
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Original Title',
                valueChangedTo: 'Updated Title'
            });
        });
    });

    describe('Association to Many', () => {
        it('should NOT track association to many directly', async () => {
            const { Categories, Products } = service.entities;
            const categoryId = cds.utils.uuid();
            const productId = cds.utils.uuid();

            await INSERT.into(Categories).entries({
                ID: categoryId,
                name: 'Electronics'
            });

            await INSERT.into(Products).entries({
                ID: productId,
                title: 'Phone',
                category_ID: categoryId
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Categories',
                entityKey: categoryId,
                attribute: 'products'
            });

            expect(changes.length).toEqual(0);
        });
    });

    describe('Empty and Whitespace Values', () => {
        it('should track empty string values', async () => {
            const { Items } = service.entities;
            const id = 'item-empty';

            await INSERT.into(Items).entries({
                ID: id,
                title: '',
                category: 'Test'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: id,
                attribute: 'title'
            });

            expect(changes.length).toEqual(0);
        });

        it('should track whitespace-only values', async () => {
            const { Items } = service.entities;
            const id = 'item-whitespace';

            await INSERT.into(Items).entries({
                ID: id,
                title: '   ',
                category: 'Test'
            });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.edge.Items',
                entityKey: id,
                attribute: 'title'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0].valueChangedTo).toEqual('   ');
        });
    });
});
