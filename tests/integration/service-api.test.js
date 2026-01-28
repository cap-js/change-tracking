const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { data } = cds.test(bookshop);

describe('Change Tracking Integration Tests', () => {
	let adminService, db, ChangeView;

	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		db = await cds.connect.to('db');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
	});

	beforeEach(async () => {
		await data.reset();
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

	describe('Core CRUD Operations', () => {
		it('should track simple field creation', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'New Bookstore',
				location: 'Berlin'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				modification: 'create'
			});

			expect(changes.length).toEqual(2); // name and location

			expect(changes.find(c => c.attribute === 'name')).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New Bookstore',
				modification: 'create'
			});
		});

		it('should track simple field update', async () => {
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(BookStores).where({ ID: existingId }).with({ name: 'Updated Bookstore Name' });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				attribute: 'name',
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Shakespeare and Company',
				valueChangedTo: 'Updated Bookstore Name'
			});
		});

		it('should track simple field deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			// Create a fresh entity to delete
			await INSERT.into(BookStores).entries({ ID: id, name: 'Store To Delete', location: 'Berlin' });

			await DELETE.from(BookStores).where({ ID: id });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				modification: 'delete'
			});

			expect(changes.length).toEqual(2); // name and location
			expect(changes.find(c => c.attribute === 'name')).toMatchObject({
				valueChangedFrom: 'Store To Delete',
				valueChangedTo: ''
			});
		});

		it('should not create change log when value does not change on update', async () => {
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(BookStores).where({ ID: existingId }).with({
				name: 'Shakespeare and Company'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				modification: 'update'
			});

			expect(changes.length).toEqual(0);
		});

		it('should track numeric value 0 on create and delete', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { Order } = adminService.entities;
			Order.elements.netAmount['@changelog'] = true;

			const orderID = cds.utils.uuid();
			await INSERT.into(Order).entries({ ID: orderID, netAmount: 0 });

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				entityKey: orderID,
				attribute: 'netAmount',
				modification: 'create'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: '0'
			});

			await DELETE.from(Order).where({ ID: orderID });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				entityKey: orderID,
				attribute: 'netAmount',
				modification: 'delete'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '0',
				valueChangedTo: ''
			});

			delete Order.elements.netAmount['@changelog'];
		});

		it('should track boolean false value on create and delete', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: bookID,
				title: 'Test Book',
				isUsed: false,
				stock: 10
			});

			let allChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(allChanges.find(c => c.attribute === 'isUsed' && c.modification === 'create')).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'false'
			});

			await DELETE.from(Books).where({ ID: bookID });

			allChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(allChanges.find(c => c.attribute === 'isUsed' && c.modification === 'delete')).toMatchObject({
				valueChangedFrom: 'false',
				valueChangedTo: ''
			});
		});

		it('should track DateTime and Timestamp values via Date objects', async () => {
			const { RootEntity } = adminService.entities;
			RootEntity.elements.dateTime['@changelog'] = true;
			RootEntity.elements.timestamp['@changelog'] = true;

			const id = cds.utils.uuid();
			const testDateTime = new Date('2024-10-16T08:53:48Z');
			const testTimestamp = new Date('2024-10-23T08:53:54.000Z');

			await INSERT.into(RootEntity).entries({
				ID: id,
				dateTime: testDateTime,
				timestamp: testTimestamp
			});

			const allChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootEntity',
				entityKey: id
			});

			const dateTimeChange = allChanges.find(c => c.attribute === 'dateTime' && c.modification === 'create');
			expect(dateTimeChange.valueChangedFrom).toEqual('');
			expect(dateTimeChange.valueChangedTo).toContain('2024');
			expect(dateTimeChange.valueChangedTo).toContain('Oct');
			expect(dateTimeChange.valueChangedTo).toContain('16');

			delete RootEntity.elements.dateTime['@changelog'];
			delete RootEntity.elements.timestamp['@changelog'];
		});

		it('should track multiple records creation simultaneously', async () => {
			const { Order } = adminService.entities;
			Order.elements.netAmount['@changelog'] = true;

			const id1 = cds.utils.uuid();
			const id2 = cds.utils.uuid();
			const id3 = cds.utils.uuid();

			await INSERT.into(Order).entries([
				{ ID: id1, netAmount: 100 },
				{ ID: id2, netAmount: 200 },
				{ ID: id3, netAmount: 300 }
			]);

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'netAmount',
				modification: 'create'
			});

			expect(changes.length).toEqual(3);
			expect(changes.find(c => c.entityKey === id1)).toMatchObject({ valueChangedTo: '100' });
			expect(changes.find(c => c.entityKey === id2)).toMatchObject({ valueChangedTo: '200' });
			expect(changes.find(c => c.entityKey === id3)).toMatchObject({ valueChangedTo: '300' });

			delete Order.elements.netAmount['@changelog'];
		});

		it('should track update from non-null to null value', async () => {
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			const before = await SELECT.one.from(BookStores).where({ ID: existingId });
			expect(before.location).toEqual('Paris');

			await UPDATE(BookStores).where({ ID: existingId }).with({ location: null });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				attribute: 'location',
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Paris',
				valueChangedTo: ''
			});
		});

		it('should track update from null to non-null value', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'No Location Store',
				location: null
			});

			await UPDATE(BookStores).where({ ID: id }).with({ location: 'New Location' });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				attribute: 'location',
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New Location'
			});
		});
	});

	describe('Configuration Options', () => {
		it('should retain changelogs after entity deletion when preserveDeletes is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { Authors } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Authors).entries({
				ID: id,
				name_firstName: 'John',
				name_lastName: 'Doe',
				placeOfBirth: 'London'
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: id
			});
			expect(changes.length).toBeGreaterThan(0);
			const initialChangeCount = changes.length;

			await DELETE.from(Authors).where({ ID: id });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: id
			});

			expect(changes.length).toBeGreaterThan(initialChangeCount);
			const deleteChanges = changes.filter(c => c.modification === 'delete');
			expect(deleteChanges.length).toBeGreaterThan(0);
		});

		it('should delete changelogs with entity when preserveDeletes is disabled (default)', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = false;
			const { Authors } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Authors).entries({
				ID: id,
				name_firstName: 'Jane',
				name_lastName: 'Smith',
				placeOfBirth: 'Paris'
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: id
			});
			expect(changes.length).toBeGreaterThan(0);

			await DELETE.from(Authors).where({ ID: id });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: id
			});
			expect(changes.length).toEqual(0);
		});

		it('should skip create logs when disableCreateTracking is enabled', async () => {
			cds.env.requires['change-tracking'].disableCreateTracking = true;
			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: bookStoreID,
				name: 'No Create Log Store',
				location: 'Munich'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID,
				modification: 'create'
			});

			expect(changes.length).toEqual(0);
		});

		it('should still track updates when disableCreateTracking is enabled', async () => {
			cds.env.requires['change-tracking'].disableCreateTracking = true;
			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: bookStoreID,
				name: 'No Create Log Store',
				location: 'Munich'
			});

			await UPDATE(BookStores).where({ ID: bookStoreID }).with({
				name: 'Updated Name While Create Disabled'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID,
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
		});

		it('should skip update logs when disableUpdateTracking is enabled', async () => {
			cds.env.requires['change-tracking'].disableUpdateTracking = true;
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(BookStores).where({ ID: existingId }).with({
				name: 'This Update Should Not Be Logged'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				modification: 'update'
			});

			expect(changes.length).toEqual(0);
		});

		it('should still track creates when disableUpdateTracking is enabled', async () => {
			cds.env.requires['change-tracking'].disableUpdateTracking = true;
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'Store Created While Update Disabled',
				location: 'Vienna'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				modification: 'create'
			});

			expect(changes.length).toBeGreaterThan(0);
		});

		it('should skip delete logs when disableDeleteTracking is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			cds.env.requires['change-tracking'].disableDeleteTracking = true;
			const { Authors } = adminService.entities;
			const authorID = cds.utils.uuid();

			await INSERT.into(Authors).entries({
				ID: authorID,
				name_firstName: 'Delete',
				name_lastName: 'Test',
				placeOfBirth: 'Berlin'
			});

			await DELETE.from(Authors).where({ ID: authorID });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: authorID
			});

			const deleteChanges = changes.filter(c => c.modification === 'delete');
			expect(deleteChanges.length).toEqual(0);

			const createChanges = changes.filter(c => c.modification === 'create');
			expect(createChanges.length).toBeGreaterThan(0);
		});

		it('should still track creates and updates when disableDeleteTracking is enabled', async () => {
			cds.env.requires['change-tracking'].disableDeleteTracking = true;
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'Store For Delete Test',
				location: 'Amsterdam'
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				modification: 'create'
			});
			expect(changes.length).toBeGreaterThan(0);

			await UPDATE(BookStores).where({ ID: id }).with({
				name: 'Store Updated For Delete Test'
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				modification: 'update'
			});
			expect(changes.length).toEqual(1);
		});

		it('should respect multiple disable flags simultaneously', async () => {
			cds.env.requires['change-tracking'].disableCreateTracking = true;
			cds.env.requires['change-tracking'].disableUpdateTracking = true;
			cds.env.requires['change-tracking'].preserveDeletes = true;

			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: bookStoreID,
				name: 'Combined Test Store',
				location: 'Rome'
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});
			expect(changes.length).toEqual(0);

			await UPDATE(BookStores).where({ ID: bookStoreID }).with({
				name: 'Updated Combined Test Store'
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});
			expect(changes.length).toEqual(0);

			await DELETE.from(BookStores).where({ ID: bookStoreID });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes.every(c => c.modification === 'delete')).toEqual(true);
		});
	});

	describe('ObjectID - Human-readable IDs', () => {
		it('should use single field as objectID', async () => {
			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: bookStoreID,
				name: 'My Unique Bookstore',
				location: 'Tokyo'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});

			expect(changes.length).toEqual(2);
			expect(changes[0].objectID).toEqual('My Unique Bookstore');
		});

		it('should use multiple fields as objectID (concatenation)', async () => {
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();
			const authorID = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'; // existing author Emily Brontë

			await INSERT.into(Books).entries({
				ID: bookID,
				title: 'Test Book Title',
				author_ID: authorID,
				stock: 10
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes[0].objectID).toEqual('Test Book Title, Emily, Brontë');
		});

		it('should use multiple fields as objectID (concatenation) even when one of the fields is null', async () => {
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();
			const authorID = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387';

			await INSERT.into(Books).entries({
				ID: bookID,
				author_ID: authorID,
				stock: 10
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].objectID).toEqual('Emily, Brontë');

			const bookID2 = cds.utils.uuid();
			await INSERT.into(Books).entries({
				ID: bookID2,
				title: 'Test Book Title',
				author: {
					name_firstName: 'SingleNameAuthor',
					name_lastName: null
				},
				stock: 10
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID2
			});
			expect(changes.length).toEqual(1);
			expect(changes[0].objectID).toEqual('Test Book Title');
		});

		it('should be empty string when all objectID fields are null', async () => {
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: bookID,
				descr: 'Book without title and author',
				stock: 10
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(changes.length).toEqual(1);
			expect(changes[0].objectID).toEqual('');
		});

		it('should use struct field as objectID', async () => {
			const { Authors } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Authors).entries({
				ID: id,
				name_firstName: 'William',
				name_lastName: 'Shakespeare',
				placeOfBirth: 'Stratford'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Authors',
				entityKey: id
			});

			expect(changes.length).toBeGreaterThan(0);
			expect(changes[0].objectID).toEqual('William, Shakespeare');
		});

		it('should use one level chained association as objectID', async () => {
			const { Level1Entity } = adminService.entities;
			const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812';

			await INSERT.into(Level1Entity).entries({
				ID: cds.utils.uuid(),
				title: 'Level1 Test Entry',
				parent_ID: existingRootEntity
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level1Entity',
				entityKey: existingRootEntity
			});

			expect(changes.find(c => c.attribute === 'title' && c.modification === 'create')).toMatchObject({
				objectID: 'In Preparation'
			});
		});

		it('should use deep chained association as objectID', async () => {
			const { Level3Entity } = adminService.entities;
			const existingLevel2Entity = 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff';
			const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812';

			await INSERT.into(Level3Entity).entries({
				ID: cds.utils.uuid(),
				title: 'Level3 Deep Test',
				parent_ID: existingLevel2Entity
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Entity',
				entityKey: existingRootEntity
			});

			expect(changes.find(c => c.attribute === 'title' && c.modification === 'create')).toMatchObject({
				objectID: 'In Preparation'
			});
		});

		it('should resolve parentObjectID for child entities', async () => {
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();
			const existingAuthorID = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387';

			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Parent Store Name',
				location: 'Sydney',
				books: [
					{
						ID: cds.utils.uuid(),
						title: 'Child Book Title',
						author_ID: existingAuthorID,
						stock: 5
					}
				]
			});

			const bookStoreChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: storeId
			});
			const parentObjectID = bookStoreChanges[0].objectID;

			const bookChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId
			});

			expect(bookChanges.length).toBeGreaterThan(0);
			expect(bookChanges[0]).toMatchObject({
				parentObjectID: parentObjectID,
				objectID: 'Child Book Title, Emily, Brontë'
			});
		});

		it('should update objectID when the referenced field is included in the change', async () => {
			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();

			await INSERT.into(BookStores).entries({
				ID: bookStoreID,
				name: 'Original Store Name'
			});

			const createChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID,
				modification: 'create'
			});

			expect(createChanges.length).toEqual(1);
			expect(createChanges[0].objectID).toEqual('Original Store Name');

			const updatedName = 'Updated Store Name';
			await UPDATE(BookStores).where({ ID: bookStoreID }).with({ name: updatedName });

			const updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID,
				modification: 'update'
			});

			expect(updateChanges.length).toEqual(1);
			expect(updateChanges[0].objectID).toEqual(updatedName);
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
			const { Volumns } = adminService.entities;
			const existingVolumnId = 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf';
			const rootStoreId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(Volumns).where({ ID: existingVolumnId }).with({
				title: 'Wuthering Heights I - Updated'
			});

			const volumnChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Volumns',
				entityKey: rootStoreId,
				attribute: 'title',
				modification: 'update'
			});

			expect(volumnChanges.length).toEqual(1);
			expect(volumnChanges[0]).toMatchObject({
				valueChangedFrom: 'Wuthering Heights I',
				valueChangedTo: 'Wuthering Heights I - Updated'
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
			const { Books } = adminService.entities;
			const existingBookId = '9d703c23-54a8-4eff-81c1-cdce6b8376b1';
			const existingStoreId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(Books).where({ ID: existingBookId }).with({ stock: 999 });

			await UPDATE(Books).where({ ID: existingBookId }).with({ title: 'Wuthering Heights - Updated Edition' });

			const titleChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: existingStoreId,
				attribute: 'title',
				modification: 'update'
			});

			expect(titleChanges.length).toEqual(1);
			expect(titleChanges[0]).toMatchObject({
				valueChangedFrom: 'Wuthering Heights',
				valueChangedTo: 'Wuthering Heights - Updated Edition'
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
			const existingId = 'd4d4a1b3-5b83-4814-8a20-f039af6f0385';

			await UPDATE(Customers).where({ ID: existingId }).with({
				name: 'Updated Name',
				city: 'Beijing'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers',
				entityKey: existingId,
				modification: 'update'
			});

			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeUndefined();

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
			const existingDraftId = '/draftone';

			await UPDATE(RootSampleDraft).where({ ID: existingDraftId }).with({
				title: 'Updated Draft Title'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSampleDraft',
				entityKey: existingDraftId,
				modification: 'update'
			});

			expect(changes.length).toEqual(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Draft title',
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
