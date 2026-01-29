const cds = require('@sap/cds');
const path = require('path');

const testApp = path.resolve(__dirname, '../new-tests');

describe('Configuration Options', () => {
    cds.test(testApp);
    let service;

    beforeAll(async () => {
        service = await cds.connect.to('CrudTestService');
    });

    afterEach(() => {
        Object.assign(cds.env.requires['change-tracking'], {
            preserveDeletes: false,
            disableCreateTracking: false,
            disableUpdateTracking: false,
            disableDeleteTracking: false
        });
    });

    describe('preserveDeletes', () => {
        it('should delete change logs when preserveDeletes is false (default)', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Item to Delete' });

            const changesBeforeDelete = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id
            });
            expect(changesBeforeDelete.length).toBeGreaterThan(0);

            await DELETE.from(Items).where({ ID: id });

            const changesAfterDelete = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id
            });
            expect(changesAfterDelete.length).toEqual(0);
        });

        it('should preserve change logs when preserveDeletes is true', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Preserved Item' });
            await DELETE.from(Items).where({ ID: id });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes.some(c => c.modification === 'create')).toBe(true);
            expect(changes.some(c => c.modification === 'delete')).toBe(true);
        });
    });

    describe('disableCreateTracking', () => {
        it('should not track creates when disableCreateTracking is true', async () => {
            cds.env.requires['change-tracking'].disableCreateTracking = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Untracked Create' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toEqual(0);
        });

        it('should still track updates when disableCreateTracking is true', async () => {
            cds.env.requires['change-tracking'].disableCreateTracking = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Item' });
            await UPDATE(Items).where({ ID: id }).with({ name: 'Updated Item' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id,
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
            expect(changes[0]).toMatchObject({
                valueChangedFrom: 'Item',
                valueChangedTo: 'Updated Item'
            });
        });
    });

    describe('disableUpdateTracking', () => {
        it('should not track updates when disableUpdateTracking is true', async () => {
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Item' });

            cds.env.requires['change-tracking'].disableUpdateTracking = true;

            await UPDATE(Items).where({ ID: id }).with({ name: 'Updated' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id,
                modification: 'update'
            });

            expect(changes.length).toEqual(0);
        });

        it('should still track creates when disableUpdateTracking is true', async () => {
            cds.env.requires['change-tracking'].disableUpdateTracking = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Tracked Create' });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toBeGreaterThan(0);
        });
    });

    describe('disableDeleteTracking', () => {
        it('should not track deletes when disableDeleteTracking is true', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            cds.env.requires['change-tracking'].disableDeleteTracking = true;
            const { Items } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Items).entries({ ID: id, name: 'Item' });
            await DELETE.from(Items).where({ ID: id });

            const changes = await SELECT.from('sap.changelog.ChangeView').where({
                entity: 'test.crud.Items',
                entityKey: id,
                modification: 'delete'
            });

            expect(changes.length).toEqual(0);
        });
    });
});
