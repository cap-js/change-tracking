const cds = require('@sap/cds');
const path = require('path');
const { regenerateTriggers } = require('../test-utils.js');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, PATCH, GET, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

const isHana = cds.env.requires?.db?.kind === 'hana';

describe('Configuration Options', () => {
	// Entities used in the VariantTesting service tests
	const variantEntities = ['sap.change_tracking.RootSample', 'sap.change_tracking.Level1Sample', 'sap.change_tracking.Level2Sample'];

	(isHana ? it.skip : it)('retains all change logs and logs deletion when preserveDeletes is enabled', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		await regenerateTriggers(variantEntities);
		const variantSrv = await cds.connect.to('VariantTesting');

		const { data: newRoot } = await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: cds.utils.uuid(),
			title: 'new RootSample title',
			children: [
				{
					ID: cds.utils.uuid(),
					title: 'new Level1Sample title',
					children: [
						{
							ID: cds.utils.uuid(),
							title: 'new Level2Sample title'
						}
					]
				}
			]
		});

		const beforeChanges = await SELECT.from({ ref: [{ id: variantSrv.entities.RootSample.name, where: [{ ref: ['ID'] }, '=', { val: newRoot.ID }] }, 'changes'] });
		expect(beforeChanges.length > 0).toBeTruthy();

		// Test when the root and child entity deletion occur simultaneously
		await DELETE(`/odata/v4/variant-testing/RootSample(ID=${newRoot.ID})`);

		const afterChanges = await SELECT.from(variantSrv.entities.ChangeView).where(`entityKey IN ('${newRoot.ID}', '${newRoot.children[0].ID}', '${newRoot.children[0].children[0].ID}')`);
		expect(afterChanges.length).toEqual(10);

		const changelogCreated = afterChanges.filter((ele) => ele.modification === 'create');
		const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'delete');

		const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'serviceEntityPath', 'valueDataType', 'objectID', 'entityKey'];

		let commonItems = changelogCreated.filter((beforeItem) => {
			return changelogDeleted.some((afterItem) => {
				return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
			});
		});

		expect(commonItems.length > 0).toBeTruthy();

		cds.env.requires['change-tracking'].preserveDeletes = false;
		await regenerateTriggers(variantEntities);
	});

	(isHana ? it.skip : it)('skips update logging when disableUpdateTracking is enabled', async () => {
		cds.env.requires['change-tracking'].disableUpdateTracking = true;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		const testingSRV = await cds.connect.to('VariantTesting');
		const ID = cds.utils.uuid();
		await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

		await UPDATE.entity(testingSRV.entities.Level2Sample).where({ ID: ID }).with({ title: 'New name' });

		let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: ID,
			attribute: 'title',
			modification: 'update'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableUpdateTracking = false;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		await UPDATE(testingSRV.entities.Level2Sample).where({ ID }).with({ title: 'Another name' });

		changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: ID,
			attribute: 'title',
			modification: 'update'
		});
		expect(changes.length).toEqual(1);
	});

	(isHana ? it.skip : it)('skips create logging when disableCreateTracking is enabled', async () => {
		cds.env.requires['change-tracking'].disableCreateTracking = true;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		const testingSRV = await cds.connect.to('VariantTesting');
		let ID = cds.utils.uuid();
		await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

		let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: ID,
			attribute: 'title',
			modification: 'create'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableCreateTracking = false;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		ID = cds.utils.uuid();
		await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

		changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: ID,
			attribute: 'title',
			modification: 'create'
		});
		expect(changes.length).toEqual(1);
	});

	(isHana ? it.skip : it)('skips create logging for composition children during deep insert when disableCreateTracking is enabled', async () => {
		cds.env.requires['change-tracking'].disableCreateTracking = true;
		await regenerateTriggers(variantEntities);
		const variantSrv = await cds.connect.to('VariantTesting');
		const { ChangeView } = variantSrv.entities;

		const rootID = cds.utils.uuid();
		const level1ID = cds.utils.uuid();
		const level2ID = cds.utils.uuid();

		await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: rootID,
			title: 'Root for disable-create test',
			children: [
				{
					ID: level1ID,
					title: 'Level1 for disable-create test',
					children: [
						{
							ID: level2ID,
							title: 'Level2 for disable-create test'
						}
					]
				}
			]
		});

		// No create changes should exist for root entity
		const rootChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.RootSample',
			entityKey: rootID,
			modification: 'create'
		});
		expect(rootChanges.length).toEqual(0);

		// No create changes should exist for level1 child entity
		const level1Changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level1Sample',
			entityKey: level1ID,
			modification: 'create'
		});
		expect(level1Changes.length).toEqual(0);

		// No create changes should exist for level2 grandchild entity
		const level2Changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: level2ID,
			modification: 'create'
		});
		expect(level2Changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableCreateTracking = false;
		await regenerateTriggers(variantEntities);
	});

	(isHana ? it.skip : it)('skips delete logging when disableDeleteTracking is enabled', async () => {
		cds.env.requires['change-tracking'].disableDeleteTracking = true;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		const testingSRV = await cds.connect.to('VariantTesting');
		const ID = cds.utils.uuid();
		await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });
		await cds.delete(testingSRV.entities.Level2Sample).where({ ID });

		let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			attribute: 'title',
			entityKey: ID,
			modification: 'delete'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableDeleteTracking = false;
		await regenerateTriggers('sap.change_tracking.Level2Sample');
		await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });
		await cds.delete(testingSRV.entities.Level2Sample).where({ ID });

		changes = await SELECT.from(testingSRV.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			attribute: 'title',
			entityKey: ID,
			modification: 'delete'
		});
		expect(changes.length).toEqual(1);
	});

	describe('Service-specific tracking', () => {
		it('only tracks changes when @changelog is defined on the specific service entity', async () => {
			// Create via CatalogService (no @changelog) - should NOT be tracked
			const { data: newStore } = await POST(`/browse/BookStores`, {
				name: 'New book store via browse'
			});

			const {
				data: { value: changes }
			} = await GET(`/odata/v4/admin/BookStores(ID=${newStore.ID},IsActiveEntity=true)/changes`);
			expect(changes.length).toEqual(0);

			// Create via AdminService (has @changelog) - SHOULD be tracked
			const { data: newStore2 } = await POST(`/odata/v4/admin/BookStores`, {
				name: 'New book store via admin'
			});
			await POST(`/odata/v4/admin/BookStores(ID=${newStore2.ID},IsActiveEntity=false)/AdminService.draftActivate`, {});
			const {
				data: { value: changes2 }
			} = await GET(`/odata/v4/admin/BookStores(ID=${newStore2.ID},IsActiveEntity=true)/changes`);
			expect(changes2.length).toEqual(2);
			const nameChange = changes2.find((change) => change.attribute === 'name');

			expect(nameChange).toMatchObject({
				entity: 'sap.capire.bookshop.BookStores',
				attribute: 'name',
				valueChangedFrom: null,
				valueChangedTo: 'New book store via admin'
			});
		});

		it('tracks changes via all services when @changelog is defined on the DB entity', async () => {
			const { data: newIncident } = await POST(`/odata/v4/processor/Incidents`, {
				title: 'Test incident for inheritance',
				date: '2025-01-15'
			});
			await POST(`/odata/v4/processor/Incidents(ID=${newIncident.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

			const {
				data: { value: changes }
			} = await GET(`/odata/v4/processor/Incidents(ID=${newIncident.ID},IsActiveEntity=true)/changes`);

			// Should have changelog entries because DB entity has @changelog
			expect(changes.length).toBeGreaterThan(0);

			const dateChange = changes.find((c) => c.attribute === 'status');
			expect(dateChange).toMatchObject({
				entity: 'sap.capire.incidents.Incidents',
				attribute: 'status',
				valueChangedTo: 'N',
				valueChangedToLabel: 'New'
			});
		});

		it('disables all tracking for a service annotated with @changelog: false', async () => {
			// IncidentsAdminService has @changelog: false at service level
			// Even though DB entity has @changelog, changes via this service should NOT be tracked
			const { data: newIncident } = await POST(`/odata/v4/incidents-admin/Incidents`, {
				title: 'Test incident via admin',
				date: '2025-02-20'
			});

			const changes = await SELECT.from('sap.changelog.Changes').where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: newIncident.ID
			});

			expect(changes.length).toEqual(0);
		});

		it('excludes specific fields annotated with @changelog: false from tracking', async () => {
			// AdminService.Customers.city has @changelog: false
			// city should NOT be tracked, but name, country, and age SHOULD be tracked
			const { data: newCustomer } = await POST(`/odata/v4/admin/Customers`, {
				name: 'Test customer for element skip', // also skipped since @Personal.data
				city: 'Munich',
				country: 'Germany',
				age: 30
			});

			const {
				data: { value: changes }
			} = await GET(`/odata/v4/admin/Customers(ID=${newCustomer.ID})/changes`);

			const ageChange = changes.find((c) => c.attribute === 'age');
			expect(ageChange).toBeTruthy();
			expect(ageChange.valueChangedTo).toBe('30');

			const cityChange = changes.find((c) => c.attribute === 'city');
			expect(cityChange).toBeFalsy();
		});

		it('tracks direct database modifications when DB entity has @changelog', async () => {
			// sap.capire.incidents.Incidents has @changelog at DB level
			// Direct INSERT into DB entity SHOULD be tracked
			const { Incidents } = cds.entities('sap.capire.incidents');
			const incidentID = cds.utils.uuid();

			await INSERT.into(Incidents).entries({
				ID: incidentID,
				title: 'Direct DB incident',
				date: '2025-03-10'
			});

			// Query changes from changelog table
			const changes = await SELECT.from('sap.changelog.Changes').where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: incidentID
			});

			// Should have changelog entries because DB entity has @changelog
			expect(changes.length).toBeGreaterThan(0);

			const dateChange = changes.find((c) => c.attribute === 'date');
			expect(dateChange).toBeTruthy();
			expect(dateChange.valueChangedTo).toEqual('2025-03-10');
		});
	});

	(isHana ? it.skip : it)('maxDisplayHierarchyDepth controls auto-discovery of composition targets', async () => {
		const originalDepth = cds.env.requires['change-tracking'].maxDisplayHierarchyDepth;

		cds.env.requires['change-tracking'].maxDisplayHierarchyDepth = 1;
		await regenerateTriggers(variantEntities);

		const variantSrv = await cds.connect.to('VariantTesting');
		const { ChangeView } = variantSrv.entities;

		const rootID = cds.utils.uuid();
		const level1ID = cds.utils.uuid();
		const level2ID = cds.utils.uuid();

		// Deep insert not possible because of limitation
		await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: rootID,
			title: 'Root for depth test',
			children: [
				{
					ID: level1ID,
					title: 'Level1 for depth test'
				}
			]
		});

		await PATCH(`/odata/v4/variant-testing/Level1Sample(ID=${level1ID})`, {
			children: [
				{
					ID: level2ID,
					title: 'Level2 for depth test'
				}
			]
		});

		const rootChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.RootSample',
			entityKey: rootID,
			attribute: 'title'
		});

		cds.env.requires['change-tracking'].maxDisplayHierarchyDepth = originalDepth;
		await regenerateTriggers(variantEntities);

		expect(rootChanges.length).toEqual(1);
		expect(rootChanges[0]).toMatchObject({
			modification: 'create',
			valueChangedTo: 'Root for depth test'
		});

		const level1Changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level1Sample',
			entityKey: level1ID,
			attribute: 'title'
		});
		expect(level1Changes.length).toEqual(1);
		expect(level1Changes[0]).toMatchObject({
			modification: 'create',
			valueChangedTo: 'Level1 for depth test',
			parent_entity: 'sap.change_tracking.RootSample',
			parent_entityKey: rootID
		});

		const level2Changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: level2ID,
			attribute: 'title'
		});
		expect(level2Changes.length).toEqual(1);
		expect(level2Changes[0]).toMatchObject({
			modification: 'create',
			valueChangedTo: 'Level2 for depth test',
			parent_entity: 'sap.change_tracking.Level1Sample',
			parent_entityKey: level1ID,
			parent_parent_entity: null, // should not have parent_parent_entity since maxDisplayHierarchyDepth is 1
			parent_parent_entityKey: null
		});
	});

	it('Should not track if entity is annotated @changelog: false', async () => {
		const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
			number: 1,
			bool: true,
			title: 'My test-record'
		});

		await PATCH(`/odata/v4/variant-testing/NotTrackedDifferentFieldTypes(ID=${record.ID})`, {
			number: 2,
			bool: false
		});

		const changes = await SELECT.from('sap.changelog.Changes').where({
			entity: 'sap.change_tracking.DifferentFieldTypes',
			entityKey: record.ID
		});

		const createChanges = changes.filter((c) => c.modification === 'create');
		const updateChanges = changes.filter((c) => c.modification === 'update');
		expect(createChanges.length).toEqual(3);
		expect(updateChanges.length).toEqual(0);
	});
});

describe('Restore Backlinks Procedure', () => {
	it('restores backlinks for create operations', async () => {
		const testingSRV = await cds.connect.to('VariantTesting');
		const { RootSample, ChangeView } = testingSRV.entities;

		const rootID = cds.utils.uuid();
		const lvl1ID = cds.utils.uuid();
		const lvl2ID = cds.utils.uuid();

		const sampleData = {
			ID: rootID,
			title: 'RootSample title3',
			children: [
				{
					ID: lvl1ID,
					title: 'Level1Sample title3',
					children: [
						{
							ID: lvl2ID,
							title: 'Level2Sample title3'
						}
					]
				}
			]
		};
		await INSERT.into(RootSample).entries(sampleData);

		// Capture the original state: 5 records (3 title + 2 composition)
		const originalChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
		expect(originalChanges.length).toEqual(5);

		const originalCompositionChanges = originalChanges.filter((c) => c.attribute === 'children');
		const compositionIDs = originalCompositionChanges.map((c) => c.ID);
		expect(originalCompositionChanges.length).toEqual(2);

		// Save original composition records as templates for later comparison
		const originalRootChildren = originalChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children');
		const originalLvl1Children = originalChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children');

		// Break parent_ID links first to prevent cascade delete, then delete composition entries
		await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionIDs });
		await DELETE.from('sap.changelog.Changes').where({ ID: compositionIDs });

		// Verify only 3 title records remain, all with broken backlinks
		const afterChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
		expect(afterChanges.length).toEqual(3);
		expect(afterChanges.every((c) => c.attribute === 'title')).toBeTruthy();
		expect(afterChanges.every((c) => c.parent_ID === null)).toBeTruthy();

		await cds.run('CALL SAP_CHANGELOG_RESTORE_BACKLINKS()');

		// should have 5 records again (2 composition records recreated)
		const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
		expect(restoredChanges.length).toEqual(5);

		const restoredRootChildren = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children');
		expect(restoredRootChildren).toBeTruthy();
		expect(restoredRootChildren).toMatchObject({
			entityKey: originalRootChildren.entityKey,
			valueDataType: originalRootChildren.valueDataType,
			modification: originalRootChildren.modification,
			parent_ID: null
		});

		// Verify restored Level1Sample/children composition record matches original
		const restoredLvl1Children = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children');
		expect(restoredLvl1Children).toBeTruthy();
		expect(restoredLvl1Children).toMatchObject({
			entityKey: originalLvl1Children.entityKey,
			attribute: 'children',
			valueDataType: originalLvl1Children.valueDataType,
			modification: originalLvl1Children.modification,
			parent_ID: restoredRootChildren.ID
		});

		// Verify title records now have parent_ID references restored
		const restoredLvl1Title = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'title');
		expect(restoredLvl1Title.parent_ID).toEqual(restoredRootChildren.ID);

		const restoredLvl2Title = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title');
		expect(restoredLvl2Title.parent_ID).toEqual(restoredLvl1Children.ID);

		// Root title should remain without parent
		const restoredRootTitle = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'title');
		expect(restoredRootTitle.parent_ID).toBeNull();
	});

	it('restores backlinks for update operations', async () => {
		const testingSRV = await cds.connect.to('VariantTesting');
		const { ChangeView } = testingSRV.entities;

		const rootID = cds.utils.uuid();
		const lvl1ID = cds.utils.uuid();
		const lvl2ID = cds.utils.uuid();

		// Create the hierarchy via HTTP to get a separate transaction
		await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: rootID,
			title: 'Root for update test',
			children: [
				{
					ID: lvl1ID,
					title: 'Level1 for update test',
					children: [{ ID: lvl2ID, title: 'Level2 for update test' }]
				}
			]
		});

		// Update the Level2Sample title via HTTP to get a new transaction
		await PATCH(`/odata/v4/variant-testing/Level2Sample(ID=${lvl2ID})`, {
			title: 'Level2 updated title'
		});

		// Capture all changes — should have entries across two transactions
		const allChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

		// Verify update entry exists and has proper parent_ID
		const updateLvl2Title = allChanges.find(
			(c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title' && c.modification === 'update'
		);
		expect(updateLvl2Title).toBeTruthy();
		expect(updateLvl2Title.parent_ID).not.toBeNull();

		// Break ALL backlinks: remove all composition entries, null out all parent_IDs
		const allCompositionChanges = allChanges.filter((c) => c.valueDataType === 'cds.Composition');
		const compositionIDs = allCompositionChanges.map((c) => c.ID);
		await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionIDs });
		await DELETE.from('sap.changelog.Changes').where({ ID: compositionIDs });

		// Verify backlinks are broken — only title entries remain, all orphaned
		const brokenChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
		expect(brokenChanges.every((c) => c.parent_ID === null)).toBeTruthy();
		expect(brokenChanges.every((c) => c.attribute === 'title')).toBeTruthy();

		// Restore backlinks
		await cds.run('CALL SAP_CHANGELOG_RESTORE_BACKLINKS()');

		// Verify restored state
		const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

		// The update title entry should have its parent_ID restored
		const restoredUpdateLvl2 = restoredChanges.find((c) => c.ID === updateLvl2Title.ID);
		expect(restoredUpdateLvl2.parent_ID).not.toBeNull();

		// Find the restored Level1Sample.children composition entry for the update transaction
		const updateTxn = updateLvl2Title.transactionID;
		const restoredLvl1Comp = restoredChanges.find(
			(c) =>
				c.entity === 'sap.change_tracking.Level1Sample' &&
				c.attribute === 'children' &&
				c.valueDataType === 'cds.Composition' &&
				c.transactionID === updateTxn
		);
		expect(restoredLvl1Comp).toBeTruthy();
		expect(restoredLvl1Comp.modification).toEqual('update');

		// The Level1Sample.children composition entry should be linked to RootSample.children
		const restoredRootComp = restoredChanges.find(
			(c) =>
				c.entity === 'sap.change_tracking.RootSample' &&
				c.attribute === 'children' &&
				c.valueDataType === 'cds.Composition' &&
				c.transactionID === updateTxn
		);
		expect(restoredRootComp).toBeTruthy();
		expect(restoredRootComp.modification).toEqual('update');
		expect(restoredLvl1Comp.parent_ID).toEqual(restoredRootComp.ID);
	});

	it('restores backlinks for delete operations with preserveDeletes', async () => {
		const testingSRV = await cds.connect.to('VariantTesting');
		const { RootSample, ChangeView } = testingSRV.entities;

		const rootID = cds.utils.uuid();
		const lvl1ID = cds.utils.uuid();
		const lvl2ID = cds.utils.uuid();

		// Create the hierarchy
		await INSERT.into(RootSample).entries({
			ID: rootID,
			title: 'Root for delete test',
			children: [
				{
					ID: lvl1ID,
					title: 'Level1 for delete test',
					children: [{ ID: lvl2ID, title: 'Level2 for delete test' }]
				}
			]
		});

		// Capture create state and use the actual transactionID format
		const createChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
		expect(createChanges.length).toEqual(5);

		// Use a fake but valid integer transactionID for the simulated delete entries
		const deleteTransactionID = 99999999;

		// Simulate preserveDeletes-style delete changelog entries by manually inserting
		// delete modification records without parent_ID (as if preserveDeletes was enabled during deletion)
		await cds.run(
			`INSERT INTO SAP_CHANGELOG_CHANGES (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (?, NULL, 'title', 'sap.change_tracking.Level2Sample', ?, ?, CURRENT_TIMESTAMP, 'alice', 'cds.String', 'delete', ?)`,
			[cds.utils.uuid(), lvl2ID, lvl2ID, deleteTransactionID]
		);
		await cds.run(
			`INSERT INTO SAP_CHANGELOG_CHANGES (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (?, NULL, 'title', 'sap.change_tracking.Level1Sample', ?, ?, CURRENT_TIMESTAMP, 'alice', 'cds.String', 'delete', ?)`,
			[cds.utils.uuid(), lvl1ID, lvl1ID, deleteTransactionID]
		);

		// Verify the delete entries have no parent_ID
		const deleteLvl2 = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: lvl2ID,
			modification: 'delete'
		});
		expect(deleteLvl2.length).toEqual(1);
		expect(deleteLvl2[0].parent_ID).toBeNull();

		// Restore backlinks
		await cds.run('CALL SAP_CHANGELOG_RESTORE_BACKLINKS()');

		// Verify composition entries were created for the delete transaction
		const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

		// The delete Level2 title should now have a parent_ID
		const restoredDeleteLvl2 = restoredChanges.find(
			(c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title' && c.modification === 'delete'
		);
		expect(restoredDeleteLvl2.parent_ID).not.toBeNull();

		// Level1Sample.children composition entry should exist for the delete transaction
		const restoredLvl1Comp = restoredChanges.find(
			(c) =>
				c.entity === 'sap.change_tracking.Level1Sample' &&
				c.attribute === 'children' &&
				c.valueDataType === 'cds.Composition' &&
				c.transactionID === String(deleteTransactionID)
		);
		expect(restoredLvl1Comp).toBeTruthy();
		expect(restoredDeleteLvl2.parent_ID).toEqual(restoredLvl1Comp.ID);

		// Level1Sample.children should link to RootSample.children (grandparent linking)
		const restoredRootComp = restoredChanges.find(
			(c) =>
				c.entity === 'sap.change_tracking.RootSample' &&
				c.attribute === 'children' &&
				c.valueDataType === 'cds.Composition' &&
				c.transactionID === String(deleteTransactionID)
		);
		expect(restoredRootComp).toBeTruthy();
		expect(restoredLvl1Comp.parent_ID).toEqual(restoredRootComp.ID);

		// The delete Level1 title should also have its parent_ID restored
		const restoredDeleteLvl1 = restoredChanges.find(
			(c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'title' && c.modification === 'delete'
		);
		expect(restoredDeleteLvl1.parent_ID).toEqual(restoredRootComp.ID);
	});
});
describe('MTX Build', () => {
	it('adds changes association only during runtime compilation, not during xtended CSN build', async () => {
		const csn = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'xtended' });
		expect(csn.definitions['AdminService.BookStores'].elements?.changes).toBeFalsy();

		const csn2 = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'inferred' });
		const effectiveCSN2 = await cds.compile.for.nodejs(csn2);

		expect(effectiveCSN2.definitions['AdminService.BookStores'].elements.changes).toBeTruthy();
	});
});
