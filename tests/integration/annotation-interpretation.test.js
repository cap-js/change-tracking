const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE } = cds.test(bookshop);

describe('@changelog annotation interpretation', () => {
	it('builds objectID from entity fields and associated entity fields when multiple @changelog annotations are used', async () => {
		const adminService = await cds.connect.to('AdminService');
		const { ChangeView } = adminService.entities;

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

		let changes = await adminService.run(
			SELECT.from(ChangeView).where({
				modification: 'update',
				entityKey: orderItemID
			})
		);
		expect(changes.length).toEqual(1);
		const change = changes[0];
		const IDsegments = change.objectID.split(', ');
		expect(IDsegments[0]).toEqual('Ōsaka');
		expect(IDsegments[1]).toEqual('Post');
		expect(Number(IDsegments[2])).toEqual(5);
		expect(Number(IDsegments[3])).toEqual(14);
	});

	it('builds objectID from multiple entity fields when @changelog lists several attributes', async () => {
		const adminService = await cds.connect.to('AdminService');
		const { ChangeView } = adminService.entities;

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

		const changes = await adminService.run(
			SELECT.from(ChangeView).where({
				modification: 'update',
				entityKey: authorID
			})
		);
		expect(changes.length).toEqual(1);
		expect(changes[0].objectID).toEqual('new placeOfBirth, Emily, Brontë, Haworth, Yorkshire, 1848-12-19, 1818-07-30');
	});

	// REVISIT: db-services only puts the root query of a deep query first
	it('resolves objectID through chained associations to parent entities', async () => {
		const variantSrv = await cds.connect.to('VariantTesting');
		const { ChangeView } = variantSrv.entities;

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

		const createChanges = await SELECT.from(ChangeView).where({
			modification: 'create',
			entityKey: [newRoot.ID, lvl1ID, lvl2ID]
		});
		expect(createChanges.length).toEqual(3);
		expect(createChanges.find((c) => c.entity === 'sap.change_tracking.RootSample').objectID).toEqual(`${newRoot.ID}, RootSample title`);
		expect(createChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, Level1Sample title, ${newRoot.ID}`);
		//expect(createChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, Level2Sample title, ${newRoot.ID}`);

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

		const updateChanges = await SELECT.from(ChangeView).where({
			modification: 'update',
			entityKey: [newRoot.ID, lvl1ID, lvl2ID]
		});
		expect(updateChanges.length).toEqual(3);
		expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.RootSample').objectID).toEqual(`${newRoot.ID}, new RootSample title`);
		expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, new Level1Sample title, ${newRoot.ID}`);
		//expect(updateChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, new Level2Sample title, ${newRoot.ID}`);

		await DELETE(`/odata/v4/variant-testing/Level2Sample(ID=${lvl2ID})`);
		await DELETE(`/odata/v4/variant-testing/Level1Sample(ID=${lvl1ID})`);

		const deleteChanges = await SELECT.from(ChangeView).where({
			modification: 'delete',
			entityKey: [newRoot.ID, lvl1ID, lvl2ID]
		});
		expect(deleteChanges.length).toEqual(2);
		//expect(deleteChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample').objectID).toEqual(`${lvl1ID}, new Level1Sample title, ${newRoot.ID}`);
		//expect(deleteChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample').objectID).toEqual(`${lvl2ID}, new Level2Sample title, ${newRoot.ID}`);
	});

	it('uses localized entity label as objectID when no @changelog annotation is present', async () => {
		const variantSrv = await cds.connect.to('VariantTesting');
		const { ChangeView } = variantSrv.entities;
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
			SELECT.from(ChangeView).where({
				modification: 'update',
				attribute: 'title',
				entityKey: bookID
			})
		);
		expect(changes.length).toEqual(1);

		// if object type is localized, use the localized object type as object ID
		expect(changes[0].entity).toEqual('sap.change_tracking.ComposedEntities');
		expect(changes[0].objectID).toEqual('Book');
		expect(changes[0].rootObjectID).toEqual('Book Store');
	});

	it('records data type and resolves display values for association fields annotated with @changelog', async () => {
		const adminService = await cds.connect.to('AdminService');
		const { ChangeView } = adminService.entities;
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
		const authorChangesInDb = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Books',
			attribute: 'authorWithAssocObjectID',
			modification: 'create',
			rootEntityKey: bookStoreID
		});
		expect(authorChangesInDb.length).toEqual(1);

		const authorChangeInDb = authorChangesInDb[0];
		expect(authorChangeInDb.valueChangedFromLabel).toEqual(null);
		expect(authorChangeInDb.valueChangedToLabel).toEqual('Emily, 1818-07-30, Brontë');
		expect(authorChangeInDb.valueDataType).toEqual('cds.Association'); // breaking chage, should be cds.String, cds.Date, cds.String

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
			rootEntityKey: bookStoreID
		});
		expect(authorUpdateChangesInDb.length).toEqual(1);

		const authorUpdateChangeInDb = authorUpdateChangesInDb[0];
		expect(authorUpdateChangeInDb.valueChangedFromLabel).toEqual('Emily, Brontë');
		expect(authorUpdateChangeInDb.valueChangedToLabel).toEqual('Charlotte, Brontë');
		expect(authorUpdateChangeInDb.valueDataType).toEqual('cds.Association'); // breaking chage, should be cds.String, cds.String based on the annotation (but also only for associations, not for normal values)
	});

	// REVISIT: breaking change, see if someone complains
	it('records data type and resolves display values for composition fields annotated with @changelog', async () => {
		const adminService = await cds.connect.to('AdminService');
		const { ChangeView } = adminService.entities;

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

		await INSERT.into('sap.capire.bookshop.OrderItemWithLongerName').entries({
			ID: orderItemID,
			price: 5,
			quantity: 10
		});

		await PATCH(`/odata/v4/admin/OrderItemWithLongerName(ID=${orderItemID})`, {
			customer_ID: customerID
		});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const changesInDb = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.OrderItemWithLongerName',
			attribute: 'customer',
			modification: 'update',
			entityKey: orderItemID
		});

		expect(changesInDb.length).toEqual(1);
		expect(changesInDb[0].valueChangedFromLabel).toEqual(null);
		expect(changesInDb[0].valueChangedToLabel).toEqual('Japan, Honda, Ōsaka');
		expect(changesInDb[0].valueDataType).toEqual('cds.Association'); // REVISIT: breaking change, should be cds.String, cds.String, cds.String based on the annotation (but also only for associations, not for normal values)
	});

	it('excludes fields annotated with @PersonalData from change tracking', async () => {
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

	describe('Code lists resolution', () => {
		it('displays human-readable code list name when single attribute is annotated with @changelog', async () => {
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
			expect(lifecycleStatusChange.modification).toEqual('create');
			expect(lifecycleStatusChange.valueChangedFromLabel).toEqual(null);
			expect(lifecycleStatusChange.valueChangedToLabel).toEqual('In Preparation');

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
			expect(lifecycleStatusUpdateChange.modification).toEqual('update');
			expect(lifecycleStatusUpdateChange.valueChangedFromLabel).toEqual('In Preparation');
			expect(lifecycleStatusUpdateChange.valueChangedToLabel).toEqual('Closed');
		});

		it('displays combined code list values when multiple attributes are annotated with @changelog', async () => {
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

			const bookTypeChanges = await SELECT.from(adminService.entities.ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				attribute: 'bookType',
				rootEntityKey: bookStoreID
			});
			expect(bookTypeChanges.length).toEqual(1);

			const bookTypeChange = bookTypeChanges[0];
			expect(bookTypeChange.modification).toEqual('create');
			expect(bookTypeChange.valueChangedFromLabel).toEqual(null);
			expect(bookTypeChange.valueChangedToLabel).toEqual('Management, Management Books');

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
					rootEntityKey: bookStoreID
				})
			);
			expect(bookTypeUpdateChanges.length).toEqual(1);

			const bookTypeUpdateChange = bookTypeUpdateChanges[0];
			expect(bookTypeUpdateChange.modification).toEqual('update');
			expect(bookTypeUpdateChange.valueChangedFromLabel).toEqual('Management, Management Books');
			expect(bookTypeUpdateChange.valueChangedToLabel).toEqual('Science, Science Books');
		});
	});
});
