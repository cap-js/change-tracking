const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, GET, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('change log generation', () => {
	describe('Basic CRUD operations', () => {
		it('logs field values when creating a new record', async () => {
			const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				number: 1,
				bool: true,
				title: 'My test-record'
			});

			const {
				data: { value: changes }
			} = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes`);
			const numberLog = changes.find((change) => change.attribute === 'number');
			const boolLog = changes.find((change) => change.attribute === 'bool');

			expect(numberLog).toBeTruthy();
			expect(numberLog).toMatchObject({
				entityKey: record.ID,
				modification: 'create',
				modificationLabel: 'Create',
				objectID: 'My test-record',
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityLabel: 'Different field types',
				valueChangedFrom: null,
				valueChangedTo: '1'
			});

			expect(boolLog).toBeTruthy();
			expect(boolLog).toMatchObject({
				entityKey: record.ID,
				modification: 'create',
				modificationLabel: 'Create',
				objectID: 'My test-record',
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityLabel: 'Different field types',
				valueChangedFrom: null,
				valueChangedTo: 'true'
			});
		});

		it('logs old and new values when updating a record', async () => {
			const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				number: 1,
				title: 'My test-record'
			});
			await PATCH(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})`, {
				bool: true
			});

			const {
				data: { value: changes }
			} = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes?$filter=modification eq 'update'`);
			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				attribute: 'bool',
				entityKey: record.ID,
				modification: 'update',
				modificationLabel: 'Update',
				objectID: 'My test-record',
				entity: 'sap.change_tracking.DifferentFieldTypes',
				entityLabel: 'Different field types',
				valueChangedFrom: null,
				valueChangedTo: 'true'
			});
		});

		it('logs field values when deleting a record', async () => {
			const testingSRV = await cds.connect.to('VariantTesting');
			const { ChangeView } = testingSRV.entities;

			const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
				number: 1,
				bool: true
			});

			const {
				data: { value: beforeChanges }
			} = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes`);
			expect(beforeChanges.length > 0).toBeTruthy();

			await DELETE(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})`);

			const afterChanges = await SELECT.from(ChangeView).where({ entityKey: record.ID, modification: 'delete' });
			expect(afterChanges.length).toEqual(2);
		});

		it('generates separate change logs for each entity when batch inserting multiple records', async () => {
			const testingSRV = await cds.connect.to('VariantTesting');
			const { ChangeView, DifferentFieldTypes } = testingSRV.entities;

			const e1ID = cds.utils.uuid();
			const e2ID = cds.utils.uuid();
			const e3ID = cds.utils.uuid();
			const data = [
				{
					ID: e1ID,
					bool: false,
					number: 0,
					children: [
						{
							ID: cds.utils.uuid(),
							double: 10
						},
						{
							ID: cds.utils.uuid(),
							double: 12
						}
					]
				},
				{
					ID: e2ID,
					bool: true,
					number: 10,
					children: [
						{
							ID: cds.utils.uuid(),
							double: 10
						},
						{
							ID: cds.utils.uuid(),
							double: 12
						}
					]
				},
				{
					ID: e3ID,
					bool: false,
					number: 20,
					children: [
						{
							ID: cds.utils.uuid(),
							double: 10
						},
						{
							ID: cds.utils.uuid(),
							double: 12
						}
					]
				}
			];
			await INSERT.into(DifferentFieldTypes).entries(data);

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[e1ID, e2ID, e3ID]}`;
			expect(changes.length).toEqual(6);
			expect(changes.some((c) => c.modification !== 'create')).toEqual(false);
			expect(changes.some((c) => c.entity !== 'sap.change_tracking.DifferentFieldTypes')).toEqual(false);

			const changesOrder1 = changes.filter((change) => change.entityKey === e1ID);

			const numberChange1 = changesOrder1.find((change) => change.attribute === 'number');
			expect(numberChange1.valueChangedFrom).toEqual(null);
			expect(Number(numberChange1.valueChangedTo)).toEqual(0);

			const boolChange1 = changesOrder1.find((change) => change.attribute === 'bool');
			expect(boolChange1.valueChangedFrom).toEqual(null);
			expect(boolChange1.valueChangedTo).toEqual('false');

			const changesOrder2 = changes.filter((change) => change.entityKey === e2ID);

			const numberChange2 = changesOrder2.find((change) => change.attribute === 'number');
			expect(numberChange2.valueChangedFrom).toEqual(null);
			expect(Number(numberChange2.valueChangedTo)).toEqual(10);

			const boolChange2 = changesOrder2.find((change) => change.attribute === 'bool');
			expect(boolChange2.valueChangedFrom).toEqual(null);
			expect(boolChange2.valueChangedTo).toEqual('true');

			const changesOrder3 = changes.filter((change) => change.entityKey === e3ID);

			const numberChange3 = changesOrder3.find((change) => change.attribute === 'number');
			expect(numberChange3.valueChangedFrom).toEqual(null);
			expect(Number(numberChange3.valueChangedTo)).toEqual(20);

			const boolChange3 = changesOrder3.find((change) => change.attribute === 'bool');
			expect(boolChange3.valueChangedFrom).toEqual(null);
			expect(boolChange3.valueChangedTo).toEqual('false');
		});
	});

	describe('composition tracking', () => {
		it('does not link child entity changes to the root entity when composition field is not annotated', async () => {
			const processorService = await cds.connect.to('ProcessorService');
			const { ChangeView } = processorService.entities;

			const incidentsID = cds.utils.uuid();
			const conversationID = cds.utils.uuid();
			await POST(`/odata/v4/processor/Incidents`, {
				ID: incidentsID,
				conversation: [{ ID: conversationID, message: 'test message' }]
			});
			await POST(`/odata/v4/processor/Incidents(ID=${incidentsID}, IsActiveEntity=false)/ProcessorService.draftActivate`, {});

			const compositeKey = `${String(incidentsID).length},${incidentsID};${String(conversationID).length},${conversationID}`;

			const changes = await SELECT.one.from(ChangeView).where({ entityKey: compositeKey });
			expect(changes.entity).toEqual('sap.capire.incidents.Incidents.conversation');
			expect(changes.attribute).toEqual('message');
			expect(changes.modification).toEqual('create');
			expect(changes.valueChangedFrom).toEqual(null);
			expect(changes.valueChangedTo).toEqual('test message');
			expect(changes.parent_ID).toEqual(null);
		});

		// Limitation because deep queries are not run in sequential order
		it.skip('links child entity changes to the root entity when deep creating nested data', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const orderItemNoteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID, notes: [{ ID: orderItemNoteID, content: 'new content' }] }]
			});
			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, orderItemNoteID]}`;
			expect(changes.length).toEqual(4);

			// Find the new Order.orderItems entry (different from the one created during initial POST)
			const orderChange = changes.find((c) => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			const orderItemChanges = changes.filter((c) => c.entityKey === orderItemID);
			expect(orderItemChanges.length).toEqual(2);

			const orderItemChangeOrder = orderItemChanges.find((c) => c.attribute === 'order');
			expect(orderItemChangeOrder).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'order',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: orderID,
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Association'
			});

			const orderItemChangeNotes = orderItemChanges.find((c) => c.attribute === 'notes');
			expect(orderItemChangeNotes).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find((c) => c.entityKey === orderItemNoteID);
			expect(orderItemNoteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: 'new content',
				parent_ID: orderItemChangeNotes.ID,
				valueDataType: 'cds.String'
			});
		});
		it('links child entity changes to the root entity when creating nested data', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const orderItemNoteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				title: 'Test Order', // Provide title to ensure Order has a 'create' changelog entry
				orderItems: [{ ID: orderItemID }]
			});

			// Check changes before creating OrderItemNote
			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID]}`;
			expect(changesBefore.length).toEqual(3); // +1 for Order.title 'create' entry
			const orderChangeBefore = changesBefore.find((c) => c.entityKey === orderID && c.attribute === 'orderItems');
			expect(orderChangeBefore).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null
			});

			const orderItemChangeBefore = changesBefore.find((c) => c.entityKey === orderItemID);
			expect(orderItemChangeBefore).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'order',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: orderID,
				parent_ID: orderChangeBefore.ID
			});

			await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes`, {
				ID: orderItemNoteID,
				content: 'new content'
			});
			// Should create new change for field orderItems on Order with a link to OrderItemNote change (three new changes in total)
			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, orderItemNoteID]}`;
			expect(changes.length).toEqual(6); // +1 for Order.title 'create' entry

			// Find the new Order.orderItems entry (different from the one created during initial POST)
			const newOrderChange = changes.find((c) => c.entityKey === orderID && c.attribute === 'orderItems' && c.ID !== orderChangeBefore.ID);
			expect(newOrderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'update',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			// The OrderItem entry should be for the 'notes' composition field, linking to the Order.orderItems entry
			const noteChange = changes.find((c) => c.entityKey === orderItemID && c.ID !== orderItemChangeBefore.ID);
			expect(noteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: newOrderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find((c) => c.entityKey === orderItemNoteID);
			expect(orderItemNoteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: 'new content',
				parent_ID: noteChange.ID
			});
		});

		it('logs updated child values as changes on the parent entity', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const noteID = cds.utils.uuid();

			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'original note' }] }]
			});

			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]}`;
			const transactionID = changesBefore.find((c) => c.transactionID).transactionID;
			await PATCH(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`, {
				content: 'new content'
			});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(3);

			const orderChange = changes.find((c) => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			const orderItemChange = changes.find((c) => c.entityKey === orderItemID);
			expect(orderItemChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'update',
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find((c) => c.entityKey === noteID);
			expect(orderItemNoteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'update',
				parent_ID: orderItemChange.ID,
				valueDataType: 'cds.String'
			});
		});

		it('links child entity changes to the root entity when deleting nested data', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const noteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'note to delete' }] }]
			});

			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]}`;
			const transactionID = changesBefore.find((c) => c.transactionID).transactionID;

			await DELETE(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`);

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(3);

			const orderChange = changes.find((c) => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			const orderItemChange = changes.find((c) => c.entityKey === orderItemID);
			expect(orderItemChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'delete',
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const noteChange = changes.find((c) => c.entityKey === noteID);
			expect(noteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'delete',
				valueChangedFrom: 'note to delete',
				valueChangedTo: null,
				parent_ID: orderItemChange.ID
			});
		});

		it('correctly identifies root entity when URL path contains associated entities', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const reportID = cds.utils.uuid();
			const orderID = cds.utils.uuid();
			// Report has association to many Orders, changes on OrderItem shall be logged on Order
			await POST(`/odata/v4/admin/Report`, {
				ID: reportID
			});
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				report_ID: reportID,
				title: 'Test Order' // Provide title to ensure Order has a 'create' changelog entry
			});

			const { data: orderItem } = await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems`, {
				order_ID: orderID,
				quantity: 10,
				price: 5
			});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItem.ID]}`;
			expect(changes.length).toEqual(4); // +1 for Order.title 'create' entry

			// Order.orderItems composition entry should exist with parent_ID = null
			const orderChange = changes.find((c) => c.entityKey === orderID && c.attribute === 'orderItems');
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			// OrderItem entry should link to Order.orderItems entry
			const orderItemChange = changes.filter((c) => c.entityKey === orderItem.ID);
			expect(orderItemChange.length).toEqual(2);
			const quantityChange = orderItemChange.find((c) => c.attribute === 'quantity');
			expect(quantityChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				modification: 'create',
				parent_ID: orderChange.ID
			});

			const orderItemOrderChange = orderItemChange.find((c) => c.attribute === 'order');
			expect(orderItemOrderChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				modification: 'create',
				parent_ID: orderChange.ID
			});
		});

		it('tracks changes on child entities during deep update operations', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const bookStoreID = cds.utils.uuid();
			const bookID = cds.utils.uuid();
			await INSERT.into(adminService.entities.BookStores).entries({
				ID: bookStoreID,
				name: 'Shakespeare and Company',
				books: [{ ID: bookID, title: 'Old Wuthering Heights Test', author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387' }]
			});

			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]}`;
			const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

			// Update the book title through deep update on existing data
			await UPDATE(adminService.entities.BookStores)
				.where({ ID: bookStoreID })
				.with({
					books: [{ ID: bookID, title: 'Wuthering Heights Test' }]
				});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(2);

			// BookStores.books composition entry
			const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
			expect(bookStoreChange).toMatchObject({
				entity: 'sap.capire.bookshop.BookStores',
				attribute: 'books',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition',
				objectID: 'Shakespeare and Company'
			});

			// Books.title field change linked to parent
			const bookChange = changes.find((c) => c.entityKey === bookID);
			expect(bookChange).toMatchObject({
				entity: 'sap.capire.bookshop.Books',
				attribute: 'title',
				modification: 'update',
				parent_ID: bookStoreChange.ID,
				objectID: 'Wuthering Heights Test, Emily, Brontë',
				valueChangedFrom: 'Old Wuthering Heights Test',
				valueChangedTo: 'Wuthering Heights Test'
			});
		});

		it('tracks changes on inline composition elements with composite keys', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView } = adminService.entities;

			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const compositeKey = `${String(orderID).length},${orderID};${String(orderItemID).length},${orderItemID}`;

			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				Items: [
					{
						ID: orderItemID,
						quantity: 10
					}
				]
			});

			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, compositeKey]}`;
			const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

			await PATCH(`/odata/v4/admin/Order(ID=${orderID})/Items(ID=${orderItemID})`, {
				quantity: 12
			});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, compositeKey]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(2);

			// Order composition entry (parent)
			const orderChange = changes.find((c) => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'Items',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			// Inline item change linked to parent
			const itemChange = changes.find((c) => c.entityKey === compositeKey);
			expect(itemChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order.Items',
				attribute: 'quantity',
				modification: 'update',
				parent_ID: orderChange.ID,
				valueChangedFrom: '10',
				valueChangedTo: '12'
			});
		});

		it('tracks deletion of child entities during deep delete operations', async () => {
			const adminService = await cds.connect.to('AdminService');
			const { ChangeView, BookStores } = adminService.entities;

			const bookStoreID = cds.utils.uuid();
			const registryID = cds.utils.uuid();

			await adminService.run(
				INSERT.into(BookStores).entries({
					ID: bookStoreID,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-1',
						validOn: '2012-01-01'
					}
				})
			);

			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
			const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

			await UPDATE(BookStores).where({ ID: bookStoreID }).with({
				registry: null,
				registry_ID: null
			});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(2);

			// BookStores.registry composition entry (parent)
			const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
			expect(bookStoreChange).toMatchObject({
				entity: 'sap.capire.bookshop.BookStores',
				attribute: 'registry',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition',
				objectID: 'Test Bookstore'
			});

			// Registry change linked to parent
			const registryChange = changes.find((c) => c.entityKey === registryID);
			expect(registryChange).toMatchObject({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				attribute: 'validOn',
				modification: 'delete',
				parent_ID: bookStoreChange.ID,
				objectID: 'TEST-1',
				valueChangedFrom: '2012-01-01',
				valueChangedTo: null
			});
		});

		describe('Composition of one', () => {
			it('logs changes on the single child entity during creation', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const orderID = cds.utils.uuid();
				const { data: order } = await POST(`/odata/v4/admin/Order`, {
					ID: orderID,
					header: {
						status: 'Ordered'
					}
				});
				const headerID = order.header_ID;

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, headerID]}`;
				expect(changes.length).toEqual(2);

				// Order.header composition entry (parent)
				const orderChange = changes.find((c) => c.entityKey === orderID);
				expect(orderChange).toMatchObject({
					entity: 'sap.capire.bookshop.Order',
					attribute: 'header',
					modification: 'create',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				// OrderHeader change linked to parent
				const headerChange = changes.find((c) => c.entityKey === headerID);
				expect(headerChange).toMatchObject({
					entity: 'sap.capire.bookshop.OrderHeader',
					attribute: 'status',
					modification: 'create',
					parent_ID: orderChange.ID,
					valueChangedFrom: null,
					valueChangedTo: 'Ordered'
				});
			});

			it('logs changes on the single child entity during deletion', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const orderID = cds.utils.uuid();
				// Check if the object ID obtaining failed due to lacking rootEntityKey would lead to dump
				cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];

				const { data: order } = await POST(`/odata/v4/admin/Order`, {
					ID: orderID,
					header: {
						status: 'Shipped'
					}
				});
				const headerID = order.header_ID;

				const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, headerID]}`;
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				await DELETE(`/odata/v4/admin/Order(ID=${orderID})/header`);

				const changes = await SELECT.from(ChangeView).where({ entityKey: { in: [orderID, headerID] }, transactionID: { '!=': transactionID } });
				expect(changes.length).toEqual(2);

				// Order.header composition entry (parent)
				const orderChange = changes.find((c) => c.entityKey === orderID);
				expect(orderChange).toMatchObject({
					entity: 'sap.capire.bookshop.Order',
					attribute: 'header',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				// OrderHeader change linked to parent
				const headerChange = changes.find((c) => c.entityKey === headerID);
				expect(headerChange).toMatchObject({
					entity: 'sap.capire.bookshop.OrderHeader',
					attribute: 'status',
					modification: 'delete',
					parent_ID: orderChange.ID,
					valueChangedFrom: 'Shipped',
					valueChangedTo: null
				});

				delete cds.services.AdminService.entities.Order['@changelog'];
			});

			// REVISIT: Localization of date values not supported yet
			it('logs changes on child entity during deep create with draft', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const registryID = cds.utils.uuid();

				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'test bookstore name',
					registry: {
						ID: registryID,
						code: 'San Francisco-2',
						validOn: '2022-01-01'
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;

				// BookStores.registry composition entry (parent)
				const registryChange = changes.find((c) => c.attribute === 'registry');
				expect(registryChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'registry',
					modification: 'create',
					parent_ID: null,
					valueDataType: 'cds.Composition',
					objectID: 'test bookstore name'
				});

				// Registry change linked to parent
				const validOnChange = changes.find((c) => c.attribute === 'validOn');
				expect(validOnChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStoreRegistry',
					attribute: 'validOn',
					modification: 'create',
					parent_ID: registryChange.ID,
					objectID: 'San Francisco-2',
					valueChangedFrom: null,
					// valueChangedTo: 'Jan 1, 2022'
					valueChangedTo: '2022-01-01'
				});
			});

			// REVISIT: Localization of date values not supported yet
			it('logs changes when updating child via deep update on parent entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const registryID = cds.utils.uuid();
				const draftUUID = cds.utils.uuid();

				// Create bookstore with registry using POST to properly support draft
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-REG',
						validOn: '2022-10-15'
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)`, {
					registry: {
						ID: registryID,
						validOn: '2022-01-01',
						DraftAdministrativeData: {
							DraftUUID: draftUUID
						}
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]} and transactionID != ${transactionID}`;
				expect(changes.length).toEqual(2);

				// BookStores.registry composition entry (parent)
				const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
				expect(bookStoreChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'registry',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition',
					objectID: 'Test Bookstore'
				});

				// Registry change linked to parent
				const registryChange = changes.find((c) => c.entityKey === registryID);
				expect(registryChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStoreRegistry',
					attribute: 'validOn',
					attributeLabel: 'Valid On',
					modification: 'update',
					parent_ID: bookStoreChange.ID,
					// valueChangedFrom: 'Oct 15, 2022',
					// valueChangedTo: 'Jan 1, 2022'
					valueChangedFrom: '2022-10-15',
					valueChangedTo: '2022-01-01'
				});
			});

			it('logs changes when updating child directly via its own endpoint', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const registryID = cds.utils.uuid();

				// Create bookstore with registry using POST to properly support draft
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-REG',
						validOn: '2018-09-01'
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/BookStoreRegistry(ID=${registryID},IsActiveEntity=false)`, {
					validOn: '2022-01-01'
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]} and transactionID != ${transactionID}`;
				expect(changes.length).toEqual(2);

				// BookStores.registry composition entry (parent)
				const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
				expect(bookStoreChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'registry',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition',
					objectID: 'Test Bookstore'
				});

				// Registry change linked to parent
				const registryChange = changes.find((c) => c.entityKey === registryID);
				expect(registryChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStoreRegistry',
					attribute: 'validOn',
					attributeLabel: 'Valid On',
					modification: 'update',
					parent_ID: bookStoreChange.ID,
					// intended - localization not supported yet
					// expect(registryChange.valueChangedFrom).toEqual('Sep 1, 2018');
					// expect(registryChange.valueChangedTo).toEqual('Jan 1, 2022');
					valueChangedFrom: '2018-09-01',
					valueChangedTo: '2022-01-01'
				});
			});
		});

		describe('Composition of many', () => {
			it('logs each created child as a separate change on the root entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const book1ID = cds.utils.uuid();
				const book2ID = cds.utils.uuid();

				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Shakespeare and Company',
					books: [
						{ ID: book1ID, title: 'Test Book 1' },
						{ ID: book2ID, title: 'Test Book 2' }
					]
				});

				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Composition of many logs on the parent entity (BookStores) since 'books' is an attribute of BookStores
				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					entityKey: bookStoreID,
					attribute: 'books',
					modification: 'create'
				});

				expect(changes.length).toEqual(1);
				expect(changes[0].entity).toEqual('sap.capire.bookshop.BookStores');
				expect(changes[0].valueChangedFrom).toEqual(null);
				expect(changes[0].valueChangedTo).toEqual(null);
				expect(changes[0].objectID).toEqual('Shakespeare and Company');

				const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: changes[0].ID });
				expect(relatedChanges.length).toEqual(2);
				const change1 = relatedChanges.find((change) => change.valueChangedTo === 'Test Book 1');
				const change2 = relatedChanges.find((change) => change.valueChangedTo === 'Test Book 2');

				// entity is now the parent (BookStores), not the child (Books)
				expect(change1.entity).toEqual('sap.capire.bookshop.Books');
				expect(change1.entityKey).toEqual(book1ID);
				expect(change1.attribute).toEqual('title');
				expect(change1.valueChangedFrom).toEqual(null);
				expect(change1.valueChangedTo).toEqual('Test Book 1');

				expect(change2.entity).toEqual('sap.capire.bookshop.Books');
				expect(change2.entityKey).toEqual(book2ID);
				expect(change2.attribute).toEqual('title');
				expect(change2.valueChangedFrom).toEqual(null);
				expect(change2.valueChangedTo).toEqual('Test Book 2');
			});

			it('links child entity changes to the root entity when updating nested data', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const bookID = cds.utils.uuid();

				// Create BookStore with a book
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Shakespeare and Company',
					books: [{ ID: bookID, title: 'Original Title' }]
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Edit draft and update the book title
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
					title: 'Updated Title'
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Composition of many logs on the parent entity (BookStores)
				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					entityKey: bookStoreID,
					attribute: 'books',
					modification: 'update'
				});

				expect(changes.length).toEqual(1);
				expect(changes[0].entity).toEqual('sap.capire.bookshop.BookStores');
				expect(changes[0].entityKey).toEqual(bookStoreID);
				expect(changes[0].valueChangedFrom).toEqual(null);
				expect(changes[0].valueChangedTo).toEqual(null);
				expect(changes[0].objectID).toEqual('Shakespeare and Company');

				// check related changes
				const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: changes[0].ID });
				expect(relatedChanges.length).toEqual(1);
				expect(relatedChanges[0].entity).toEqual('sap.capire.bookshop.Books');
				expect(relatedChanges[0].entityKey).toEqual(bookID);
				expect(relatedChanges[0].attribute).toEqual('title');
				expect(relatedChanges[0].modification).toEqual('update');
				expect(relatedChanges[0].valueChangedFrom).toEqual('Original Title');
				expect(relatedChanges[0].valueChangedTo).toEqual('Updated Title');
			});

			it('logs deleted child values as changes on the root entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const bookID = cds.utils.uuid();

				// Create BookStore with a book
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Shakespeare and Company',
					books: [{ ID: bookID, title: 'Book to Delete' }]
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Edit draft and delete the book
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await DELETE(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`);
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]}`;
				const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID && c.modification === 'update');
				expect(bookStoreChange).toMatchObject({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'books',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition',
					objectID: 'Shakespeare and Company'
				});

				const bookDeleteChange = changes.find((c) => c.entityKey === bookID && c.modification === 'delete');
				expect(bookDeleteChange).toMatchObject({
					entity: 'sap.capire.bookshop.Books',
					attribute: 'title',
					modification: 'delete',
					valueChangedFrom: 'Book to Delete',
					valueChangedTo: null,
					parent_ID: bookStoreChange.ID
				});
			});
		});

		describe('Composition of one (aspect)', () => {
			it('logs changes on aspect child during creation via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectOne: {
						ID: childID,
						aspect: 'Aspect Value One'
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]}`;

				// Parent composition entry
				const parentChange = changes.find((c) => c.entityKey === parentID && c.attribute === 'childrenAspectOne');
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenAspectOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				// Aspect child change linked to parent
				const childChange = changes.find((c) => c.entityKey === compositeKey);
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
					attribute: 'aspect',
					modification: 'create',
					parent_ID: parentChange.ID,
					valueChangedFrom: null,
					valueChangedTo: 'Aspect Value One'
				});
			});

			it('logs changes on aspect child during update via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				// Create with initial value
				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectOne: {
						ID: childID,
						aspect: 'Original Aspect'
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and update aspect child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await PATCH(`/odata/v4/variant-testing/TrackingComposition_childrenAspectOne(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`, {
					aspect: 'Updated Aspect'
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

				// Parent composition entry
				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenAspectOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				// Aspect child change linked to parent
				const childChange = changes.find((c) => c.entityKey === compositeKey);
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
					attribute: 'aspect',
					modification: 'update',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Original Aspect',
					valueChangedTo: 'Updated Aspect'
				});
			});

			it('logs changes on aspect child during deletion via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				// Create with initial value
				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectOne: {
						ID: childID,
						aspect: 'Aspect To Delete'
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and delete the aspect child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await DELETE(`/odata/v4/variant-testing/TrackingComposition_childrenAspectOne(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`);
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenAspectOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === compositeKey && c.modification === 'delete');
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
					attribute: 'aspect',
					modification: 'delete',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Aspect To Delete',
					valueChangedTo: null
				});
			});
		});

		describe('Composition of many (aspect)', () => {
			it('logs each created aspect child as a separate change on the root entity', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const child1ID = cds.utils.uuid();
				const child2ID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectMany: [
						{ ID: child1ID, aspect: 'Aspect Child 1' },
						{ ID: child2ID, aspect: 'Aspect Child 2' }
					]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey1 = `${String(parentID).length},${parentID};${String(child1ID).length},${child1ID}`;
				const compositeKey2 = `${String(parentID).length},${parentID};${String(child2ID).length},${child2ID}`;

				// Composition entry on the parent
				const x = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey1, compositeKey2]}`;
				const parentChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.change_tracking.TrackingComposition',
					entityKey: parentID,
					attribute: 'childrenAspectMany',
					modification: 'update'
				});
				expect(parentChanges.length).toEqual(1);
				expect(parentChanges[0].parent_ID).toEqual(null);

				// Child changes linked to parent
				const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: parentChanges[0].ID });
				expect(relatedChanges.length).toEqual(2);

				const change1 = relatedChanges.find((c) => c.valueChangedTo === 'Aspect Child 1');
				expect(change1).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
					entityKey: compositeKey1,
					attribute: 'aspect',
					modification: 'create',
					valueChangedFrom: null,
					valueChangedTo: 'Aspect Child 1'
				});

				const change2 = relatedChanges.find((c) => c.valueChangedTo === 'Aspect Child 2');
				expect(change2).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
					entityKey: compositeKey2,
					attribute: 'aspect',
					modification: 'create',
					valueChangedFrom: null,
					valueChangedTo: 'Aspect Child 2'
				});
			});

			it('links aspect child changes to the root entity when updating nested data', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectMany: [{ ID: childID, aspect: 'Original Aspect' }]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and update the aspect child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await PATCH(`/odata/v4/variant-testing/TrackingComposition_childrenAspectMany(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`, {
					aspect: 'Updated Aspect'
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenAspectMany',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === compositeKey);
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
					attribute: 'aspect',
					modification: 'update',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Original Aspect',
					valueChangedTo: 'Updated Aspect'
				});
			});

			it('logs deleted aspect child values as changes on the root entity', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenAspectMany: [{ ID: childID, aspect: 'Aspect To Delete' }]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and delete the aspect child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await DELETE(`/odata/v4/variant-testing/TrackingComposition_childrenAspectMany(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`);
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenAspectMany',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === compositeKey && c.modification === 'delete');
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
					attribute: 'aspect',
					modification: 'delete',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Aspect To Delete',
					valueChangedTo: null
				});
			});
		});

		describe('Composition of one (explicit foreign key)', () => {
			it('logs changes on explicit FK child during creation via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitOne: {
						ID: childID,
						title: 'Explicit One Title',
						price: 9.99
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]}`;

				// Parent composition entry
				const parentChange = changes.find((c) => c.entityKey === parentID && c.attribute === 'childrenExplicitOne');
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenExplicitOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				// Explicit FK child changes linked to parent
				const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title');
				expect(titleChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionOne',
					attribute: 'title',
					modification: 'create',
					parent_ID: parentChange.ID,
					valueChangedFrom: null,
					valueChangedTo: 'Explicit One Title'
				});

				const priceChange = changes.find((c) => c.entityKey === childID && c.attribute === 'price');
				expect(priceChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionOne',
					attribute: 'price',
					modification: 'create',
					parent_ID: parentChange.ID,
					valueChangedFrom: null,
					valueChangedTo: '9.99'
				});
			});

			it('logs changes on explicit FK child during update via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitOne: {
						ID: childID,
						title: 'Original Title',
						price: 5.0
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and update explicit FK child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await PATCH(`/odata/v4/variant-testing/ExplicitCompositionOne(ID=${childID},IsActiveEntity=false)`, {
					title: 'Updated Title'
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenExplicitOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === childID);
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionOne',
					attribute: 'title',
					modification: 'update',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Original Title',
					valueChangedTo: 'Updated Title'
				});
			});

			it('logs changes on explicit FK child during deletion via draft', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitOne: {
						ID: childID,
						title: 'Title To Delete',
						price: 12.5
					}
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and delete the explicit FK child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await DELETE(`/odata/v4/variant-testing/ExplicitCompositionOne(ID=${childID},IsActiveEntity=false)`);
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenExplicitOne',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title' && c.modification === 'delete');
				expect(titleChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionOne',
					attribute: 'title',
					modification: 'delete',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Title To Delete',
					valueChangedTo: null
				});
			});
		});

		describe('Composition of many (explicit foreign key)', () => {
			it('logs each created explicit FK child as a separate change on the root entity', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const child1ID = cds.utils.uuid();
				const child2ID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitMany: [
						{ ID: child1ID, title: 'Explicit Child 1', price: 10.0 },
						{ ID: child2ID, title: 'Explicit Child 2', price: 20.0 }
					]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				// Composition entry on the parent
				const parentChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.change_tracking.TrackingComposition',
					entityKey: parentID,
					attribute: 'childrenExplicitMany',
					modification: 'update'
				});
				expect(parentChanges.length).toEqual(1);
				expect(parentChanges[0].parent_ID).toEqual(null);

				// Child changes linked to parent
				const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: parentChanges[0].ID });
				expect(relatedChanges.length).toEqual(4); // 2 children x 2 fields (title + price)

				const title1 = relatedChanges.find((c) => c.entityKey === child1ID && c.attribute === 'title');
				expect(title1).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionMany',
					modification: 'create',
					valueChangedFrom: null,
					valueChangedTo: 'Explicit Child 1'
				});

				const title2 = relatedChanges.find((c) => c.entityKey === child2ID && c.attribute === 'title');
				expect(title2).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionMany',
					modification: 'create',
					valueChangedFrom: null,
					valueChangedTo: 'Explicit Child 2'
				});
			});

			it('links explicit FK child changes to the root entity when updating nested data', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitMany: [{ ID: childID, title: 'Original Title', price: 5.0 }]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and update explicit FK child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await PATCH(`/odata/v4/variant-testing/ExplicitCompositionMany(ID=${childID},IsActiveEntity=false)`, {
					title: 'Updated Title'
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenExplicitMany',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === childID);
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionMany',
					attribute: 'title',
					modification: 'update',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Original Title',
					valueChangedTo: 'Updated Title'
				});
			});

			it('logs deleted explicit FK child values as changes on the root entity', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const parentID = cds.utils.uuid();
				const childID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/TrackingComposition`, {
					ID: parentID,
					childrenExplicitMany: [{ ID: childID, title: 'Title To Delete', price: 15.0 }]
				});
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
				const transactionID = changesBefore.find((c) => c.transactionID)?.transactionID;

				// Edit draft and delete explicit FK child
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
				await DELETE(`/odata/v4/variant-testing/ExplicitCompositionMany(ID=${childID},IsActiveEntity=false)`);
				await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentID);
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.TrackingComposition',
					attribute: 'childrenExplicitMany',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title' && c.modification === 'delete');
				expect(titleChange).toMatchObject({
					entity: 'sap.change_tracking.ExplicitCompositionMany',
					attribute: 'title',
					modification: 'delete',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Title To Delete',
					valueChangedTo: null
				});
			});
		});

		describe('Composition of aspect with composite-key parent', () => {
			it('tracks create on inline composition child when parent has composite keys', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const year = Math.floor(Math.random() * 9000) + 1000;
				const code = cds.utils.uuid().slice(0, 8);
				const itemID = cds.utils.uuid();

				await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
					year,
					code,
					title: 'Composite Parent',
					items: [{ ID: itemID, value: 'Item One' }]
				});

				const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
				// Child key: up__year, up__code, ID — 3 composite key parts
				const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;

				const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent',
					attribute: 'items',
					modification: 'create',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value');
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent.items',
					attribute: 'value',
					modification: 'create',
					parent_ID: parentChange.ID,
					valueChangedFrom: null,
					valueChangedTo: 'Item One'
				});
			});

			it('tracks update on inline composition child when parent has composite keys', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const year = Math.floor(Math.random() * 9000) + 1000;
				const code = cds.utils.uuid().slice(0, 8);
				const itemID = cds.utils.uuid();

				// Create initial data
				await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
					year,
					code,
					title: 'Composite Parent',
					items: [{ ID: itemID, value: 'Original' }]
				});

				const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
				const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

				const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;
				const transactionID = changesBefore[0]?.transactionID;

				await PATCH(`/odata/v4/variant-testing/CompositeKeyParent(year=${year},code='${code}')`, {
					items: [{ ID: itemID, value: 'Updated' }]
				});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent',
					attribute: 'items',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value');
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent.items',
					attribute: 'value',
					modification: 'update',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'Original',
					valueChangedTo: 'Updated'
				});
			});

			it('tracks delete on inline composition child when parent has composite keys', async () => {
				const variantTesting = await cds.connect.to('VariantTesting');
				const { ChangeView } = variantTesting.entities;

				const year = Math.floor(Math.random() * 9000) + 1000;
				const code = cds.utils.uuid().slice(0, 8);
				const itemID = cds.utils.uuid();

				// Create initial data
				await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
					year,
					code,
					title: 'Composite Parent',
					items: [{ ID: itemID, value: 'To Delete' }]
				});

				const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
				const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

				const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;
				const transactionID = changesBefore[0]?.transactionID;

				await PATCH(`/odata/v4/variant-testing/CompositeKeyParent(year=${year},code='${code}')`, {
					items: []
				});

				const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]} and transactionID != ${transactionID}`;

				const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
				expect(parentChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent',
					attribute: 'items',
					modification: 'update',
					parent_ID: null,
					valueDataType: 'cds.Composition'
				});

				const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value' && c.modification === 'delete');
				expect(childChange).toMatchObject({
					entity: 'sap.change_tracking.CompositeKeyParent.items',
					attribute: 'value',
					modification: 'delete',
					parent_ID: parentChange.ID,
					valueChangedFrom: 'To Delete',
					valueChangedTo: null
				});
			});
		});
	});

	it('tracks zero values and false booleans correctly during create and delete', async () => {
		const testingSrv = await cds.connect.to('VariantTesting');
		const orderID = cds.utils.uuid();

		await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
			ID: orderID,
			bool: false,
			number: 0
		});

		let changes = await testingSrv.run(
			SELECT.from(testingSrv.entities.ChangeView).where({
				entityKey: orderID,
				modification: 'create'
			})
		);

		expect(changes.length).toEqual(2);

		const change1 = changes.find((c) => c.attribute === 'number');

		expect(change1).toHaveProperty('entityKey', orderID);
		expect(change1).toHaveProperty('modification', 'create');
		expect(change1).toHaveProperty('entityLabel', 'Different field types');
		expect(change1.valueChangedFrom).toEqual(null);
		expect(Number(change1.valueChangedTo)).toEqual(0);

		const change2 = changes.find((c) => c.attribute === 'bool');

		expect(change2).toHaveProperty('entityKey', orderID);
		expect(change2).toHaveProperty('modification', 'create');
		expect(change2).toHaveProperty('entityLabel', 'Different field types');
		expect(change2.valueChangedFrom).toEqual(null);
		expect(change2.valueChangedTo).toEqual('false');

		await DELETE(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${orderID})`);

		changes = await testingSrv.run(
			SELECT.from(testingSrv.entities.ChangeView).where({
				entityKey: orderID,
				modification: 'delete'
			})
		);

		expect(changes.length).toEqual(2);

		const change3 = changes.find((c) => c.attribute === 'number');

		expect(change3).toHaveProperty('entityKey', orderID);
		expect(change3).toHaveProperty('modification', 'delete');
		expect(change3).toHaveProperty('entityLabel', 'Different field types');
		expect(Number(change3.valueChangedFrom)).toEqual(0);
		expect(change3.valueChangedTo).toEqual(null);

		const change4 = changes.find((c) => c.attribute === 'bool');

		expect(change4).toHaveProperty('entityKey', orderID);
		expect(change4).toHaveProperty('modification', 'delete');
		expect(change4).toHaveProperty('entityLabel', 'Different field types');
		expect(change4.valueChangedFrom).toEqual('false');
		expect(change4.valueChangedTo).toEqual(null);
	});

	it('tracks changes when custom actions modify entities in the composition hierarchy', async () => {
		const adminService = await cds.connect.to('AdminService');
		const { ChangeView } = adminService.entities;

		const rootID = cds.utils.uuid();
		const lvl1ID = cds.utils.uuid();
		const lvl2ID = cds.utils.uuid();

		await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: rootID,
			title: 'RootSample title',
			children: [
				{
					ID: lvl1ID,
					title: 'Level1Sample title',
					children: [
						{
							ID: lvl2ID,
							title: 'Level2Sample title'
						}
					]
				}
			]
		});
		const orderID = cds.utils.uuid();
		const orderItemID = cds.utils.uuid();
		const noteID = cds.utils.uuid();

		await POST(`/odata/v4/admin/Order`, { ID: orderID, orderItems: [{ ID: orderItemID, notes: [{ ID: noteID }] }] });
		await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})/AdminService.activate`, { ID: lvl2ID });

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.OrderItemNote',
			entityKey: noteID,
			attribute: 'ActivationStatus'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('VALID');
		expect(changes[0].parent_ID).not.toBeNull();
		expect(changes[0].parent_entityKey).toEqual(orderItemID);
		expect(changes[0].parent_entity).toEqual('sap.capire.bookshop.OrderItem');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			modification: 'update',
			entityKey: lvl2ID,
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual('Level2Sample title');
		expect(changes[0].valueChangedTo).toEqual('Game Science');
		expect(changes[0].parent_ID).not.toBeNull();
		expect(changes[0].parent_entityKey).toEqual(lvl1ID);
		expect(changes[0].parent_entity).toEqual('sap.change_tracking.Level1Sample');
	});
});
