const cds = require('@sap/cds');
const path = require('path');
const app = path.join(__dirname, '../bookshop');
const { axios, GET, POST, PATCH, DELETE } = cds.test(app);
axios.defaults.auth = { username: 'alice' };

async function createIncident(overrides = {}) {
	const { data: draft } = await POST('/odata/v4/processor/Incidents', {
		title: `Test Incident ${Math.floor(Math.random() * 1000)}`,
		status_code: 'N',
		...overrides
	});
	const incidentID = draft.ID;

	// Activate the draft to make it a real entity
	await POST(`/odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

	return incidentID;
}

async function createBookNotID(overrides = {}, withPage = null) {
	const NOT_ID = Math.floor(Math.random() * 10000) + 100; // Avoid collision with seeded data (1-4)
	await POST('/odata/v4/processor/BooksNotID', {
		NOT_ID,
		title: `Test Book ${NOT_ID}`,
		...overrides
	});

	let pageNOT_ID = null;
	if (withPage !== null) {
		pageNOT_ID = Math.floor(Math.random() * 10000) + 100;
		await POST(`/odata/v4/processor/BooksNotID(NOT_ID=${NOT_ID},IsActiveEntity=false)/pages`, {
			NOT_ID: pageNOT_ID,
			page: withPage
		});
	}

	// Activate the draft
	await POST(`/odata/v4/processor/BooksNotID(NOT_ID=${NOT_ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

	return { bookNOT_ID: NOT_ID, pageNOT_ID };
}

async function createOrder(overrides = {}) {
	const { data: order } = await POST('/odata/v4/processor/Orders', {
		abc: `Test Order ${Math.floor(Math.random() * 1000)}`,
		...overrides
	});
	return order.ID;
}

describe('Tests for uploading/deleting attachments through API calls', () => {
	it('Localized values are stored - EN', async () => {
		const incidentID = await createIncident();
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
			status_code: 'R'
		});

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`);

		// Find the Update change for Status (not the Create change from initial creation)
		const statusChange = changes.find((change) => change.attribute === 'Status' && change.modification === 'Update');
		expect(statusChange).toHaveProperty('valueChangedFrom', 'New');
		expect(statusChange).toHaveProperty('valueChangedTo', 'Resolved');
	});

	it('Localized values are stored - DE', async () => {
		const incidentID = await createIncident();

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)?sap-locale=de`, {
			status_code: 'R'
		});

		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes`);

		const statusChangeGerman = changes.find((change) => change.attribute === 'Status' && change.modification === 'Update');
		expect(statusChangeGerman).toHaveProperty('valueChangedFrom', 'Neu');
		expect(statusChangeGerman).toHaveProperty('valueChangedTo', 'Gelöst');
	});

	it('Requesting object page to ensure change tracking works with attachments combined', async () => {
		const incidentID = await createIncident();

		// Read the incident to verify change tracking works with attachments combined
		const attachmentResponse = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`);
		expect(attachmentResponse.status).toEqual(200);
		expect(attachmentResponse.data).toBeTruthy();
	});

	//REVISIT: Ideally use OData dynamic types so UI does the formatting and not the backend
	//REVISIT: update does not trigger change for data and time 
	it('Date and time values are localized', async () => {
		// Create an incident with initial date/time values
		const incidentID = await createIncident({
			// date: '2025-10-17',
			// time: '00:01:02',
			// datetime: '2025-10-17T00:10:20',
			// timestamp: '2025-10-17T00:10:20.000Z'
		});

		// Edit the incident (put into draft mode)
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		// Change the date/time values to trigger change tracking
		// await PATCH(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`, {
		// 	date: '2025-10-18',
		// 	time: '00:01:03',
		// 	datetime: '2025-10-18T01:11:21',
		// 	timestamp: '2025-10-18T01:11:21.000Z'
		// });

		// Activate the draft with German locale
		await POST(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/ProcessorService.draftActivate?sap-locale=de`, {});

		// Get changes via OData (with localization) and from DB (raw values)
		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/changes?sap-locale=en`);

		// const updateChanges = changes.filter((change) => change.modification === 'Update');
		const dbChanges = await SELECT.from('sap.changelog.ChangeView').where({
			entityKey: incidentID,
			modification: 'create',
			attribute: { in: ['date', 'time', 'datetime', 'timestamp'] }
		});

		const dateChange = changes.find((change) => change.attribute === 'date');
		const dateDBChange = dbChanges.find((change) => change.attribute === 'date');
		expect(dateChange).toBeTruthy();
		expect(dateDBChange).toBeTruthy();
		// expect(dateChange.valueChangedFrom).not.toEqual(dateDBChange.valueChangedFrom);
		expect(dateChange.valueChangedTo).not.toEqual(dateDBChange.valueChangedTo);

		const timeChange = changes.find((change) => change.attribute === 'time');
		const timeDBChange = dbChanges.find((change) => change.attribute === 'time');
		// expect(timeChange.valueChangedFrom).not.toEqual(timeDBChange.valueChangedFrom);
		expect(timeChange.valueChangedTo).not.toEqual(timeDBChange.valueChangedTo);

		const dateTimeChange = changes.find((change) => change.attribute === 'datetime');
		const dateTimeDBChange = dbChanges.find((change) => change.attribute === 'datetime');
		// expect(dateTimeChange.valueChangedFrom).not.toEqual(dateTimeDBChange.valueChangedFrom);
		expect(dateTimeChange.valueChangedTo).not.toEqual(dateTimeDBChange.valueChangedTo);

		const timestampChange = changes.find((change) => change.attribute === 'timestamp');
		const timestampDBChange = dbChanges.find((change) => change.attribute === 'timestamp');
		// expect(timestampChange.valueChangedFrom).not.toEqual(timestampDBChange.valueChangedFrom);
		expect(timestampChange.valueChangedTo).not.toEqual(timestampDBChange.valueChangedTo);
	});

	it.skip('Multi key entities can be change tracked', async () => { });
});

describe('Non ID key support', () => {
	it('Non ID entities can be change tracked', async () => {
		// Create a new book with initial title
		const initialTitle = `Initial Book ${Math.floor(Math.random() * 1000)}`;
		const { bookNOT_ID } = await createBookNotID({ title: initialTitle });

		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});


		await PATCH(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)`, {
			title: 'ABCDEF'
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		// Verify the change is tracked (filter for Update, not Create)
		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'title' && change.modification === 'Update');
		expect(change).toHaveProperty('valueChangedFrom', initialTitle);
		expect(change).toHaveProperty('valueChangedTo', 'ABCDEF');
	});

	it('Change track new composition with non ID key', async () => {
		const { bookNOT_ID } = await createBookNotID();

		// Edit the book (put into draft mode)
		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		// Add a new page to the book
		const newPageNOT_ID = Math.floor(Math.random() * 10000) + 100;
		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/pages`, {
			NOT_ID: newPageNOT_ID,
			page: 2
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page');
		expect(change).toHaveProperty('valueChangedFrom', '');
		expect(change).toHaveProperty('valueChangedTo', '2');
		expect(change).toHaveProperty('modification', 'Create');
		expect(change).toHaveProperty('serviceEntityPath', `ProcessorService.BooksNotID(${bookNOT_ID})/ProcessorService.PagesNotID(${newPageNOT_ID})`);
	});

	it('Change track modified composition with non ID key', async () => {
		const { bookNOT_ID, pageNOT_ID } = await createBookNotID({}, 1);

		// Edit the book (put into draft mode)
		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await PATCH(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/pages(NOT_ID=${pageNOT_ID},IsActiveEntity=false)`, {
			page: 2
		});

		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page' && change.modification === 'Update');
		expect(change).toHaveProperty('valueChangedFrom', '1');
		expect(change).toHaveProperty('valueChangedTo', '2');
		expect(change).toHaveProperty('modification', 'Update');
		expect(change).toHaveProperty('serviceEntityPath', `ProcessorService.BooksNotID(${bookNOT_ID})/ProcessorService.PagesNotID(${pageNOT_ID})`);
	});

	it('Change track deleted composition with non ID key', async () => {
		const { bookNOT_ID, pageNOT_ID } = await createBookNotID({}, 1);

		// Edit the book (put into draft mode)
		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});

		await DELETE(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/pages(NOT_ID=${pageNOT_ID},IsActiveEntity=false)`);

		await POST(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/BooksNotID(NOT_ID=${bookNOT_ID},IsActiveEntity=true)/changes`);
		const change = changes.find((change) => change.attribute === 'page' && change.modification === 'Delete');
		expect(change).toHaveProperty('valueChangedFrom', '1');
		expect(change).toHaveProperty('valueChangedTo', '');
		expect(change).toHaveProperty('modification', 'Delete');
		expect(change).toHaveProperty('serviceEntityPath', `ProcessorService.BooksNotID(${bookNOT_ID})/ProcessorService.PagesNotID(${pageNOT_ID})`);
	});

	it('Change track patched association on composition using document approach', async () => {
		// Create a new order with an order product (no country set initially)
		const orderProductID = cds.utils.uuid();
		const orderID = await createOrder({
			orderProducts: [
				{
					ID: orderProductID
				}
			]
		});

		// Patch the order to set the country on the order product
		const { status } = await PATCH(`odata/v4/processor/Orders(${orderID})`, {
			orderProducts: [
				{
					ID: orderProductID,
					country: {
						code: 'DE'
					}
				}
			]
		});
		expect(status).toEqual(200);

		const {
			data: { value: changes }
		} = await GET(`odata/v4/processor/Orders(${orderID})/changes`);
		const countryChanges = changes.filter((change) => change.attribute === 'Country/Region');
		expect(countryChanges.length).toEqual(1);
		const change = countryChanges[0];
		expect(change).toHaveProperty('valueChangedFrom', '');
		expect(change).toHaveProperty('valueChangedTo', 'DE');
		expect(change).toHaveProperty('modification', 'Update');
		expect(change).toHaveProperty('serviceEntityPath', `ProcessorService.Orders(${orderID})/ProcessorService.OrderProducts(${orderProductID})`);
	});
});
