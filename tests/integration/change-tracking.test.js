const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, GET } = cds.test(bookshop);

describe('change log generation', () => {

	describe('Basic change tracking', () => {
		it('Creation - should log basic data type changes', async () => {
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

		it('Update - should log basic data type changes', async () => {
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

		it('Delete - should delete related changes', async () => {
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

		it('When creating multiple root records, change tracking for each entity should also be generated', async () => {
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

			const ids = [e1ID, e2ID, e3ID];
			let changes = await SELECT.from(ChangeView).where`entityKey in ${ids} or rootEntityKey in ${ids}`;

			expect(changes.length).toEqual(12);

			expect(changes.some((c) => c.modification !== 'create')).toEqual(false);

			let changesOrder1 = await SELECT.from(ChangeView).where`entityKey = ${e1ID} or rootEntityKey = ${e1ID}`;

			const change1 = changesOrder1.find((change) => change.attribute === 'number');
			expect(change1.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change1.valueChangedFrom).toEqual(null);
			expect(Number(change1.valueChangedTo)).toEqual(0);

			const change2 = changesOrder1.find((change) => change.attribute === 'bool');
			expect(change2.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change2.valueChangedFrom).toEqual(null);
			expect(change2.valueChangedTo).toEqual('false');

			const quantityChanges1 = changesOrder1.filter((change) => change.attribute === 'double').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges1[0].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges1[0].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges1[0].valueChangedTo)).toEqual(10);

			expect(quantityChanges1[1].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges1[1].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges1[1].valueChangedTo)).toEqual(12);

			let changesOrder2 = await SELECT.from(ChangeView).where`entityKey = ${e2ID} or rootEntityKey = ${e2ID}`;

			const change3 = changesOrder2.find((change) => change.attribute === 'number');
			expect(change3.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change3.valueChangedFrom).toEqual(null);
			expect(Number(change3.valueChangedTo)).toEqual(10);

			const change4 = changesOrder2.find((change) => change.attribute === 'bool');
			expect(change4.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change4.valueChangedFrom).toEqual(null);
			expect(change4.valueChangedTo).toEqual('true');

			const quantityChanges2 = changesOrder2.filter((change) => change.attribute === 'double').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges2[0].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges2[0].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges2[0].valueChangedTo)).toEqual(10);

			expect(quantityChanges2[1].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges2[1].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges2[1].valueChangedTo)).toEqual(12);

			let changesOrder3 = await SELECT.from(ChangeView).where`entityKey = ${e3ID} or rootEntityKey = ${e3ID}`;

			const change5 = changesOrder3.find((change) => change.attribute === 'number');
			expect(change5.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change5.valueChangedFrom).toEqual(null);
			expect(Number(change5.valueChangedTo)).toEqual(20);

			const change6 = changesOrder3.find((change) => change.attribute === 'bool');
			expect(change6.entity).toEqual('sap.change_tracking.DifferentFieldTypes');
			expect(change6.valueChangedFrom).toEqual(null);
			expect(change6.valueChangedTo).toEqual('false');

			const quantityChanges3 = changesOrder3.filter((change) => change.attribute === 'double').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges3[0].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges3[0].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges3[0].valueChangedTo)).toEqual(10);

			expect(quantityChanges3[1].entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
			expect(quantityChanges3[1].valueChangedFrom).toEqual(null);
			expect(Number(quantityChanges3[1].valueChangedTo)).toEqual(12);
		});
	});

	describe('Composition tracking', () => {
		it('Creation should log changes for root entity', async () => {
			const adminService = await cds.connect.to('AdminService');
			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const orderItemNoteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID }]
			});
			await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes`, {
				ID: orderItemNoteID,
				content: 'new content'
			});
			let changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
			const orderChanges = changes.filter((change) => {
				return change.entityKey === orderItemNoteID && change.rootEntityKey === orderItemID;
			});
			expect(orderChanges.length).toEqual(1);
			const orderChange = orderChanges[0];
			expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
			expect(orderChange.attribute).toEqual('content');
			expect(orderChange.modification).toEqual('create');
			expect(orderChange.valueChangedFrom).toEqual(null);
			expect(orderChange.valueChangedTo).toEqual('new content');
			expect(orderChange.rootEntityKey).toEqual(orderItemID);
			expect(orderChange.rootObjectID).toEqual('sap.capire.bookshop.OrderItem');
		});

		it('Update should log changes for root entity', async () => {
			const adminService = await cds.connect.to('AdminService');
			const orderID = cds.utils.uuid();
			const orderItemID = cds.utils.uuid();
			const noteID = cds.utils.uuid();
			await POST(`/odata/v4/admin/Order`, {
				ID: orderID,
				orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'original note' }] }]
			});
			await PATCH(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`, {
				content: 'new content'
			});

			let changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
			const orderChanges = changes.filter((change) => {
				return change.entityKey === noteID && change.modification === 'update';
			});
			expect(orderChanges.length).toEqual(1);
			const orderChange = orderChanges[0];
			expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
			expect(orderChange.attribute).toEqual('content');
			expect(orderChange.modification).toEqual('update');
			expect(orderChange.valueChangedFrom).toEqual('original note');
			expect(orderChange.valueChangedTo).toEqual('new content');
			expect(orderChange.rootEntityKey).toEqual(orderItemID);
			expect(orderChange.rootObjectID).toEqual('sap.capire.bookshop.OrderItem');
		});

		it('Delete should log changes for root entity', async () => {
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

		it('Create should log changes for root entity if url path contains association entity', async () => {
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

		it('Deep update - should log changes on root entity', async () => {
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

		it('Inline composition is correctly logged', async () => {
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

		it('Deep delete should log changes on root entity', async () => {
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
				modification: 'delete'
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
			it('Create should log changes for root entity', async () => {
				const id = cds.utils.uuid();
				const adminService = await cds.connect.to('AdminService');
				await POST(`/odata/v4/admin/Order`, {
					ID: id,
					header: {
						status: 'Ordered'
					}
				});
				const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
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

			it('Delete should log changes for root entity', async () => {
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

				const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView));
				const headerChanges = changes.filter((change) => {
					return change.entity === 'sap.capire.bookshop.OrderHeader' && change.modification === 'delete';
				});
				expect(headerChanges.length).toEqual(1);
				const headerChange = headerChanges[0];
				expect(headerChange.attribute).toEqual('status');
				expect(headerChange.modification).toEqual('delete');
				expect(headerChange.valueChangedFrom).toEqual('Shipped');
				expect(headerChange.valueChangedTo).toEqual(null);
				expect(headerChange.rootEntityKey).toEqual(orderID);
				expect(headerChange.rootObjectID).toEqual('sap.capire.bookshop.Order');
				delete cds.services.AdminService.entities.Order['@changelog'];
			});

			// REVISIT: Localization of date values not supported yet
			it('Deep create should log changes on root entity', async () => {
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
			it('updated on root node - should log changes for root entity', async () => {
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

			it('updated on child node - should log changes for root entity', async () => {
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
			it('Create should log changes for root entity', async () => {
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
						{ ID: book2ID, title: 'Test Book 2' },
					]
				});

				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where({
					rootEntity: 'sap.capire.bookshop.BookStores',
					rootEntityKey: bookStoreID,
					attribute: 'books',
					modification: 'create'
				});

				expect(changes.length).toEqual(2);

				const change1 = changes.find((change) => change.entityKey === book1ID);
				const change2 = changes.find((change) => change.entityKey === book2ID);

				expect(change1.entity).toEqual('sap.capire.bookshop.Books');
				expect(change1.valueChangedFrom).toEqual(null);
				expect(change1.valueChangedTo).toEqual('Test Book 1');
				expect(change1.rootObjectID).toEqual('Shakespeare and Company');

				expect(change2.entity).toEqual('sap.capire.bookshop.Books');
				expect(change2.valueChangedFrom).toEqual(null);
				expect(change2.valueChangedTo).toEqual('Test Book 2');
				expect(change2.rootObjectID).toEqual('Shakespeare and Company');
			});

			it('Update should log changes for root entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const bookID = cds.utils.uuid();

				// Create BookStore with a book
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Shakespeare and Company',
					books: [
						{ ID: bookID, title: 'Original Title' }
					]
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Edit draft and update the book title
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
					title: 'Updated Title'
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where({
					rootEntity: 'sap.capire.bookshop.BookStores',
					rootEntityKey: bookStoreID,
					attribute: 'books',
					modification: 'update'
				});

				expect(changes.length).toEqual(1);

				const change = changes[0];
				expect(change.entity).toEqual('sap.capire.bookshop.Books');
				expect(change.entityKey).toEqual(bookID);
				expect(change.valueChangedFrom).toEqual('Original Title');
				expect(change.valueChangedTo).toEqual('Updated Title');
				expect(change.rootObjectID).toEqual('Shakespeare and Company');
			});

			it('Delete should log changes for root entity', async () => {
				const adminService = await cds.connect.to('AdminService');
				const { ChangeView } = adminService.entities;

				const bookStoreID = cds.utils.uuid();
				const bookID = cds.utils.uuid();

				// Create BookStore with a book
				await POST(`/odata/v4/admin/BookStores`, {
					ID: bookStoreID,
					name: 'Shakespeare and Company',
					books: [
						{ ID: bookID, title: 'Book to Delete' }
					]
				});
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				// Edit draft and delete the book
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
				await DELETE(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`);
				await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

				const changes = await SELECT.from(ChangeView).where({
					rootEntity: 'sap.capire.bookshop.BookStores',
					rootEntityKey: bookStoreID,
					attribute: 'books',
					modification: 'delete'
				});

				expect(changes.length).toEqual(1);

				const change = changes[0];
				expect(change.entity).toEqual('sap.capire.bookshop.Books');
				expect(change.entityKey).toEqual(bookID);
				expect(change.valueChangedFrom).toEqual('Book to Delete');
				expect(change.valueChangedTo).toEqual(null);
				expect(change.rootObjectID).toEqual('Shakespeare and Company');
			});
		});
	});

	it('When creating or deleting a record with a numeric type of 0 and a boolean type of false, a changelog should also be generated', async () => {
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

	it('The change log should be captured when a child entity triggers a custom action', async () => {
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
