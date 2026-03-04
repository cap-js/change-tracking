const cds = require('@sap/cds');
const { message, expected } = require('@sap/cds/lib/log/cds-error');
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
				rootEntity: null,
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
				rootEntity: null,
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
				rootEntity: null,
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

			const changes = await SELECT.one.from(ChangeView).where({ entityKey: `${incidentsID}||${conversationID}` });
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
			const orderChange = changes.find(c => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			const orderItemChanges = changes.filter(c => c.entityKey === orderItemID);
			expect(orderItemChanges.length).toEqual(2);

			const orderItemChangeOrder = orderItemChanges.find(c => c.attribute === 'order');
			expect(orderItemChangeOrder).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'order',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: orderID,
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Association'
			});

			const orderItemChangeNotes = orderItemChanges.find(c => c.attribute === 'notes');
			expect(orderItemChangeNotes).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find(c => c.entityKey === orderItemNoteID);
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
				orderItems: [{ ID: orderItemID }]
			});

			// Check changes before creating OrderItemNote
			const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID]}`;
			expect(changesBefore.length).toEqual(2);
			const orderChangeBefore = changesBefore.find(c => c.entityKey === orderID);
			expect(orderChangeBefore).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: null
			});

			const orderItemChangeBefore = changesBefore.find(c => c.entityKey === orderItemID);
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
			expect(changes.length).toEqual(5);

			// Find the new Order.orderItems entry (different from the one created during initial POST)
			const newOrderChange = changes.find(c => c.entityKey === orderID && c.ID !== orderChangeBefore.ID);
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
			const noteChange = changes.find(c => c.entityKey === orderItemID && c.ID !== orderItemChangeBefore.ID);
			expect(noteChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'create',
				valueChangedFrom: null,
				valueChangedTo: null,
				parent_ID: newOrderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find(c => c.entityKey === orderItemNoteID);
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
			const transactionID = changesBefore.find(c => c.transactionID).transactionID;
			await PATCH(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`, {
				content: 'new content'
			});

			const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]} and transactionID != ${transactionID}`;
			expect(changes.length).toEqual(3);

			const orderChange = changes.find(c => c.entityKey === orderID);
			expect(orderChange).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'orderItems',
				modification: 'update',
				parent_ID: null,
				valueDataType: 'cds.Composition'
			});

			const orderItemChange = changes.find(c => c.entityKey === orderItemID);
			expect(orderItemChange).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'notes',
				modification: 'update',
				parent_ID: orderChange.ID,
				valueDataType: 'cds.Composition'
			});

			const orderItemNoteChange = changes.find(c => c.entityKey === noteID);
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
			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const noteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'note to delete' }] }]
			});
			await DELETE(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`);

			let changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
			const orderChanges = changes.filter((change) => {
				return change.rootEntityKey === orderItemID && change.modification === 'delete';
			});
			expect(orderChanges.length).toEqual(1);
			const orderChange = orderChanges[0];
			expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
			expect(orderChange.entityKey).toEqual(noteID);
			expect(orderChange.attribute).toEqual('content');
			expect(orderChange.modification).toEqual('delete');
			expect(orderChange.valueChangedFrom).toEqual('note to delete');
			expect(orderChange.valueChangedTo).toEqual(null);
			expect(orderChange.rootEntity).toEqual('sap.capire.bookshop.OrderItem');
			expect(orderChange.rootEntityKey).toEqual(orderItemID);
			expect(orderChange.rootObjectID).toEqual('sap.capire.bookshop.OrderItem');
		});

		it('correctly identifies root entity when URL path contains associated entities', async () => {
			const adminService = await cds.connect.to('AdminService');
			const reportID = cds.utils.uuid();
			const orderID = cds.utils.uuid();
			// Report has association to many Orders, changes on OrderItem shall be logged on Order
			await POST(`/odata/v4/admin/Report`, {
				ID: reportID
			});
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				report_ID: reportID
			});
			await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems`, {
				order_ID: orderID,
				quantity: 10,
				price: 5
			});

			let changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
			const orderChanges = changes.filter((change) => {
				return change.rootEntityKey === orderID && change.modification === 'create';
			});
			expect(orderChanges.length).toEqual(2);
		});

		it('tracks changes on child entities during deep update operations', async () => {
			const adminService = await cds.connect.to('AdminService');
			const bookStoreID = cds.utils.uuid();
			const bookID = cds.utils.uuid();
			await INSERT.into(adminService.entities.BookStores).entries({
				ID: bookStoreID,
				name: 'Shakespeare and Company',
				books: [{ ID: bookID, title: 'Old Wuthering Heights Test', author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387' }]
			});
			// Update the book title through deep update on existing data
			await UPDATE(adminService.entities.BookStores)
				.where({ ID: bookStoreID })
				.with({
					books: [{ ID: bookID, title: 'Wuthering Heights Test' }]
				});

			let changes = await SELECT.from(adminService.entities.ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				attribute: 'title',
				rootEntityKey: bookStoreID,
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].entityKey).toEqual(bookID);
			expect(changes[0].objectID).toEqual('Wuthering Heights Test, Emily, Brontë');
			expect(changes[0].rootObjectID).toEqual('Shakespeare and Company');
		});

		it('tracks changes on inline composition elements with composite keys', async () => {
			const adminService = await cds.connect.to('AdminService');
			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();

			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				Items: [
					{
						ID: orderItemID,
						quantity: 10
					}
				]
			});

			await PATCH(`/odata/v4/admin/Order(ID=${orderID})/Items(ID=${orderItemID})`, {
				quantity: 12
			});

			const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView).where({ rootEntityKey: orderID }));
			const updateChanges = changes.filter((c) => c.modification === 'update' && c.attribute === 'quantity');

			expect(updateChanges.length).toEqual(1);
			const change = updateChanges[0];
			expect(change.attribute).toEqual('quantity');
			expect(change.modification).toEqual('update');
			expect(change.valueChangedFrom).toEqual('10');
			expect(change.valueChangedTo).toEqual('12');
			expect(change.rootEntityKey).toEqual(orderID);
			expect(change.entityKey).toEqual(`${orderID}||${orderItemID}`);
		});

		it('tracks deletion of child entities during deep delete operations', async () => {
			const adminService = await cds.connect.to('AdminService');
			const bookStoreID = cds.utils.uuid();
			const registryID = cds.utils.uuid();

			await adminService.run(
				INSERT.into(adminService.entities.BookStores).entries({
					ID: bookStoreID,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-1',
						validOn: '2012-01-01'
					}
				})
			);

			await UPDATE(adminService.entities.BookStores).where({ ID: bookStoreID }).with({
				registry: null,
				registry_ID: null
			});

			const changes = await SELECT.from(adminService.entities.ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				attribute: 'validOn',
				modification: 'delete',
				entityKey: registryID
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].entityKey).toEqual(registryID);
			expect(changes[0].rootEntityKey).toEqual(bookStoreID);
			expect(changes[0].objectID).toEqual('TEST-1');
			expect(changes[0].modification).toEqual('delete');
			expect(changes[0].rootObjectID).toEqual('Test Bookstore');
			expect(changes[0].valueChangedFrom).toEqual('2012-01-01');
			expect(changes[0].valueChangedTo).toEqual(null);
		});

		describe('Composition of one', () => {
			it('logs changes on the single child entity during creation', async () => {
				const id = cds.utils.uuid();
				const adminService = await cds.connect.to('AdminService');
				await POST(`/odata/v4/admin/Order`, {
					ID: id,
					header: {
						status: 'Ordered'
					}
				});
				const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView).where({ rootEntityKey: id }));
				const headerChanges = changes.filter((change) => {
					return change.entity === 'sap.capire.bookshop.OrderHeader';
				});
				expect(headerChanges.length).toEqual(1);
				const headerChange = headerChanges[0];
				expect(headerChange.attribute).toEqual('status');
				expect(headerChange.modification).toEqual('create');
				expect(headerChange.valueChangedFrom).toEqual(null);
				expect(headerChange.valueChangedTo).toEqual('Ordered');
				expect(headerChange.rootEntityKey).toEqual(id);
				expect(headerChange.rootEntity).toEqual('sap.capire.bookshop.Order');
				expect(headerChange.rootObjectID).toEqual('sap.capire.bookshop.Order');
			});

			it('logs changes on the single child entity during deletion', async () => {
				const adminService = await cds.connect.to('AdminService');
				const orderID = cds.utils.uuid();
				// Check if the object ID obtaining failed due to lacking rootEntityKey would lead to dump
				cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];

				await POST(`/odata/v4/admin/Order`, {
					ID: orderID,
					header: {
						status: 'Shipped'
					}
				});

				await DELETE(`/odata/v4/admin/Order(ID=${orderID})/header`);

				const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView).where({ rootEntityKey: orderID }));
				const headerChanges = changes.filter((change) => {
					return change.entity === 'sap.capire.bookshop.OrderHeader' && change.modification === 'delete';
				});
				expect(headerChanges.length).toEqual(1);
				const headerChange = headerChanges[0];
				expect(headerChange.attribute).toEqual('status');
				expect(headerChange.modification).toEqual('delete');
				expect(headerChange.valueChangedFrom).toEqual('Shipped');
				expect(headerChange.valueChangedTo).toEqual(null);
				expect(headerChange.rootObjectID).toEqual('sap.capire.bookshop.Order');
				delete cds.services.AdminService.entities.Order['@changelog'];
			});

			// REVISIT: Localization of date values not supported yet
			it('logs changes on child entity during deep create with draft', async () => {
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

				const {
					data: { value: changes }
				} = await GET(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/changes?$filter=attribute eq 'validOn'`);

				expect(changes.length).toEqual(1);
				expect(changes[0].entity).toEqual('sap.capire.bookshop.BookStoreRegistry');
				expect(changes[0].entityKey).toEqual(registryID);
				expect(changes[0].objectID).toEqual('San Francisco-2');
				expect(changes[0].valueChangedFrom).toEqual(null);
				// intended
				//expect(changes[0].valueChangedTo).toEqual('Jan 1, 2022');
				expect(changes[0].valueChangedTo).toEqual('2022-01-01');
				expect(changes[0].rootEntity).toEqual('sap.capire.bookshop.BookStores');
				expect(changes[0].rootEntityKey).toEqual(bookStoreID);
				expect(changes[0].rootObjectID).toEqual('test bookstore name');
			});

			// REVISIT: Localization of date values not supported yet
			it('logs changes when updating child via deep update on parent entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const id = cds.utils.uuid();
				const registryID = cds.utils.uuid();
				const draftUUID = cds.utils.uuid();

				// Create bookstore with registry using POST to properly support draft
				await POST(`/odata/v4/admin/BookStores`, {
					ID: id,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-REG',
						validOn: '2022-10-15'
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {});

				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=false)`, {
					registry: {
						ID: registryID,
						validOn: '2022-01-01',
						DraftAdministrativeData: {
							DraftUUID: draftUUID
						}
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const registryChanges = await adminService.run(
					SELECT.from(adminService.entities.ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						entityKey: registryID,
						attribute: 'validOn',
						modification: 'update'
					})
				);
				expect(registryChanges.length).toEqual(1);
				const registryChange = registryChanges[0];
				expect(registryChange.attributeLabel).toEqual('Valid On');
				expect(registryChange.modification).toEqual('update');
				// expect(registryChange.valueChangedFrom).toEqual('Oct 15, 2022');
				// expect(registryChange.valueChangedTo).toEqual('Jan 1, 2022');
				expect(registryChange.valueChangedFrom).toEqual('2022-10-15');
				expect(registryChange.valueChangedTo).toEqual('2022-01-01');
				expect(registryChange.rootEntityKey).toEqual(id);
				expect(registryChange.rootObjectID).toEqual('Test Bookstore');
			});

			it('logs changes when updating child directly via its own endpoint', async () => {
				const adminService = await cds.connect.to('AdminService');
				// Update by calling API on child node
				const id = cds.utils.uuid();
				const registryID = cds.utils.uuid();

				// Create bookstore with registry using POST to properly support draft
				await POST(`/odata/v4/admin/BookStores`, {
					ID: id,
					name: 'Test Bookstore',
					registry: {
						ID: registryID,
						code: 'TEST-REG',
						validOn: '2018-09-01'
					}
				});
				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {});

				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/BookStoreRegistry(ID=${registryID},IsActiveEntity=false)`, {
					validOn: '2022-01-01'
				});
				await POST(`/odata/v4/admin/BookStores(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {});
				const registryChanges = await adminService.run(
					SELECT.from(adminService.entities.ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						entityKey: registryID,
						attribute: 'validOn',
						modification: 'update'
					})
				);
				expect(registryChanges.length).toEqual(1);
				const registryChange = registryChanges[0];
				expect(registryChange.attributeLabel).toEqual('Valid On');
				expect(registryChange.modification).toEqual('update');
				// expect(registryChange.valueChangedFrom).toEqual('Sep 1, 2018');
				// expect(registryChange.valueChangedTo).toEqual('Jan 1, 2022');
				expect(registryChange.valueChangedFrom).toEqual('2018-09-01');
				expect(registryChange.valueChangedTo).toEqual('2022-01-01');
				expect(registryChange.rootEntityKey).toEqual(id);
				expect(registryChange.rootObjectID).toEqual('Test Bookstore');
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

				// Composition of many logs on the parent entity (BookStores)
				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					entityKey: bookStoreID,
					attribute: 'books',
					modification: 'delete'
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
				expect(relatedChanges[0].valueChangedFrom).toEqual('Book to Delete');
				expect(relatedChanges[0].valueChangedTo).toEqual(null);
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
		let changes = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.capire.bookshop.OrderItemNote',
			entityKey: noteID,
			attribute: 'ActivationStatus'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('VALID');
		expect(changes[0].rootEntityKey).toEqual(orderItemID);

		changes = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.change_tracking.Level2Sample',
			modification: 'update',
			entityKey: lvl2ID,
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual('Level2Sample title');
		expect(changes[0].valueChangedTo).toEqual('Game Science');
		expect(changes[0].rootEntityKey).toEqual(lvl1ID);
	});
});
