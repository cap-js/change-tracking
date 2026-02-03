const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, DELETE } = cds.test(bookshop);

describe('Configuration scenarios', () => {
	it('When preserveDeletes is enabled, all changelogs should be retained after the root entity is deleted, and a changelog for the deletion operation should be generated', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
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

		const afterChanges = await SELECT.from(variantSrv.entities.ChangeView).where({ entityKey: newRoot.ID });
		expect(afterChanges.length).toEqual(6);

		const changelogCreated = afterChanges.filter((ele) => ele.modification === 'create');
		const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'delete');

		const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'parentKey', 'serviceEntityPath', 'valueDataType', 'objectID', 'parentObjectID', 'entityKey'];

		let commonItems = changelogCreated.filter((beforeItem) => {
			return changelogDeleted.some((afterItem) => {
				return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
			});
		});

		expect(commonItems.length > 0).toBeTruthy();

		cds.env.requires['change-tracking'].preserveDeletes = false;
	});

	it(`"disableUpdateTracking" setting`, async () => {
		cds.env.requires['change-tracking'].disableUpdateTracking = true;
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
});

describe('MTX Build', () => {
	test('Changes association is only added once JSON csn is compiled for runtime', async () => {
		const csn = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'xtended' });
		expect(csn.definitions['AdminService.BookStores'].elements?.changes).toBeFalsy();

		const csn2 = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'inferred' });
		const effectiveCSN2 = await cds.compile.for.nodejs(csn2);

		expect(effectiveCSN2.definitions['AdminService.BookStores'].elements.changes).toBeTruthy();
	});
});
