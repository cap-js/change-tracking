const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, '../bookshop');

describe('Configuration Options', () => {
    cds.test(bookshop);
    let service, ChangeView;

    beforeAll(async () => {
        service = await cds.connect.to('ConfigTestService');
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

    describe('preserveDeletes', () => {
        it('should retain changelogs after entity deletion when preserveDeletes is enabled', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Record to Delete',
                description: 'Will be deleted'
            });

            let changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });
            expect(changes.length).toBeGreaterThan(0);
            const initialChangeCount = changes.length;

            await DELETE.from(Records).where({ ID: id });

            changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(initialChangeCount);
            const deleteChanges = changes.filter(c => c.modification === 'delete');
            expect(deleteChanges.length).toBeGreaterThan(0);
        });

        it('should delete changelogs with entity when preserveDeletes is disabled (default)', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = false;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Record to Delete',
                description: 'Will be deleted'
            });

            let changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });
            expect(changes.length).toBeGreaterThan(0);

            await DELETE.from(Records).where({ ID: id });

            changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });
            expect(changes.length).toEqual(0);
        });
    });

    describe('disableCreateTracking', () => {
        it('should skip create logs when disableCreateTracking is enabled', async () => {
            cds.env.requires['change-tracking'].disableCreateTracking = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'No Create Log',
                description: 'Should not be logged'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toEqual(0);
        });

        it('should still track updates when disableCreateTracking is enabled', async () => {
            cds.env.requires['change-tracking'].disableCreateTracking = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Created Without Log',
                description: 'Initial'
            });

            await UPDATE(Records).where({ ID: id }).with({ name: 'Updated Name' });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'update'
            });

            expect(changes.length).toEqual(1);
        });
    });

    describe('disableUpdateTracking', () => {
        it('should skip update logs when disableUpdateTracking is enabled', async () => {
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            // Create entity first (with tracking enabled)
            await INSERT.into(Records).entries({
                ID: id,
                name: 'Record For Update Test',
                description: 'Initial'
            });

            // Now disable update tracking and try to update
            cds.env.requires['change-tracking'].disableUpdateTracking = true;

            await UPDATE(Records).where({ ID: id }).with({
                name: 'This Update Should Not Be Logged'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'update'
            });

            expect(changes.length).toEqual(0);
        });

        it('should still track creates when disableUpdateTracking is enabled', async () => {
            cds.env.requires['change-tracking'].disableUpdateTracking = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Created While Update Disabled',
                description: 'Should be logged'
            });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'create'
            });

            expect(changes.length).toBeGreaterThan(0);
        });
    });

    describe('disableDeleteTracking', () => {
        it('should skip delete logs when disableDeleteTracking is enabled', async () => {
            cds.env.requires['change-tracking'].preserveDeletes = true;
            cds.env.requires['change-tracking'].disableDeleteTracking = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Record for Delete Test',
                description: 'Testing delete tracking'
            });

            await DELETE.from(Records).where({ ID: id });

            const changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });

            const deleteChanges = changes.filter(c => c.modification === 'delete');
            expect(deleteChanges.length).toEqual(0);

            // Create changes should still exist (preserveDeletes is true)
            const createChanges = changes.filter(c => c.modification === 'create');
            expect(createChanges.length).toBeGreaterThan(0);
        });

        it('should still track creates and updates when disableDeleteTracking is enabled', async () => {
            cds.env.requires['change-tracking'].disableDeleteTracking = true;
            const { Records } = service.entities;
            const id = cds.utils.uuid();

            await INSERT.into(Records).entries({
                ID: id,
                name: 'Record For Delete Test',
                description: 'Initial'
            });

            let changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'create'
            });
            expect(changes.length).toBeGreaterThan(0);

            await UPDATE(Records).where({ ID: id }).with({ name: 'Updated Name' });

            changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id,
                modification: 'update'
            });
            expect(changes.length).toEqual(1);
        });
    });

    describe('Multiple Flags', () => {
        it('should respect multiple disable flags simultaneously', async () => {
            cds.env.requires['change-tracking'].disableCreateTracking = true;
            cds.env.requires['change-tracking'].disableUpdateTracking = true;
            cds.env.requires['change-tracking'].preserveDeletes = true;

            const { Records } = service.entities;
            const id = cds.utils.uuid();

            // Create - should not be tracked
            await INSERT.into(Records).entries({
                ID: id,
                name: 'Combined Test Record',
                description: 'Testing multiple flags'
            });

            let changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });
            expect(changes.length).toEqual(0);

            // Update - should not be tracked
            await UPDATE(Records).where({ ID: id }).with({ name: 'Updated Name' });

            changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });
            expect(changes.length).toEqual(0);

            // Delete - should be tracked (only delete tracking is enabled)
            await DELETE.from(Records).where({ ID: id });

            changes = await SELECT.from(ChangeView).where({
                entity: 'sap.capire.bookshop.test.config.Records',
                entityKey: id
            });

            expect(changes.length).toBeGreaterThan(0);
            expect(changes.every(c => c.modification === 'delete')).toEqual(true);
        });
    });
});
