const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { axios, POST, PATCH, DELETE, GET } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice' };

describe('CDS Features', () => {
	describe('@Common.Timezone handling', () => {
		let testingSRV;
		beforeEach(async () => {
			testingSRV = await cds.connect.to('VariantTesting');
		});
		it('timezone field is null in case of no timezone', async () => {
			const rootEntityData = {
				ID: cds.utils.uuid(),
				dateTime: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(testingSRV.entities.DifferentFieldTypes).entries(rootEntityData);
			let changes = await SELECT.from({ ref: [{ id: testingSRV.entities.DifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: rootEntityData.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: rootEntityData.ID,
				attribute: 'dateTime'
			});
			expect(changes.length).toEqual(1);
			let change = changes[0];
			expect(change.valueTimeZone).toEqual(null);
		});

		it('timezone field has timezone for static annotation value', async () => {
			const rootEntityData = {
				ID: cds.utils.uuid(),
				dateTimeWTZ: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(testingSRV.entities.DifferentFieldTypes).entries(rootEntityData);
			let changes = await SELECT.from({ ref: [{ id: testingSRV.entities.DifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: rootEntityData.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: rootEntityData.ID,
				attribute: 'dateTimeWTZ'
			});
			expect(changes.length).toEqual(1);
			let change = changes[0];
			expect(change.valueTimeZone).toEqual('Europe/Berlin');
		});

		it('timezone field has timezone for dynamic annotation value', async () => {
			const rootEntityData = {
				ID: cds.utils.uuid(),
				dateTimeWDTZ: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(testingSRV.entities.DifferentFieldTypes).entries(rootEntityData);
			let changes = await SELECT.from({ ref: [{ id: testingSRV.entities.DifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: rootEntityData.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: rootEntityData.ID,
				attribute: 'dateTimeWDTZ'
			});
			expect(changes.length).toEqual(1);
			let change = changes[0];
			expect(change.valueTimeZone).toEqual('Europe/Berlin');

			await UPDATE.entity(testingSRV.entities.DifferentFieldTypes).where({ ID: rootEntityData.ID }).set({ timeZone: 'Europe/Amsterdam' });
			changes = await SELECT.from({ ref: [{ id: testingSRV.entities.DifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: rootEntityData.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: rootEntityData.ID,
				attribute: 'dateTimeWDTZ'
			});
			expect(changes.length).toEqual(1);
			change = changes[0];
			expect(change.valueTimeZone).toEqual('Europe/Amsterdam');
		});

		it('timezone field has timezone for dynamic annotation value and entity has multi key', async () => {
			const { MultiKeyScenario } = cds.entities('sap.capire.incidents');
			const { MultiKeyScenario: srvMultiKeyScenario } = cds.entities('ProcessorService');
			const multiKeyData = {
				GJAHR: 2024,
				BUKRS: 'TEST_' + Math.round(Math.random() * 10000000).toString(),
				datetime: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(MultiKeyScenario).entries(multiKeyData);
			let changes = await SELECT.from({ ref: [{ id: srvMultiKeyScenario.name, where: [{ ref: ['GJAHR'] }, '=', { val: multiKeyData.GJAHR }, 'and', { ref: ['BUKRS'] }, '=', { val: multiKeyData.BUKRS }] }, 'changes'] }).where({
				entity: 'sap.capire.incidents.MultiKeyScenario',
				entityKey: `4,2024;${multiKeyData.BUKRS.length},${multiKeyData.BUKRS}`,
				attribute: 'datetime'
			});
			expect(changes.length).toEqual(1);
			let change = changes[0];
			expect(change.valueTimeZone).toEqual('Europe/Amsterdam');
		});
	});

	describe('tracking dates', () => {
		it('tracked datetime change is exposed in custom field', async () => {
			const { Incidents } = cds.entities('sap.capire.incidents');
			const { Incidents: srvIncidents } = cds.entities('ProcessorService');
			const incident = {
				ID: cds.utils.uuid(),
				datetime: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(Incidents).entries(incident);
			let change = await SELECT.one.from({ ref: [{ id: srvIncidents.name, where: [{ ref: ['ID'] }, '=', { val: incident.ID }] }, 'changes'] }).where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: incident.ID,
				attribute: 'datetime'
			});
			// Z is missing in PG, thus match is needed
			expect(change.valueChangedToLabelDateTime).toMatch(/2024-10-16T08:53:48/);
		});

		it('tracked date change is exposed in custom field', async () => {
			const { Incidents } = cds.entities('sap.capire.incidents');
			const { Incidents: srvIncidents } = cds.entities('ProcessorService');
			const incident = {
				ID: cds.utils.uuid(),
				date: '2024-10-16'
			};
			await INSERT.into(Incidents).entries(incident);
			let change = await SELECT.one.from({ ref: [{ id: srvIncidents.name, where: [{ ref: ['ID'] }, '=', { val: incident.ID }] }, 'changes'] }).where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: incident.ID,
				attribute: 'date'
			});
			expect(change.valueChangedToLabelDate).toEqual('2024-10-16');
		});

		it('tracked timestamp change is exposed in custom field', async () => {
			const { Incidents } = cds.entities('sap.capire.incidents');
			const { Incidents: srvIncidents } = cds.entities('ProcessorService');
			const incident = {
				ID: cds.utils.uuid(),
				timestamp: new Date('2024-10-16T08:53:48Z')
			};
			await INSERT.into(Incidents).entries(incident);
			let change = await SELECT.one.from({ ref: [{ id: srvIncidents.name, where: [{ ref: ['ID'] }, '=', { val: incident.ID }] }, 'changes'] }).where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: incident.ID,
				attribute: 'timestamp'
			});
			// Z and micro seconds are missing in PG, thus match is needed
			expect(change.valueChangedToLabelTimestamp).toMatch(/2024-10-16T08:53:48/);
		});

		it('tracked time change is exposed in custom field', async () => {
			const { Incidents } = cds.entities('sap.capire.incidents');
			const { Incidents: srvIncidents } = cds.entities('ProcessorService');
			const incident = {
				ID: cds.utils.uuid(),
				time: '08:53:48'
			};
			await INSERT.into(Incidents).entries(incident);
			let change = await SELECT.one.from({ ref: [{ id: srvIncidents.name, where: [{ ref: ['ID'] }, '=', { val: incident.ID }] }, 'changes'] }).where({
				entity: 'sap.capire.incidents.Incidents',
				entityKey: incident.ID,
				attribute: 'time'
			});
			expect(change.valueChangedToLabelTime).toEqual('08:53:48');
		});
	});

	describe('tracking decimals', () => {
		it('tracked decimal change with scale stores value with correct precision', async () => {
			const { DifferentFieldTypes } = cds.entities('sap.change_tracking');
			const { DifferentFieldTypes: srvDifferentFieldTypes } = cds.entities('VariantTesting');
			const data = {
				ID: cds.utils.uuid(),
				numberWithScale: 0
			};
			await INSERT.into(DifferentFieldTypes).entries(data);
			let change = await SELECT.one.from({ ref: [{ id: srvDifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: data.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: data.ID,
				attribute: 'numberWithScale'
			});

			// Value is stored as string with correct scale padding (Decimal(11,4) -> 4 decimal places)
			expect(change.valueChangedTo).toEqual('0.0000');
			expect(change.valueDataType).toEqual('cds.Decimal');
		});

		it('tracked decimal change without scale stores value as-is', async () => {
			const { DifferentFieldTypes } = cds.entities('sap.change_tracking');
			const { DifferentFieldTypes: srvDifferentFieldTypes } = cds.entities('VariantTesting');
			const data = {
				ID: cds.utils.uuid(),
				number: 42.5
			};
			await INSERT.into(DifferentFieldTypes).entries(data);
			let change = await SELECT.one.from({ ref: [{ id: srvDifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: data.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: data.ID,
				attribute: 'number'
			});

			// Without explicit scale, value is stored without padding
			expect(change.valueChangedTo).toEqual('42.5');
			expect(change.valueDataType).toEqual('cds.Decimal');
		});

		it('tracked decimal change from null preserves null in valueChangedFrom', async () => {
			const { DifferentFieldTypes } = cds.entities('sap.change_tracking');
			const { DifferentFieldTypes: srvDifferentFieldTypes } = cds.entities('VariantTesting');

			// Create without numberWithScale (null)
			const data = { ID: cds.utils.uuid(), title: 'null decimal test' };
			await INSERT.into(DifferentFieldTypes).entries(data);

			// Update to set the decimal value
			await UPDATE.entity(DifferentFieldTypes).where({ ID: data.ID }).set({ numberWithScale: 9.99 });

			let change = await SELECT.one.from({ ref: [{ id: srvDifferentFieldTypes.name, where: [{ ref: ['ID'] }, '=', { val: data.ID }] }, 'changes'] }).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: data.ID,
				attribute: 'numberWithScale',
				modification: 'update'
			});

			// NULL should remain null, not become '0.0000'
			expect(change.valueChangedFrom).toEqual(null);
			expect(change.valueChangedTo).toEqual('9.9900');
		});
	});

	it('default values are tracked', async () => {
		const {
			data: { ID }
		} = await POST(`/odata/v4/processor/Incidents`, {
			title: 'ABC'
		});
		await POST(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		const {
			data: { value: changes }
		} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes`);

		const change = changes.find((c) => c.attribute === 'status');

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
		const {
			data: { ID }
		} = await POST(`/odata/v4/processor/Incidents`, {
			title: 'ABC'
		});
		await POST(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		const {
			data: { value: changes }
		} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes?$search=Support%20Incidents`);

		let change = changes.find((c) => c.attribute === 'status');

		expect(change).toMatchObject({
			entityLabel: 'Support Incidents'
		});

		const {
			data: { value: changes2 }
		} = await GET(`/odata/v4/processor/Incidents(ID=${ID},IsActiveEntity=true)/changes?$search=Status`);

		change = changes2.find((c) => c.attribute === 'status');

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
			const childID = cds.utils.uuid();
			await INSERT.into(TrackingComposition).entries({ ID });
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
			await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${ID},IsActiveEntity=false)/children`, {
				ID: childID,
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

		it('excludes associations that target an entity with @cds.persistence.skip annotation', async () => {
			const testingSRV = await cds.connect.to('VariantTesting');
			const { DifferentFieldTypes, ChangeView } = testingSRV.entities;

			const testID = cds.utils.uuid();
			await INSERT.into(DifferentFieldTypes).entries({
				ID: testID,
				title: 'Test with skipped association',
				nonExistentName_ID: cds.utils.uuid()
			});

			// Verify that title change was tracked (supported type)
			const titleChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: testID,
				attribute: 'title'
			});
			expect(titleChanges.length).toEqual(1);
			expect(titleChanges[0].valueChangedTo).toEqual('Test with skipped association');

			// Verify that no change log entries exist for nonExistentName (association to @cds.persistence.skip entity)
			const nonExistentNameChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityKey: testID,
				attribute: 'nonExistentName'
			});
			expect(nonExistentNameChanges.length).toEqual(0);
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

	describe('Dynamic localization', () => {
		async function newIncident() {
			const res = await POST(`odata/v4/processor/Incidents`, {
				customer_ID: '1004161',
				title: 'Strange noise when switching off Inverter',
				urgency_code: 'M',
				status_code: 'N'
			});
			await POST(`odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
			return res.data.ID;
		}

		it('ValueFrom and ValueTo labels are localized', async () => {
			const incidentID = await newIncident();
			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

			await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
				status_code: 'R'
			});

			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

			const {
				data: { value: changes }
			} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
				headers: { 'Accept-Language': 'de' }
			});
			const statusChange = changes.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChange).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'Neu',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Gelöst'
			});

			const {
				data: { value: changesEN }
			} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
				headers: { 'Accept-Language': 'en' }
			});
			const statusChangeEN = changesEN.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChangeEN).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'New',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Resolved'
			});
		});

		it('ValueFrom and ValueTo labels are localized if property and entity got renamed in service', async () => {
			const {
				data: { ID: incidentID }
			} = await POST(`odata/v4/localization/Incidents`, {
				customer_ID: '1004161',
				title: 'Strange noise when switching off Inverter',
				urgency_code: 'M',
				renamedStatus_code: 'N'
			});

			await PATCH(`odata/v4/localization/Incidents(ID=${incidentID})`, {
				renamedStatus_code: 'R'
			});

			const {
				data: { value: changes }
			} = await GET(`odata/v4/localization/Incidents(ID=${incidentID})/changes`, {
				headers: { 'Accept-Language': 'de' }
			});
			const statusChange = changes.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChange).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'Neu',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Gelöst'
			});

			const {
				data: { value: changesEN }
			} = await GET(`odata/v4/localization/Incidents(ID=${incidentID})/changes`, {
				headers: { 'Accept-Language': 'en' }
			});
			const statusChangeEN = changesEN.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChangeEN).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'New',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Resolved'
			});
		});

		it('ValueFrom and ValueTo labels are localized if the label path uses an unmanaged association where the field is the foreign key.', async () => {
			const {
				data: { ID: incidentID }
			} = await POST(`odata/v4/localization/DynamicLocalizationScenarios`, {
				status4: 'N'
			});

			await PATCH(`odata/v4/localization/DynamicLocalizationScenarios(ID=${incidentID})`, {
				status4: 'R'
			});

			const {
				data: { value: changes }
			} = await GET(`odata/v4/localization/DynamicLocalizationScenarios(ID=${incidentID})/changes`, {
				headers: { 'Accept-Language': 'de' }
			});
			const statusChange = changes.find((change) => change.attribute === 'status4' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChange).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'Neu',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Gelöst'
			});

			const {
				data: { value: changesEN }
			} = await GET(`odata/v4/localization/DynamicLocalizationScenarios(ID=${incidentID})/changes`, {
				headers: { 'Accept-Language': 'en' }
			});
			const statusChangeEN = changesEN.find((change) => change.attribute === 'status4' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChangeEN).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'New',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Resolved'
			});
		});

		it('ValueFrom and ValueTo labels fallback to default label is locale if unknown', async () => {
			const incidentID = await newIncident();
			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

			await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)?sap-locale=de`, {
				status_code: 'R'
			});

			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {});

			const {
				data: { value: changes }
			} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
				headers: { 'Accept-Language': 'en_GB' }
			});
			const statusChange = changes.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChange).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'Neu',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Gelöst'
			});
		});

		it('ValueFrom and ValueTo labels are not localized if changelog has multiple labels', async () => {
			const { ChangeView, DynamicLocalizationScenarios } = cds.entities('LocalizationService');

			expect(DynamicLocalizationScenarios.elements.status1['@changelog'].length).toEqual(2);
			const valueChangedFromLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedFromLabel');
			expect(valueChangedFromLabel.xpr.some((r) => r.val === 'status1')).toEqual(false);
			const valueChangedToLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedToLabel');
			expect(valueChangedToLabel.xpr.some((r) => r.val === 'status1')).toEqual(false);
		});

		it('ValueFrom and ValueTo labels are localized if changelog is an expression', async () => {
			const incidentID = await newIncident();
			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

			await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
				statusExpr_code: 'R'
			});

			await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

			const {
				data: { value: changes }
			} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
				headers: { 'Accept-Language': 'de' }
			});
			const statusChange = changes.find((change) => change.attribute === 'statusExpr' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChange).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'Neu',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Gelöst'
			});

			const {
				data: { value: changesEN }
			} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
				headers: { 'Accept-Language': 'en' }
			});
			const statusChangeEN = changesEN.find((change) => change.attribute === 'statusExpr' && change.modification === 'update' && change.entityKey === incidentID);

			expect(statusChangeEN).toMatchObject({
				valueChangedFrom: 'N',
				valueChangedFromLabel: 'New',
				valueChangedTo: 'R',
				valueChangedToLabel: 'Resolved'
			});
		});

		it('ValueFrom and ValueTo labels are not localized if changelog label uses another association path', async () => {
			const { ChangeView, DynamicLocalizationScenarios } = cds.entities('LocalizationService');

			expect(DynamicLocalizationScenarios.elements.status1['@changelog'][0]['=']).toEqual('status1.descr');
			const valueChangedFromLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedFromLabel');
			expect(valueChangedFromLabel.xpr.some((r) => r.val === 'status2')).toEqual(false);
			const valueChangedToLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedToLabel');
			expect(valueChangedToLabel.xpr.some((r) => r.val === 'status2')).toEqual(false);
		});

		it('ValueFrom and ValueTo labels are not localized if changelog label association path has multiple keys', async () => {
			const { ChangeView, DynamicLocalizationScenarios } = cds.entities('LocalizationService');

			expect(DynamicLocalizationScenarios.elements.status3['@changelog'][0]['=']).toEqual('status3.name');
			expect(DynamicLocalizationScenarios.elements.status3_code).toBeTruthy();
			expect(DynamicLocalizationScenarios.elements.status3_code2).toBeTruthy();
			const valueChangedFromLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedFromLabel');
			expect(valueChangedFromLabel.xpr.some((r) => r.val === 'status3')).toEqual(false);
			const valueChangedToLabel = ChangeView.query.SELECT.columns.find((c) => c.as === 'valueChangedToLabel');
			expect(valueChangedToLabel.xpr.some((r) => r.val === 'status3')).toEqual(false);
		});
	});

	describe('Draft', () => {
		test('Insert into Draft_DraftAdministrativeData', async () => {
			const res = await INSERT.into('DRAFT_DraftAdministrativeData').entries({
				DraftUUID: cds.utils.uuid()
			});
			expect(res).toBeTruthy();
		});
	});

	it.skip('tracks changes correctly for bulk insert with JSON_TABLE inserts', async () => {
		const { DataSets } = cds.entities('sap.dh');
		// Arrange
		const timeAtStart = Date.now();
		const largeDataSetCount = 16000;
		const dataSets = [];
		const dataSetIds = [];
		const dataRequestID = cds.utils.uuid();

		for (let i = 0; i < largeDataSetCount; i++) {
			const id = cds.utils.uuid();
			dataSets.push({
				ID: id,
				dataRequest_ID: dataRequestID,
				createdAt: '2024-01-01T00:00:00.000Z',
				createdBy: 'test',
				modifiedAt: '2024-01-01T00:00:00.000Z',
				modifiedBy: 'test',
				tenant_ID: 'TestTenant',
				status_ID: 'WAITING'
			});
			dataSetIds.push(id);
		}

		// Single unbatched INSERT — same as original ng test
		await INSERT.into(DataSets).entries(dataSets);

		// Act — batched UPDATE simulating updateStatusesGrouped
		const newStatus = 'DELIVERED';
		await UPDATE(DataSets).set({ status_ID: newStatus }).where({ ID: dataSetIds });

		// Assert
		const updatedDataSets = await SELECT.from(DataSets).where({ ID: dataSetIds });

		expect(updatedDataSets).toHaveLength(largeDataSetCount);
		expect(updatedDataSets.every((ds) => ds.status_ID === 'DELIVERED')).toBeTruthy();

		const timeAtEnd = Date.now();
		const durationInSeconds = (timeAtEnd - timeAtStart) / 1000;
		// console.log(`Updated ${largeDataSetCount} datasets in ${durationInSeconds} seconds`);
	});
});
