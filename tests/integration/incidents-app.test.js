const cds = require('@sap/cds');
const path = require('path');
const app = path.join(__dirname, '../bookshop');
const { axios, GET, POST, PATCH, DELETE } = cds.test(app);
axios.defaults.auth = { username: 'alice' };

async function newIncident() {
	const res = await POST(`odata/v4/processor/Incidents`, {
		customer_ID: '1004161',
		title: 'Strange noise when switching off Inverter',
		urgency_code: 'M',
		status_code: 'N',
		conversation: [
			{
				timestamp: '2022-09-04T13:00:00Z',
				author: 'Bradley Flowers',
				message: 'What exactly is wrong?'
			}
		]
	});
	await POST(`odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});
	return res.data.ID;
}

describe('Incidents Application Scenarios', () => {
	it('stores localized code list values in English when locale is EN', async () => {
		const incidentID = await newIncident();
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
			status_code: 'R'
		});

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const x = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`);
		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`);
		const statusChange = changes.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);
		expect(statusChange).toMatchObject({
			attributeLabel: 'Status',
			modificationLabel: 'Update',
			valueChangedFrom: 'N',
			valueChangedFromLabel: 'New',
			valueChangedTo: 'R',
			valueChangedToLabel: 'Resolved'
		});
	});

	it('stores localized code list values in German when locale is DE', async () => {
		const incidentID = await newIncident();
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)?sap-locale=de`, {
			status_code: 'R'
		});

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`, {
			headers: { 'Accept-Language': 'de' }
		});
		const statusChange = changes.find((change) => change.attribute === 'status' && change.modification === 'update' && change.entityKey === incidentID);;

		expect(statusChange).toMatchObject({
			attributeLabel: 'Status',
			modificationLabel: 'Aktualisieren',
			valueChangedFrom: 'N',
			valueChangedFromLabel: 'Neu',
			valueChangedTo: 'R',
			valueChangedToLabel: 'Gelöst'
		});
	});

	//Draft mode uploading attachment
	it('works correctly when entity uses attachments plugin', async () => {
		const incidentID = await newIncident();
		//read attachments list for Incident
		const attachmentResponse = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`);
		//the data should have only one attachment
		expect(attachmentResponse.status).toEqual(200);
		expect(attachmentResponse.data).toBeTruthy();
	});

	//REVISIT: Ideally use OData dynamic types so UI does the formatting and not the backend
	it.skip('localizes date and time values based on user locale', async () => {
		const incidentID = await newIncident();
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes?sap-locale=en`);
		const dbChanges = await SELECT.from('sap.changelog.ChangeView').where({
			attribute: { in: ['date', 'time', 'datetime', 'timestamp'] },
			modification: 'update',
			entityKey: incidentID
		});
		const dateChange = changes.find((change) => change.attribute === 'date');
		const dateDBChange = dbChanges.find((change) => change.attribute === 'date');
		expect(dateChange.valueChangedFrom).not.toEqual(dateDBChange.valueChangedFrom);
		expect(dateChange.valueChangedTo).not.toEqual(dateDBChange.valueChangedTo);

		const timeChange = changes.find((change) => change.attribute === 'time');
		const timeDBChange = dbChanges.find((change) => change.attribute === 'time');
		expect(timeChange.valueChangedFrom).not.toEqual(timeDBChange.valueChangedFrom);
		expect(timeChange.valueChangedTo).not.toEqual(timeDBChange.valueChangedTo);

		const dateTimeChange = changes.find((change) => change.attribute === 'datetime');
		const dateTimeDBChange = dbChanges.find((change) => change.attribute === 'datetime');
		expect(dateTimeChange.valueChangedFrom).not.toEqual(dateTimeDBChange.valueChangedFrom);
		expect(dateTimeChange.valueChangedTo).not.toEqual(dateTimeDBChange.valueChangedTo);

		const timestampChange = changes.find((change) => change.attribute === 'timestamp');
		const timestampDBChange = dbChanges.find((change) => change.attribute === 'timestamp');
		expect(timestampChange.valueChangedFrom).not.toEqual(timestampDBChange.valueChangedFrom);
		expect(timestampChange.valueChangedTo).not.toEqual(timestampDBChange.valueChangedTo);
	});

	it('supports entities with composite keys (multi-key entities)', async () => {
		const GJAHR = 2024;
		const BUKRS = 'TEST_' + Math.round(Math.random() * 10000000).toString();
		
		// Create entity with composite key
		await POST(`odata/v4/processor/MultiKeyScenario`, {
			GJAHR,
			BUKRS,
			foo1: 'Initial value'
		});
		await POST(`odata/v4/processor/MultiKeyScenario(GJAHR=${GJAHR},BUKRS='${BUKRS}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		
		// Edit the entity
		await POST(`odata/v4/processor/MultiKeyScenario(GJAHR=${GJAHR},BUKRS='${BUKRS}',IsActiveEntity=true)/ProcessorService.draftEdit`, {});
		await PATCH(`odata/v4/processor/MultiKeyScenario(GJAHR=${GJAHR},BUKRS='${BUKRS}',IsActiveEntity=false)`, {
			foo1: 'Updated value'
		});
		await POST(`odata/v4/processor/MultiKeyScenario(GJAHR=${GJAHR},BUKRS='${BUKRS}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		
		// Verify changes are tracked
		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/MultiKeyScenario(GJAHR=${GJAHR},BUKRS='${BUKRS}',IsActiveEntity=true)/changes`);
		
		const updateChange = changes.find((change) => change.attribute === 'foo1' && change.modification === 'update');
		expect(updateChange).toHaveProperty('valueChangedFrom', 'Initial value');
		expect(updateChange).toHaveProperty('valueChangedTo', 'Updated value');
		expect(updateChange).toHaveProperty('entityKey', `${GJAHR}||${BUKRS}`);
	});
});

describe('Non-ID key support', () => {
	it('tracks changes on entities that use a non-ID primary key', async () => {
		const ID = Math.round(Math.random() * 10000000).toString();
		await POST(`odata/v4/processor/BooksNotID`, {
			NOT_ID: ID,
			title: 'Inverter not functional'
		});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)`, {
			title: 'ABCDEF'
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'title' && change.modification === 'update');
		expect(change).toHaveProperty('valueChangedFrom', 'Inverter not functional');
		expect(change).toHaveProperty('valueChangedTo', 'ABCDEF');
	});

	it('tracks creation of child entities with non-ID keys', async () => {
		const ID = Math.round(Math.random() * 10000000).toString();
		const pageID = Math.round(Math.random() * 10000000).toString();
		await POST(`odata/v4/processor/BooksNotID`, {
			NOT_ID: ID,
			title: 'Inverter not functional'
		});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/pages`, {
			NOT_ID: pageID,
			page: 2
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page');
		expect(change).toHaveProperty('valueChangedFrom', null);
		expect(change).toHaveProperty('valueChangedTo', '2');
		expect(change).toHaveProperty('modification', 'create');
		expect(change).toHaveProperty('entityKey', pageID);
		expect(change).toHaveProperty('entity', 'sap.capire.incidents.PagesNotID');
		expect(change).toHaveProperty('rootEntityKey', ID);
		expect(change).toHaveProperty('rootEntity', 'sap.capire.incidents.BooksNotID');
	});

	it('tracks updates on child entities with non-ID keys', async () => {
		const ID = Math.round(Math.random() * 10000000).toString();
		const pageID = Math.round(Math.random() * 10000000).toString();
		await POST(`odata/v4/processor/BooksNotID`, {
			NOT_ID: ID,
			title: 'Inverter not functional',
			pages: [{ NOT_ID: pageID, page: 1 }]
		});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		await cds.delete(cds.model.definitions['sap.changelog.Changes']);
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/pages(NOT_ID='${pageID}',IsActiveEntity=false)`, {
			page: 2
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page');
		expect(change).toHaveProperty('valueChangedFrom', '1');
		expect(change).toHaveProperty('valueChangedTo', '2');
		expect(change).toHaveProperty('modification', 'update');
		expect(change).toHaveProperty('entityKey', pageID);
		expect(change).toHaveProperty('entity', 'sap.capire.incidents.PagesNotID');
		expect(change).toHaveProperty('rootEntityKey', ID);
		expect(change).toHaveProperty('rootEntity', 'sap.capire.incidents.BooksNotID');
	});

	it('tracks deletion of child entities with non-ID keys', async () => {
		const ID = Math.round(Math.random() * 10000000).toString();
		const pageID = Math.round(Math.random() * 10000000).toString();
		await POST(`odata/v4/processor/BooksNotID`, {
			NOT_ID: ID,
			title: 'Inverter not functional',
			pages: [{ NOT_ID: pageID, page: 1 }]
		});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});
		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await DELETE(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/pages(NOT_ID='${pageID}',IsActiveEntity=false)`);

		await POST(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID='${ID}',IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page' && change.modification === 'delete');
		expect(change).toHaveProperty('valueChangedFrom', '1');
		expect(change).toHaveProperty('valueChangedTo', null);		
		expect(change).toHaveProperty('entityKey', pageID);
		expect(change).toHaveProperty('entity', 'sap.capire.incidents.PagesNotID');
		expect(change).toHaveProperty('rootEntityKey', ID);
		expect(change).toHaveProperty('rootEntity', 'sap.capire.incidents.BooksNotID');
	});

	it('tracks association changes on composition children using deep update', async () => {
		const {
			data: { ID }
		} = await POST(`odata/v4/processor/Orders`, {});
		const innerID = cds.utils.uuid();
		const { status } = await PATCH(`odata/v4/processor/Orders(${ID})`, {
			orderProducts: [
				{
					ID: innerID,
					country: {
						code: 'DE'
					}
				}
			]
		});
		expect(status).toEqual(200);

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Orders(${ID})/changes`);
		expect(changes.length).toEqual(1);
		const change = changes.find((change) => change.attribute === 'country');
		expect(change).toHaveProperty('attributeLabel', 'Country/Region');
		expect(change).toHaveProperty('valueChangedFrom', null);
		expect(change).toHaveProperty('valueChangedTo', 'DE');
		expect(change).toHaveProperty('modification', 'create');
		expect(change).toHaveProperty('entityKey', innerID);
		expect(change).toHaveProperty('entity', 'sap.capire.incidents.OrderProducts');
		expect(change).toHaveProperty('rootEntityKey', ID);
		expect(change).toHaveProperty('rootEntity', 'sap.capire.incidents.Orders');
	});
});
