const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { axios, POST, PATCH, DELETE, GET } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice' };

describe('Special CDS Features', () => {
	it.skip('formats DateTime and Timestamp values from JavaScript Date objects correctly', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		const testingSRV = await cds.connect.to('VariantTesting');
		const rootEntityData = {
			ID: cds.utils.uuid(),
			dateTime: new Date('2024-10-16T08:53:48Z'),
			timestamp: new Date('2024-10-23T08:53:54.000Z')
		};
		await INSERT.into(testingSRV.entities.DifferentFieldTypes).entries(rootEntityData);
		let changes = await testingSRV.run(
			SELECT.from({ ref: [{ id: testingSRV.entities.DifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: rootEntityData.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: rootEntityData.ID,
				attribute: 'dateTime'
			})
		);
		expect(changes.length).toEqual(1);
		let change = changes[0];
		expect(change.attribute).toEqual('dateTime');
		expect(change.modification).toEqual('create');
		expect(change.valueChangedFrom).toEqual(null);
		/**
		 * REVISIT: With DB Triggers it should be solved
		 */
		expect(change.valueChangedTo).toEqual(
			new Date('2024-10-16T08:53:48Z').toLocaleDateString('en', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: true
			})
		);
		cds.env.requires['change-tracking'].preserveDeletes = false;
	});

	it('default values are tracked', async () => {
		const {data: {ID}} = await POST(`/odata/v4/processor/Incidents`, {
			title: "ABC"
		});
		await POST(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		const {data: {value: changes}} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes`);
		
		const change = changes.find(c => c.attribute === 'status')

		expect(change).toMatchObject({
			modification: 'create',
			entityLabel: 'Support Incidents',
			valueChangedFrom: null,
			valueChangedTo: 'N',
			valueChangedToLabel: 'New',
			parent_ID: null
		});
	});

	it('search works on labels', async () => {
		const {data: {ID}} = await POST(`/odata/v4/processor/Incidents`, {
			title: "ABC"
		});
		await POST(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		const {data: {value: changes}} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes?$search=Support%20Incidents`);
		
		let change = changes.find(c => c.attribute === 'status')

		expect(change).toMatchObject({
			entityLabel: 'Support Incidents',
		});

		const {data: {value: changes2}} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes?$search=Status`);
		
		change = changes2.find(c => c.attribute === 'status')

		expect(change).toMatchObject({
			attributeLabel: 'Status'
		});
	});

	// REVISIT: behaviour in deep operations
	it.skip('handles special characters in entity keys correctly', async () => {
		const testingSRV = await cds.connect.to('VariantTesting');
		const { RootSample, ChangeView } = testingSRV.entities;

		const rootID = `/${cds.utils.uuid()}`;
		const lvl1ID = `/${cds.utils.uuid()}`;
		const lvl2ID = `/${cds.utils.uuid()}`;
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

		await testingSRV.run(INSERT.into(RootSample).entries(sampleData));

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.RootSample',
			entityKey: rootID,
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('RootSample title3');
		expect(changes[0].entityKey).toEqual(rootID);
		expect(changes[0].rootEntityKey).toEqual(null);
		expect(changes[0].objectID).toEqual(`${rootID}, RootSample title3`);
		expect(changes[0].parent_ID).toBeNull();

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level1Sample',
			entityKey: lvl1ID,
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level1Sample title3');
		expect(changes[0].parent_entity).toEqual('sap.change_tracking.RootSample');
		expect(changes[0].parent_entityKey).toEqual(rootID);
		//expect(changes[0].objectID).toEqual(`${lvl1ID}, Level1Sample title3, ${rootID}`);

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			entityKey: lvl2ID,
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level2Sample title3');
		expect(changes[0].parent_entity).toEqual('sap.change_tracking.Level1Sample');
		expect(changes[0].parent_entityKey).toEqual(lvl1ID);
		//expect(changes[0].objectID).toEqual(`${lvl2ID}, Level2Sample title3, ${rootID}`);
	});

	it('Works for <as select from> views as well', async () => {
		const { data: record } = await POST(`/odata/v4/variant-testing/SelectionView`, {
			number: 1,
			bool: true,
			title: 'My test-record'
		});

		const {
			data: { value: changes }
		} = await GET(`/odata/v4/variant-testing/SelectionView(ID=${record.ID})/changes`);
		const numberLog = changes.find((change) => change.attribute === 'number');

		expect(numberLog).toBeTruthy();
		expect(numberLog).toMatchObject({
			entityKey: record.ID,
			modification: 'create',
			modificationLabel: 'Create',
			objectID: 'My test-record',
			entity: 'sap.change_tracking.DifferentFieldTypes',
			entityLabel: 'Different field types',
			parent_ID: null,
			valueChangedFrom: null,
			valueChangedTo: '1'
		});
	});

	describe('localization', () => {
		it('localizes change view entries correctly when queried without filter parameters', async () => {
			const variantTesting = await cds.connect.to('VariantTesting');
			const { ChangeView, TrackingComposition } = variantTesting.entities;
			const ID = cds.utils.uuid();
			await INSERT.into(TrackingComposition).entries({ ID });
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=false)/children`, {
				ID: cds.utils.uuid(),
				price: 1.0,
				title: 'ABC'
			});
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

			const change = await SELECT.one.from(ChangeView).where({
				entity: 'sap.change_tracking.TrackingComposition',
				attribute: 'children',
				entityKey: ID
			});

			expect(change).toMatchObject({
				modification: 'update',
				objectID: ID,
				entityLabel: 'Book Store',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null
			});
		});
	});

	describe('unsupported data types', () => {
		it('excludes Binary and LargeBinary fields from change tracking', async () => {
			const testingSRV = await cds.connect.to('VariantTesting');
			const { DifferentFieldTypes, ChangeView } = testingSRV.entities;

			// Create an entry with binary data
			const testID = cds.utils.uuid();
			await INSERT.into(DifferentFieldTypes).entries({
				ID: testID,
				title: 'Test with binary',
				image: Buffer.from('test image data').toString('base64'),
				icon: Buffer.from('icon').toString('base64')
			});

			// Verify that title change was tracked (supported type)
			const titleChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: testID,
				attribute: 'title'
			});
			expect(titleChanges.length).toEqual(1);
			expect(titleChanges[0].valueChangedTo).toEqual('Test with binary');

			// Verify that no change log entries exist for image (LargeBinary)
			const imageChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: testID,
				attribute: 'image'
			});
			expect(imageChanges.length).toEqual(0);

			// Verify that no change log entries exist for icon (Binary)
			const iconChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: testID,
				attribute: 'icon'
			});
			expect(iconChanges.length).toEqual(0);
		});

		it.skip('excludes Vector fields from change tracking (requires HANA)', async () => {
			// Vector type test is skipped as it requires HANA-specific setup
		});
	});

	describe('Large string truncation', () => {
		it('truncates strings larger than 5000 characters with ellipsis', async () => {
			const testingSrv = await cds.connect.to('VariantTesting');
			const recordID = cds.utils.uuid();

			// Create a string with exactly 5001 characters (should be truncated)
			const largeString = 'x'.repeat(5001);

			await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				ID: recordID,
				largeText: largeString
			});

			const changes = await testingSrv.run(
				SELECT.from(testingSrv.entities.ChangeView).where({
					entityKey: recordID,
					attribute: 'largeText',
					modification: 'create'
				})
			);

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo.length).toEqual(5000);
			expect(changes[0].valueChangedTo).toEqual('x'.repeat(4997) + '...');
		});

		it('does not truncate strings with exactly 5000 characters', async () => {
			const testingSrv = await cds.connect.to('VariantTesting');
			const recordID = cds.utils.uuid();

			// Create a string with exactly 5000 characters (should not be truncated)
			const exactString = 'y'.repeat(5000);

			await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				ID: recordID,
				largeText: exactString
			});

			const changes = await testingSrv.run(
				SELECT.from(testingSrv.entities.ChangeView).where({
					entityKey: recordID,
					attribute: 'largeText',
					modification: 'create'
				})
			);

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo.length).toEqual(5000);
			expect(changes[0].valueChangedTo).toEqual(exactString);
		});

		it('truncates both old and new values during update when they exceed 5000 characters', async () => {
			const testingSrv = await cds.connect.to('VariantTesting');
			const recordID = cds.utils.uuid();

			const oldLargeString = 'a'.repeat(6000);
			const newLargeString = 'b'.repeat(7000);

			await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				ID: recordID,
				largeText: oldLargeString
			});

			await PATCH(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${recordID})`, {
				largeText: newLargeString
			});

			const changes = await testingSrv.run(
				SELECT.from(testingSrv.entities.ChangeView).where({
					entityKey: recordID,
					attribute: 'largeText',
					modification: 'update'
				})
			);

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedFrom.length).toEqual(5000);
			expect(changes[0].valueChangedFrom).toEqual('a'.repeat(4997) + '...');
			expect(changes[0].valueChangedTo.length).toEqual(5000);
			expect(changes[0].valueChangedTo).toEqual('b'.repeat(4997) + '...');
		});

		it('truncates string value during delete when it exceeds 5000 characters', async () => {
			const testingSrv = await cds.connect.to('VariantTesting');
			const recordID = cds.utils.uuid();

			const largeString = 'z'.repeat(8000);

			await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				ID: recordID,
				largeText: largeString
			});

			await DELETE(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${recordID})`);

			const changes = await testingSrv.run(
				SELECT.from(testingSrv.entities.ChangeView).where({
					entityKey: recordID,
					attribute: 'largeText',
					modification: 'delete'
				})
			);

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedFrom.length).toEqual(5000);
			expect(changes[0].valueChangedFrom).toEqual('z'.repeat(4997) + '...');
			expect(changes[0].valueChangedTo).toEqual(null);
		});
	});
});
