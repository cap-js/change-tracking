const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
cds.test(bookshop);

describe('Change Tracking Integration Tests', () => {
	let adminService, db, ChangeView;

	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		db = await cds.connect.to('db');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
	});

	afterEach(() => {
		// Reset config to original values
		Object.assign(cds.env.requires['change-tracking'], {
			preserveDeletes: false,
			disableCreateTracking: false,
			disableUpdateTracking: false,
			disableDeleteTracking: false
		});
	});

	describe('Display Values - Human-readable Values', () => {
		it('should display raw value for simple fields', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'Simple Value Store',
				location: 'Amsterdam'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				attribute: 'location',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('Amsterdam');
		});

		it('should display associated entity field as value', async () => {
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book With Author Display',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 10
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'author',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('Emily, Brontë');
		});

		it('should display chained association field values', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'Store With City',
				location: 'Paris Region',
				city_ID: 'bc21e0d9-a313-4f52-8336-c1be5f66e257'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				attribute: 'city',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('Paris, FR');
		});

		it('should display code list description as value', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'Store With Status',
				location: 'Berlin',
				lifecycleStatus_code: 'IP'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				attribute: 'lifecycleStatus',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('In Preparation');
		});

		it('should display multiple code list fields as value', async () => {
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book With Type',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 5,
				bookType_code: 'LIT'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'bookType',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('Literature, Literature Books');
		});

		it('should update displayed value when association changes', async () => {
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book Changing Authors',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 10
			});

			await UPDATE(Books).where({ ID: id }).with({
				author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'author',
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Emily, Brontë',
				valueChangedTo: 'Charlotte, Brontë'
			});
		});

		it('should display genre directly without explicit path', async () => {
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book With Genre',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 8,
				genre_ID: 11
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'genre',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].valueChangedTo).toEqual('11');
		});
	});

	describe('Composition Tracking', () => {
		it('should track creation via deep creates over composition of one', async () => {
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store With Registry',
				location: 'Munich',
				registry: {
					ID: cds.utils.uuid(),
					code: 'MUN-001',
					validOn: '2024-01-01'
				}
			});

			const registryChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				entityKey: storeId
			});

			expect(registryChanges.length).toEqual(1);
			expect(registryChanges[0]).toMatchObject({
				attribute: 'validOn',
				modification: 'create',
				objectID: 'MUN-001',
				parentObjectID: 'Store With Registry',
				entityKey: storeId,
				parentKey: storeId
			});
		});

		it('should track update via deep update over composition of one', async () => {
			const { BookStores, Volumns } = adminService.entities;
			const storeId = cds.utils.uuid();
			const bookId = cds.utils.uuid();
			const volumnId = cds.utils.uuid();

			// Create the hierarchy: BookStore -> Book -> Volumn
			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store For Volumn Update',
				location: 'Test Location',
				books: [{
					ID: bookId,
					title: 'Book With Volumn',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 10,
					volumns: [{
						ID: volumnId,
						title: 'Original Volumn Title',
						sequence: 1
					}]
				}]
			});

			await UPDATE(Volumns).where({ ID: volumnId }).with({
				title: 'Updated Volumn Title'
			});

			const volumnChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Volumns',
				entityKey: storeId,
				attribute: 'title',
				modification: 'update'
			});

			expect(volumnChanges.length).toEqual(1);
			expect(volumnChanges[0]).toMatchObject({
				valueChangedFrom: 'Original Volumn Title',
				valueChangedTo: 'Updated Volumn Title'
			});
		});

		it('should track composition of one deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store To Delete Registry',
				location: 'Vienna',
				registry: {
					ID: cds.utils.uuid(),
					code: 'VIE-001',
					validOn: '2024-03-01'
				}
			});

			await DELETE.from(BookStores).where({ ID: storeId });

			const registryChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				entityKey: storeId,
				modification: 'delete'
			});

			expect(registryChanges.length).toBeGreaterThan(0);
			expect(registryChanges.find(c => c.attribute === 'validOn')).toMatchObject({
				modification: 'delete'
			});
		});

		it('should track creation via deep creates over composition of many', async () => {
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store With Multiple Books',
				location: 'Berlin',
				books: [
					{
						ID: cds.utils.uuid(),
						title: 'First Book',
						author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
						stock: 10
					},
					{
						ID: cds.utils.uuid(),
						title: 'Second Book',
						author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e',
						stock: 20
					}
				]
			});

			const bookChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId,
				modification: 'create'
			});

			expect(bookChanges.length).toBeGreaterThan(0);

			const titleChanges = bookChanges.filter(c => c.attribute === 'title');
			expect(titleChanges.length).toEqual(2);

			const titles = titleChanges.map(c => c.valueChangedTo);
			expect(titles).toContain('First Book');
			expect(titles).toContain('Second Book');

			expect(bookChanges.every(c => c.parentObjectID === 'Store With Multiple Books')).toEqual(true);
		});

		it('should track update via deep update over composition of many', async () => {
			const { BookStores, Books } = adminService.entities;
			const storeId = cds.utils.uuid();
			const bookId = cds.utils.uuid();

			// Create BookStore with a Book
			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store For Book Update',
				location: 'Test Location',
				books: [{
					ID: bookId,
					title: 'Original Book Title',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 10
				}]
			});

			// Update stock (not tracked)
			await UPDATE(Books).where({ ID: bookId }).with({ stock: 999 });

			// Update title (tracked)
			await UPDATE(Books).where({ ID: bookId }).with({ title: 'Updated Book Title' });

			const titleChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId,
				attribute: 'title',
				modification: 'update'
			});

			expect(titleChanges.length).toEqual(1);
			expect(titleChanges[0]).toMatchObject({
				valueChangedFrom: 'Original Book Title',
				valueChangedTo: 'Updated Book Title'
			});
		});

		it('should track composition of many deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores, Books } = adminService.entities;
			const storeId = cds.utils.uuid();
			const bookId = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store For Book Deletion',
				location: 'Rome',
				books: [
					{
						ID: bookId,
						title: 'Book To Delete',
						author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
						stock: 5
					}
				]
			});

			await DELETE.from(Books).where({ ID: bookId });

			const deleteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId,
				modification: 'delete'
			});

			expect(deleteChanges.length).toBeGreaterThan(0);
			expect(deleteChanges.find(c => c.attribute === 'title')).toMatchObject({
				valueChangedFrom: 'Book To Delete'
			});
		});

		describe('deep compositions', () => {
			it('should track deep create with 3+ hierarchy levels', async () => {
				const { RootEntity } = adminService.entities;
				const rootId = cds.utils.uuid();

				await INSERT.into(RootEntity).entries({
					ID: rootId,
					name: 'Deep Root',
					lifecycleStatus_code: 'IP',
					child: [
						{
							ID: cds.utils.uuid(),
							title: 'Level 1 Child',
							child: [
								{
									ID: cds.utils.uuid(),
									title: 'Level 2 Child',
									child: [
										{
											ID: cds.utils.uuid(),
											title: 'Level 3 Child'
										}
									]
								}
							]
						}
					]
				});

				const rootChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootEntity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(rootChanges.length).toEqual(2);

				const level1Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level1Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level1Changes.length).toEqual(2);
				expect(level1Changes.find(c => c.attribute === 'title')).toMatchObject({ valueChangedTo: 'Level 1 Child' });
				expect(level1Changes.find(c => c.attribute === 'child')).toMatchObject({ valueChangedTo: 'Level 2 Child' });

				const level2Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level2Changes.length).toEqual(2);
				expect(level2Changes.find(c => c.attribute === 'title')).toMatchObject({ valueChangedTo: 'Level 2 Child' });
				expect(level2Changes.find(c => c.attribute === 'child')).toMatchObject({ valueChangedTo: 'Level 3 Child' });

				const level3Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level3Changes.length).toEqual(1);
				expect(level3Changes.find(c => c.attribute === 'title')).toMatchObject({ valueChangedTo: 'Level 3 Child' });
			});

			it('should link all child changes to root entity key', async () => {
				const { BookStores } = adminService.entities;
				const rootId = cds.utils.uuid();

				await INSERT.into(BookStores).entries({
					ID: rootId,
					name: 'Root Store For Key Test',
					books: [
						{
							ID: cds.utils.uuid(),
							title: 'Book With Volumns',
							author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
							stock: 10,
							volumns: [
								{
									ID: cds.utils.uuid(),
									title: 'Volume 1',
									sequence: 1
								}
							]
						}
					]
				});

				const storeChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					entityKey: rootId
				});
				expect(storeChanges.length).toEqual(2);
				expect(storeChanges.find(c => c.attribute === 'name')).toMatchObject({ valueChangedTo: 'Root Store For Key Test' });
				expect(storeChanges.find(c => c.attribute === 'books')).toMatchObject({ valueChangedTo: 'Book With Volumns' });

				const bookChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Books',
					entityKey: rootId
				});
				expect(bookChanges.length).toEqual(2);
				expect(bookChanges[0].parentObjectID).toEqual('Root Store For Key Test');
				expect(bookChanges[1].parentObjectID).toEqual('Root Store For Key Test');

				const volumnChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Volumns',
					entityKey: rootId
				});
				expect(volumnChanges.length).toBeGreaterThan(0);
				expect(volumnChanges[0]).toMatchObject({
					parentObjectID: 'Book With Volumns, Emily, Brontë',
					entityKey: rootId
				});
			});

			it('should track inline composition of many', async () => {
				const { BookStores } = adminService.entities;
				const storeId = cds.utils.uuid();

				await INSERT.into(BookStores).entries({
					ID: storeId,
					name: 'Store With Inventory',
					location: 'Copenhagen',
					bookInventory: [
						{
							ID: cds.utils.uuid(),
							title: 'Inventory Item 1'
						}
					]
				});

				const inventoryChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores.bookInventory',
					entityKey: storeId
				});

				expect(inventoryChanges.length).toBeGreaterThan(0);
				expect(inventoryChanges.find(c => c.attribute === 'title')).toMatchObject({
					valueChangedTo: 'Inventory Item 1'
				});
			});
		});
	});

	describe('Edge Cases', () => {
		it('should handle special characters in entity IDs', async () => {
			const { RootSample } = adminService.entities;
			const specialId = '/test/special';

			await INSERT.into(RootSample).entries({
				ID: specialId,
				title: 'Entity With Special ID'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: specialId,
				modification: 'create'
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes.find(c => c.attribute === 'title')).toMatchObject({
				valueChangedTo: 'Entity With Special ID',
				entityKey: specialId
			});
		});

		it('should not track fields annotated with @PersonalData', async () => {
			const { Customers } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Customers).entries({
				ID: id,
				name: 'John Doe',
				city: 'New York',
				country: 'USA',
				age: 30
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers',
				entityKey: id,
				modification: 'create'
			});

			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeUndefined();

			expect(changes.find(c => c.attribute === 'city')).toMatchObject({
				valueChangedTo: 'New York'
			});
		});

		it('should track updates on personal data fields only if explicitly enabled', async () => {
			const { Customers } = adminService.entities;
			const id = cds.utils.uuid();

			// Create a customer with initial values
			await INSERT.into(Customers).entries({
				ID: id,
				name: 'Original Name',
				city: 'Shanghai',
				country: 'China',
				age: 25
			});

			// Update both a personal data field (name) and a regular field (city)
			await UPDATE(Customers).where({ ID: id }).with({
				name: 'Updated Name',
				city: 'Beijing'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers',
				entityKey: id,
				modification: 'update'
			});

			// Personal data field (name) should NOT be tracked
			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeUndefined();

			// Regular field (city) SHOULD be tracked
			expect(changes.find(c => c.attribute === 'city')).toMatchObject({
				valueChangedFrom: 'Shanghai',
				valueChangedTo: 'Beijing'
			});
		});

		it('should track deep compositions with special character IDs', async () => {
			const { RootSample } = adminService.entities;
			const rootId = '/root/special';
			const level1Id = '/level1/special';
			const level2Id = '/level2/special';

			await INSERT.into(RootSample).entries({
				ID: rootId,
				title: 'Deep Root With Special ID',
				child: [
					{
						ID: level1Id,
						title: 'Level1 With Special ID',
						child: [
							{
								ID: level2Id,
								title: 'Level2 With Special ID'
							}
						]
					}
				]
			});

			const rootChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: rootId
			});
			expect(rootChanges.length).toBeGreaterThan(0);

			const level1Changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level1Sample',
				entityKey: rootId
			});
			expect(level1Changes.length).toBeGreaterThan(0);

			const level2Changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Sample',
				entityKey: rootId
			});
			expect(level2Changes.length).toBeGreaterThan(0);
		});

		it('should track entities with non-UUID string keys', async () => {
			const { RootSample } = adminService.entities;
			const stringId = 'my-custom-string-id';

			await INSERT.into(RootSample).entries({
				ID: stringId,
				title: 'Entity With String Key'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: stringId
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes.find(c => c.attribute === 'title')).toMatchObject({
				entityKey: stringId
			});
		});

		it('should track update and delete on entities with string keys', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { RootSample } = adminService.entities;
			const stringId = 'string-key-for-update-delete';

			await INSERT.into(RootSample).entries({
				ID: stringId,
				title: 'Original Title'
			});

			await UPDATE(RootSample).where({ ID: stringId }).with({
				title: 'Updated Title'
			});

			const updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: stringId,
				modification: 'update'
			});

			expect(updateChanges.length).toEqual(1);
			expect(updateChanges[0]).toMatchObject({
				valueChangedFrom: 'Original Title',
				valueChangedTo: 'Updated Title'
			});

			await DELETE.from(RootSample).where({ ID: stringId });

			const deleteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: stringId,
				modification: 'delete'
			});

			expect(deleteChanges.length).toBeGreaterThan(0);
		});

		it('should track composition element creation on parent via @changelog display path', async () => {
			// Schools.classes annotation: @changelog: [classes.name, classes.teacher]
			// This means changes to classes are tracked on the Schools entity (parent)
			// using the display values from name and teacher fields
			const { Schools } = adminService.entities;
			const schoolId = cds.utils.uuid();

			await INSERT.into(Schools).entries({
				ID: schoolId,
				name: 'New Test School',
				location: 'Chicago',
				classes: [
					{
						ID: cds.utils.uuid(),
						name: 'Math 101',
						teacher: 'Mr. Smith'
					},
					{
						ID: cds.utils.uuid(),
						name: 'English 201',
						teacher: 'Ms. Johnson'
					}
				]
			});

			const schoolChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Schools',
				entityKey: schoolId,
				modification: 'create'
			});

			// Schools tracks `classes` field with display values [classes.name, classes.teacher]
			// So we get 2 changes (one per class added), each showing name and teacher
			expect(schoolChanges.length).toEqual(2);
			expect(schoolChanges.every(c => c.attribute === 'classes')).toEqual(true);

			// Verify display values include class info
			const displayValues = schoolChanges.map(c => c.valueChangedTo);
			expect(displayValues.some(v => v.includes('Math 101'))).toEqual(true);
			expect(displayValues.some(v => v.includes('English 201'))).toEqual(true);
		});

		it('should track draft-enabled entity with string keys', async () => {
			const { RootSampleDraft } = adminService.entities;
			const draftId = '/draft/test/entity';

			await INSERT.into(RootSampleDraft).entries({
				ID: draftId,
				title: 'Draft Enabled Title'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSampleDraft',
				entityKey: draftId,
				modification: 'create'
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes.find(c => c.attribute === 'title')).toMatchObject({
				valueChangedTo: 'Draft Enabled Title',
				entityKey: draftId
			});
		});

		it('should track updates to draft-enabled entity with string keys', async () => {
			const { RootSampleDraft } = adminService.entities;
			const draftId = '/draft/update/test';

			// Create a draft-enabled entity with string key
			await INSERT.into(RootSampleDraft).entries({
				ID: draftId,
				title: 'Original Draft Title'
			});

			// Update the entity
			await UPDATE(RootSampleDraft).where({ ID: draftId }).with({
				title: 'Updated Draft Title'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSampleDraft',
				entityKey: draftId,
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Original Draft Title',
				valueChangedTo: 'Updated Draft Title'
			});
		});
	});
});

describe('MTX Build', () => {
	test('Changes association is only added once JSON csn is compiled for runtime', async () => {
		const csn = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'xtended' });
		expect(csn.definitions['AdminService.RootEntity'].elements?.changes).toBeFalsy();

		const csn2 = await cds.load([path.join(__dirname, '../bookshop-mtx/srv'), '@cap-js/change-tracking'], { flavor: 'inferred' });
		const effectiveCSN2 = await cds.compile.for.nodejs(csn2);

		expect(effectiveCSN2.definitions['AdminService.RootEntity'].elements.changes).toBeTruthy();
	});
});
