const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, GET } = cds.test(bookshop);

describe('Special CDS Features', () => {
	let log = cds.test.log();

	it.skip('For DateTime and Timestamp, support for input via Date objects.', async () => {
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

	// REVISIT: behaviour in deep operations
	it('Special Character Handling in service-api', async () => {
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
			attribute: 'title',
			entityKey: rootID
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('RootSample title3');
		expect(changes[0].entityKey).toEqual(rootID);
		expect(changes[0].rootEntityKey).toEqual(null);
		expect(changes[0].objectID).toEqual(`${rootID}, RootSample title3`);

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level1Sample',
			attribute: 'title',
			rootEntityKey: rootID
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level1Sample title3');
		expect(changes[0].entityKey).toEqual(lvl1ID);
		expect(changes[0].rootEntityKey).toEqual(rootID);
		//expect(changes[0].objectID).toEqual(`${lvl1ID}, Level1Sample title3, ${rootID}`);

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			attribute: 'title',
			entityKey: lvl2ID
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level2Sample title3');
		expect(changes[0].entityKey).toEqual(lvl2ID);
		expect(changes[0].rootEntityKey).toEqual(lvl1ID);
		//expect(changes[0].objectID).toEqual(`${lvl2ID}, Level2Sample title3, ${rootID}`);
	});

	describe('Localization', () => {
		it.skip('Leave localization logic early if entity is not part of the model', async () => {
			const { Changes } = cds.entities('sap.changelog');
			const VolumnsSrv = await cds.connect.to('VolumnsService');
			const { Volumes, ChangeView } = VolumnsSrv.entities;

			const volumeID = cds.utils.uuid();
			await INSERT.into(Volumes).entries([{
				ID: volumeID,
				title: 'Wuthering Heights I',
				sequence: '1',
				book_ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b1'
			}]);

			await cds.delete(ChangeView).where({ entityKey: volumeID });
			await VolumnsSrv.run(UPDATE.entity(Volumes).where({ ID: volumeID }).set({ 
				title: 'new title' 
			}));
			const {
				data: { value: changes }
			} = await GET(`/odata/v4/volumns/Volumes(ID=${volumeID})/changes`);
			expect(changes.length).toEqual(1);
			await UPDATE(Changes).where({ ID: changes[0].ID }).set({ serviceEntity: 'Volumes' });
			const {
				data: { value: changes2 }
			} = await GET(`/odata/v4/volumns/Volumes(ID=${volumeID})/changes`);
			expect(changes2.length).toEqual(1);
			expect(changes2[0].serviceEntity).toEqual('Volumes');
			expect(log.output.length).toBeGreaterThan(0);
			expect(log.output).toMatch(/Cannot localize the attribute/);
		});

		it.skip('Leave localization logic early if attribute value is not part of the model', async () => {
			const { Changes } = cds.entities('sap.changelog');
			const { Volumes } = cds.entities('VolumnsService');
			const volumeID = cds.utils.uuid();
			await INSERT.into(Volumes).entries([{ ID: volumeID, title: 'Wuthering Heights I', sequence: '1', book_ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b1' }]);
			const VolumnsSrv = await cds.connect.to('VolumnsService');
			await cds.delete(VolumnsSrv.entities.ChangeView).where({ entityKey: volumeID });
			await VolumnsSrv.run(UPDATE.entity(Volumes).where({ ID: volumeID }).set({ title: 'new title' }));
			const {
				data: { value: changes }
			} = await GET(`/odata/v4/volumns/Volumes(ID=${volumeID})/changes`);
			expect(changes.length).toEqual(1);
			await UPDATE(Changes).where({ ID: changes[0].ID }).set({ attribute: 'abc' });
			const {
				data: { value: changes2 }
			} = await GET(`/odata/v4/volumns/Volumes(ID=${volumeID})/changes`);
			expect(changes2.length).toEqual(1);
			expect(changes2[0].attribute).toEqual('abc');
			expect(log.output.length).toBeGreaterThan(0);
			expect(log.output).toMatch(/Cannot localize the attribute/);
		});

		it('Localization should handle the cases that reading the change view without required parameters obtained', async () => {
			const variantTesting = await cds.connect.to('VariantTesting');
			const ID = cds.utils.uuid();
			await INSERT.into(variantTesting.entities.TrackingComposition).entries({
				ID
			});
			await cds.delete(variantTesting.entities.ChangeView).where({ entityKey: ID });
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=false)/children`, {
				ID: cds.utils.uuid(),
				price: 1.0,
				title: 'ABC'
			});
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

			const change = await SELECT.from(variantTesting.entities.ChangeView)
				.where({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'children'
				})
				.columns(['attribute', 'modification', 'entity', 'objectID', 'rootObjectID']);

			// To do localization, attribute needs parameters attribute and service entity, so the localization could not be done
			expect(change.attribute).toEqual('children');

			// To do localization, modification only needs parameters modification itself, so the localization could be done
			expect(change.modification).toEqual('create');

			// To do localization, entity only needs parameters entity itself, so the localization could be done
			expect(change.entity).toEqual('sap.change_tracking.TrackingComposition');

			// To do localization, object id needs parameters entity (if no object id is annotated), so the localization could not be done
			// If no object id is annotated, the real value stored in db of object id should be "".
			expect(change.objectID).toEqual('');
		});
	});

	describe(`Unsupported data types`, () => {
		it(`Binary fields cannot be change tracked`, async () => {
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

		it.skip(`Vectors cannot be change tracked`, async () => {
			// Vector type test is skipped as it requires HANA-specific setup
		});
	});
});
