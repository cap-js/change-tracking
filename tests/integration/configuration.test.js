const cds = require('@sap/cds');
const path = require('path');
const { regenerateTriggers } = require('../../lib/test-utils.js');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, DELETE, GET, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('Configuration scenarios', () => {
	// Entities used in the VariantTesting service tests
	const variantEntities = [
		'sap.change_tracking.RootSample',
		'sap.change_tracking.Level1Sample',
		'sap.change_tracking.Level2Sample'
	];

	it('When preserveDeletes is enabled, all changelogs should be retained after the root entity is deleted, and a changelog for the deletion operation should be generated', async () => {
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
		expect(afterChanges.length).toEqual(6);

		const changelogCreated = afterChanges.filter((ele) => ele.modification === 'create');
		const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'delete');

		const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'rootEntityKey', 'serviceEntityPath', 'valueDataType', 'objectID', 'rootObjectID', 'entityKey'];

		let commonItems = changelogCreated.filter((beforeItem) => {
			return changelogDeleted.some((afterItem) => {
				return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
			});
		});

		expect(commonItems.length > 0).toBeTruthy();

		cds.env.requires['change-tracking'].preserveDeletes = false;
		await regenerateTriggers(variantEntities);
	});

	it(`"disableUpdateTracking" setting`, async () => {
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

	it(`"disableCreateTracking" setting`, async () => {
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

	it(`"disableDeleteTracking" setting`, async () => {
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

	describe('Service specific tracking', () => {
		it(`Service specific annotations do not cause tracking in a different service`, async () => {
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

		it(`when @changelog annotations is on DB-level, all service entities should be tracked`, async () => {
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

		it(`Service annotated with @changelog: false skips all change tracking`, async () => {
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

		it(`Element annotated with @changelog: false is not tracked`, async () => {
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

		it(`Direct DB modification tracks changes when DB entity has @changelog`, async () => {
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
});

describe('MTX Build', () => {
	it('Changes association is only added once JSON csn is compiled for runtime', async () => {
		const csn = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'xtended' });
		expect(csn.definitions['AdminService.BookStores'].elements?.changes).toBeFalsy();

		const csn2 = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'inferred' });
		const effectiveCSN2 = await cds.compile.for.nodejs(csn2);

		expect(effectiveCSN2.definitions['AdminService.BookStores'].elements.changes).toBeTruthy();
	});
});
