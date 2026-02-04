const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE } = cds.test(bookshop);

describe('change log integration test', () => {
	it('Annotate multiple native and attributes coming from one or more associated table as the object ID', async () => {
		const adminService = await cds.connect.to('AdminService');

		// Create test data: Customer, Order, and OrderItem
		const customerID = cds.utils.uuid();
		const orderID = cds.utils.uuid();
		const orderItemID = cds.utils.uuid();

		await INSERT.into('sap.capire.bookshop.Customers').entries({
			ID: customerID,
			name: 'Honda',
			city: 'Ōsaka',
			country: 'Japan'
		});

		await INSERT.into('sap.capire.bookshop.Order').entries({
			ID: orderID,
			status: 'Post',
			customer_ID: customerID
		});

		await INSERT.into('sap.capire.bookshop.OrderItemWithLongerName').entries({
			ID: orderItemID,
			order_ID: orderID,
			customer_ID: customerID,
			price: 5,
			quantity: 10
		});

		await PATCH(`/odata/v4/admin/OrderItemWithLongerName(ID=${orderItemID})`, {
			quantity: 14
		});

		let changes = await adminService.run(SELECT.from(adminService.entities.ChangeView).where({ entityKey: orderItemID }));
		expect(changes.length).toEqual(1);
		const change = changes[0];
		const IDsegments = change.objectID.split(', ');
		expect(IDsegments[0]).toEqual('Ōsaka');
		expect(IDsegments[1]).toEqual('Post');
		expect(Number(IDsegments[2])).toEqual(5);
		expect(Number(IDsegments[3])).toEqual(14);
	});

	it('Annotate multiple native attributes as the object ID', async () => {
		const adminService = await cds.connect.to('AdminService');

		// Create test data: Author
		const authorID = cds.utils.uuid();
		await INSERT.into('sap.capire.bookshop.AuthorsWithLongerChangelog').entries({
			ID: authorID,
			name_firstName: 'Emily',
			name_lastName: 'Brontë',
			placeOfBirth: 'Thornton, Yorkshire',
			placeOfDeath: 'Haworth, Yorkshire',
			dateOfBirth: '1818-07-30',
			dateOfDeath: '1848-12-19'
		});

		await PATCH(`/odata/v4/admin/AuthorsWithLongerChangelog(ID=${authorID})`, {
			placeOfBirth: 'new placeOfBirth'
		});

		const changes = await adminService.run(SELECT.from(adminService.entities.ChangeView).where({ entityKey: authorID }));
		expect(changes.length).toEqual(1);

		const change = changes[0];
		expect(change.objectID).toEqual('new placeOfBirth, Emily, Brontë, Haworth, Yorkshire, 1848-12-19, 1818-07-30');
	});

	it('Annotate fields from chained associated entities as objectID', async () => {
		const variantSrv = await cds.connect.to('VariantTesting');
		const lvl1ID = cds.utils.uuid();
		const lvl2ID = cds.utils.uuid();
		const { data: newRoot } = await POST(`/odata/v4/variant-testing/RootSample`, {
			ID: cds.utils.uuid(),
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
		const createChanges = await SELECT.from(variantSrv.entities.ChangeView).where({ entityKey: newRoot.ID, modification: 'create' });
		expect(createChanges.length).toEqual(3);
		expect(createChanges.find((c) => c.entity === 'sap.change_tracking.RootSample').objectID).toEqual(`${newRoot.ID}, RootSample title`);
		expect(createChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, Level1Sample title, ${newRoot.ID}`);
		expect(createChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, Level2Sample title, ${newRoot.ID}`);

		await PATCH(`/odata/v4/variant-testing/RootSample(ID=${newRoot.ID})`, {
			title: 'new RootSample title',
			children: [
				{
					ID: lvl1ID,
					title: 'new Level1Sample title',
					children: [
						{
							ID: lvl2ID,
							title: 'new Level2Sample title'
						}
					]
				}
			]
		});
		const updateChanges = await SELECT.from(variantSrv.entities.ChangeView).where({ entityKey: newRoot.ID, modification: 'update' });
		expect(updateChanges.length).toEqual(3);
		expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.RootSample').objectID).toEqual(`${newRoot.ID}, new RootSample title`);
		expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, new Level1Sample title, ${newRoot.ID}`);
		expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, new Level2Sample title, ${newRoot.ID}`);

		await DELETE(`/odata/v4/variant-testing/Level2Sample(ID=${lvl2ID})`);
		await DELETE(`/odata/v4/variant-testing/Level1Sample(ID=${lvl1ID})`);
		const deleteChanges = await SELECT.from(variantSrv.entities.ChangeView).where({ entityKey: newRoot.ID, modification: 'delete' });
		expect(deleteChanges.length).toEqual(2);
		expect(deleteChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, new Level1Sample title, ${newRoot.ID}`);
		expect(deleteChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, new Level2Sample title, ${newRoot.ID}`);
	});

	it('Child entity update without objectID annotation - should log object type for object ID', async () => {
		const variantSrv = await cds.connect.to('VariantTesting');
		const bookStoreID = cds.utils.uuid();
		const bookID = cds.utils.uuid();

		await POST(`/odata/v4/variant-testing/TrackingComposition`, {
			ID: bookStoreID
		});

		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});
		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});

		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=false)/children`, {
			ID: bookID,
			title: 'Original Book Title'
		});

		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});
		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});

		await PATCH(`/odata/v4/variant-testing/ComposedEntities(ID=${bookID},IsActiveEntity=false)`, {
			title: 'new title'
		});

		await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${bookStoreID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

		const changes = await variantSrv.run(
			SELECT.from(variantSrv.entities.ChangeView).where({
				modification: 'update',
				attribute: 'title',
				entityKey: bookStoreID
			})
		);
		expect(changes.length).toEqual(1);

		const change = changes[0];
		// if object type is localized, use the localized object type as object ID
		expect(change.objectID).toEqual('Book');
		expect(change.parentObjectID).toEqual('Book Store');
	});

	it('Value data type records data type of native attributes of the entity or attributes from association table which are annotated as the displayed value', async () => {
		const adminService = await cds.connect.to('AdminService');
		const bookStoreID = cds.utils.uuid();
		const bookID = cds.utils.uuid();

		await POST(`/odata/v4/admin/BookStores`, {
			ID: bookStoreID,
			name: 'Test BookStore'
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/books`, {
			ID: bookID,
			authorWithAssocObjectID_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
			author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
			title: 'test title'
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const authorChangesInDb = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.capire.bookshop.Books',
			attribute: 'authorWithAssocObjectID',
			modification: 'create',
			entityKey: bookStoreID
		});
		expect(authorChangesInDb.length).toEqual(1);

		const authorChangeInDb = authorChangesInDb[0];
		expect(authorChangeInDb.valueChangedFrom).toEqual('');
		expect(authorChangeInDb.valueChangedTo).toEqual('Emily, 1818-07-30, Brontë');
		expect(authorChangeInDb.valueDataType).toEqual('cds.String, cds.Date, cds.String');

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

		await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
			author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const authorUpdateChangesInDb = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.capire.bookshop.Books',
			attribute: 'author',
			modification: 'update',
			entityKey: bookStoreID
		});
		expect(authorUpdateChangesInDb.length).toEqual(1);

		const authorUpdateChangeInDb = authorUpdateChangesInDb[0];
		expect(authorUpdateChangeInDb.valueChangedFrom).toEqual('Emily, Brontë');
		expect(authorUpdateChangeInDb.valueChangedTo).toEqual('Charlotte, Brontë');
		expect(authorUpdateChangeInDb.valueDataType).toEqual('cds.String, cds.String');
	});

	it('Value data type records data type of native attributes of the entity or attributes from composition which are annotated as the displayed value', async () => {
		const adminService = await cds.connect.to('AdminService');
		const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores.elements.books['@changelog']));
		cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.title' }, { '=': 'books.stock' }, { '=': 'books.price' }];

		const bookStoreID = cds.utils.uuid();
		const bookID = cds.utils.uuid();

		await POST(`/odata/v4/admin/BookStores`, {
			ID: bookStoreID,
			name: 'Test BookStore'
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/books`, {
			ID: bookID,
			title: 'test title',
			stock: 2,
			price: 2.3
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const booksChangesInDb = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'books',
			modification: 'create',
			entityKey: bookStoreID
		});
		expect(booksChangesInDb.length).toEqual(1);

		const bookChangesInDb = booksChangesInDb[0];
		expect(bookChangesInDb.valueChangedFrom).toEqual('');
		const titleSegments = bookChangesInDb.valueChangedTo.split(', ');
		expect(titleSegments[0]).toEqual('test title');
		expect(Number(titleSegments[1])).toEqual(2);
		expect(Number(titleSegments[2])).toEqual(2.3);
		expect(bookChangesInDb.valueDataType).toEqual('cds.String, cds.Integer, cds.Decimal');

		// adjust sequence
		cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.stock' }, { '=': 'books.title' }, { '=': 'books.price' }];

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

		await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
			stock: 3
		});

		await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const booksUpdateChangesInDb = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'books',
			modification: 'update',
			entityKey: bookStoreID
		});
		expect(booksUpdateChangesInDb.length).toEqual(1);

		const bookUpdateChangesInDb = booksUpdateChangesInDb[0];

		const titleSegments2 = bookUpdateChangesInDb.valueChangedFrom.split(', ');
		expect(Number(titleSegments2[0])).toEqual(3);
		expect(titleSegments2[1]).toEqual('test title');
		expect(Number(titleSegments2[2])).toEqual(2.3);

		const titleSegments3 = bookUpdateChangesInDb.valueChangedTo.split(', ');
		expect(Number(titleSegments3[0])).toEqual(3);
		expect(titleSegments3[1]).toEqual('test title');
		expect(Number(titleSegments3[2])).toEqual(2.3);

		expect(bookUpdateChangesInDb.valueDataType).toEqual('cds.Integer, cds.String, cds.Decimal');

		// recover @changelog context on composition books
		cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = originalChangelog;
	});

	it('Do not change track personal data', async () => {
		const adminService = await cds.connect.to('AdminService');
		const testingSRV = await cds.connect.to('VariantTesting');
		const ID = cds.utils.uuid();
		await INSERT.into(testingSRV.entities.DifferentFieldTypes).entries({
			ID,
			dppField1: 'John Doe',
			dppField2: 'John Doe'
		});

		const changes = await SELECT.from(adminService.entities.ChangeView).where({
			entity: 'sap.change_tracking.DifferentFieldTypes',
			entityKey: ID,
			attribute: { in: ['dppField1', 'dppField2'] }
		});

		expect(changes.length).toEqual(0);
	});

	describe('Code lists', () => {
		it('Single attribute from the code list could be annotated as value', async () => {
			const adminService = await cds.connect.to('AdminService');

			// Create new BookStore with lifecycle status
			const bookStoreID = cds.utils.uuid();

			await POST(`/odata/v4/admin/BookStores`, {
				ID: bookStoreID,
				name: 'test name'
			});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

			const lifecycleStatusChanges = await adminService.run(
				SELECT.from(adminService.entities.ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'lifecycleStatus',
					entityKey: bookStoreID
				})
			);
			expect(lifecycleStatusChanges.length).toEqual(1);

			const lifecycleStatusChange = lifecycleStatusChanges[0];
			expect(lifecycleStatusChange.modification).toEqual('Create');
			expect(lifecycleStatusChange.valueChangedFrom).toEqual('');
			expect(lifecycleStatusChange.valueChangedTo).toEqual('In Preparation');

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

			await PATCH(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)`, {
				lifecycleStatus: {
					code: 'CL'
				}
			});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

			const lifecycleStatusUpdateChanges = await adminService.run(
				SELECT.from(adminService.entities.ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'lifecycleStatus',
					modification: 'update',
					entityKey: bookStoreID
				})
			);
			expect(lifecycleStatusUpdateChanges.length).toEqual(1);

			const lifecycleStatusUpdateChange = lifecycleStatusUpdateChanges[0];
			expect(lifecycleStatusUpdateChange.modification).toEqual('Update');
			expect(lifecycleStatusUpdateChange.valueChangedFrom).toEqual('In Preparation');
			expect(lifecycleStatusUpdateChange.valueChangedTo).toEqual('Closed');
		});

		it('Multiple attributes from the code list could be annotated as value', async () => {
			const adminService = await cds.connect.to('AdminService');

			// Create new BookStore and Book
			const bookStoreID = cds.utils.uuid();
			const bookID = cds.utils.uuid();

			await POST(`/odata/v4/admin/BookStores`, {
				ID: bookStoreID,
				name: 'Test BookStore'
			});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/books`, {
				ID: bookID,
				bookType: {
					code: 'MAN'
				}
			});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

			const bookTypeChanges = await adminService.run(
				SELECT.from(adminService.entities.ChangeView).where({
					entity: 'sap.capire.bookshop.Books',
					attribute: 'bookType',
					entityKey: bookStoreID
				})
			);
			expect(bookTypeChanges.length).toEqual(1);

			const bookTypeChange = bookTypeChanges[0];
			expect(bookTypeChange.modification).toEqual('Create');
			expect(bookTypeChange.valueChangedFrom).toEqual('');
			expect(bookTypeChange.valueChangedTo).toEqual('Management, Management Books');

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});

			await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
				bookType: {
					code: 'SCI'
				}
			});

			await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

			const bookTypeUpdateChanges = await adminService.run(
				SELECT.from(adminService.entities.ChangeView).where({
					entity: 'sap.capire.bookshop.Books',
					attribute: 'bookType',
					modification: 'update',
					entityKey: bookStoreID
				})
			);
			expect(bookTypeUpdateChanges.length).toEqual(1);

			const bookTypeUpdateChange = bookTypeUpdateChanges[0];
			expect(bookTypeUpdateChange.modification).toEqual('Update');
			expect(bookTypeUpdateChange.valueChangedFrom).toEqual('Management, Management Books');
			expect(bookTypeUpdateChange.valueChangedTo).toEqual('Science, Science Books');
		});
	});
});
