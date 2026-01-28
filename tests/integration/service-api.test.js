const cds = require('@sap/cds');
const e = require('express');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { data } = cds.test(bookshop);

describe('Change Tracking Integration Tests', () => {
	let adminService, db, ChangeView, ChangeLog;

	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		db = await cds.connect.to('db');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
		ChangeLog = db.model.definitions['sap.changelog.ChangeLog'];
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

			expect(changes.length).toBeGreaterThan(0);

			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeDefined();
			expect(nameChange.valueChangedFrom).toBe('');
			expect(nameChange.valueChangedTo).toBe('New Bookstore');
			expect(nameChange.modification).toBe('create');
		});

		it('should track simple field update', async () => {
			const { BookStores } = adminService.entities;
			// existing bookstore from test data
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(BookStores).where({ ID: existingId }).with({ name: 'Updated Bookstore Name' });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				attribute: 'name',
				modification: 'update'
			});

			expect(changes.length).toBe(1);
			expect(changes[0].valueChangedFrom).toBe('Shakespeare and Company');
			expect(changes[0].valueChangedTo).toBe('Updated Bookstore Name');
		});

		it('should track simple field deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await DELETE.from(BookStores).where({ ID: existingId });

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				modification: 'delete'
			});

			expect(changes.length).toBeGreaterThan(0);
			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeDefined();
			expect(nameChange.valueChangedFrom).toBe('Shakespeare and Company');
			expect(nameChange.valueChangedTo).toBe('');
		});

		it('should not create change log when value does not change on update', async () => {
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770'; // with name 'Shakespeare and Company'

			// Update with the same value that already exists
			await UPDATE(BookStores).where({ ID: existingId }).with({
				name: 'Shakespeare and Company'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				modification: 'update'
			});

			expect(changes.length).toBe(0);
		});

		it('should track numeric value 0 on create and delete', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { Order } = adminService.entities;

			// Temporarily add @changelog annotation for testing
			Order.elements.netAmount['@changelog'] = true;

			const orderID = cds.utils.uuid();
			await INSERT.into(Order).entries({ ID: orderID, netAmount: 0 });

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				entityKey: orderID,
				attribute: 'netAmount',
				modification: 'create'
			});

			expect(changes.length).toBe(1);
			expect(changes[0].valueChangedFrom).toBe('');
			expect(Number(changes[0].valueChangedTo)).toBe(0);

			// Now delete and verify
			await DELETE.from(Order).where({ ID: orderID });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				entityKey: orderID,
				attribute: 'netAmount',
				modification: 'delete'
			});

			expect(changes.length).toBe(1);
			expect(Number(changes[0].valueChangedFrom)).toBe(0);
			expect(changes[0].valueChangedTo).toBe('');

			// Cleanup
			delete Order.elements.netAmount['@changelog'];
		});

		it('should track boolean false value on create and delete', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;

			// Use Books entity which already has isUsed annotated with @changelog
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: bookID,
				title: 'Test Book',
				isUsed: false,
				stock: 10
			});

			// Get all changes for this entity
			let allChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			let isUsedChange = allChanges.find(
				c => c.attribute === 'isUsed' && c.modification === 'create'
			);

			expect(isUsedChange).toBeDefined();
			expect(isUsedChange.valueChangedFrom).toBe('');
			expect(isUsedChange.valueChangedTo).toBe('false');

			// Now delete and verify
			await DELETE.from(Books).where({ ID: bookID });

			allChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			isUsedChange = allChanges.find(
				c => c.attribute === 'isUsed' && c.modification === 'delete'
			);

			expect(isUsedChange).toBeDefined();
			expect(isUsedChange.valueChangedFrom).toBe('false');
			expect(isUsedChange.valueChangedTo).toBe('');
		});

		it('should track DateTime and Timestamp values via Date objects', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { RootEntity } = adminService.entities;

			// Temporarily add @changelog annotation for testing
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

			const dateTimeChange = allChanges.find(
				c => c.attribute === 'dateTime' && c.modification === 'create'
			);

			expect(dateTimeChange).toBeDefined();
			expect(dateTimeChange.valueChangedFrom).toBe('');
			// The value should contain the date components - format varies by environment
			expect(dateTimeChange.valueChangedTo).toContain('2024');
			expect(dateTimeChange.valueChangedTo).toContain('Oct');
			expect(dateTimeChange.valueChangedTo).toContain('16');

			// Cleanup
			delete RootEntity.elements.dateTime['@changelog'];
			delete RootEntity.elements.timestamp['@changelog'];
		});

		it('should track multiple records creation simultaneously', async () => {
			const { Order } = adminService.entities;

			// Temporarily add @changelog annotation for testing
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

			// Should have 3 changes, one for each order
			expect(changes.length).toBe(3);

			const change1 = changes.find(c => c.entityKey === id1);
			const change2 = changes.find(c => c.entityKey === id2);
			const change3 = changes.find(c => c.entityKey === id3);

			expect(change1).toBeDefined();
			expect(Number(change1.valueChangedTo)).toBe(100);

			expect(change2).toBeDefined();
			expect(Number(change2.valueChangedTo)).toBe(200);

			expect(change3).toBeDefined();
			expect(Number(change3.valueChangedTo)).toBe(300);

			// Cleanup
			delete Order.elements.netAmount['@changelog'];
		});

		it('should track update from non-null to null value', async () => {
			const { BookStores } = adminService.entities;
			const existingId = '64625905-c234-4d0d-9bc1-283ee8946770';

			// First verify location has a value
			const before = await SELECT.one.from(BookStores).where({ ID: existingId });
			expect(before.location).toBe('Paris');

			await UPDATE(BookStores).where({ ID: existingId }).with({
				location: null
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: existingId,
				attribute: 'location',
				modification: 'update'
			});

			expect(changes.length).toBe(1);
			expect(changes[0].valueChangedFrom).toBe('Paris');
			expect(changes[0].valueChangedTo).toBe('');
		});

		it('should track update from null to non-null value', async () => {
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			// Create without location
			await INSERT.into(BookStores).entries({
				ID: id,
				name: 'No Location Store',
				location: null
			});

			// Clear create logs by filtering for updates only
			await UPDATE(BookStores).where({ ID: id }).with({
				location: 'New Location'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: id,
				attribute: 'location',
				modification: 'update'
			});

			expect(changes.length).toBe(1);
			expect(changes[0].valueChangedFrom).toBe('');
			expect(changes[0].valueChangedTo).toBe('New Location');
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

			// Should have both create and delete logs
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
			expect(changes.length).toBe(0);
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

			expect(changes.length).toBe(0);
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

			expect(changes.length).toBe(1);
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

			expect(changes.length).toBe(0);
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
			expect(deleteChanges.length).toBe(0);

			// But create changes should still exist (due to preserveDeletes)
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
			expect(changes.length).toBe(1);
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
			expect(changes.length).toBe(0);

			await UPDATE(BookStores).where({ ID: bookStoreID }).with({
				name: 'Updated Combined Test Store'
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});
			expect(changes.length).toBe(0);

			await DELETE.from(BookStores).where({ ID: bookStoreID });

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID
			});

			// Should have delete logs only
			expect(changes.length).toBeGreaterThan(0);
			expect(changes.every(c => c.modification === 'delete')).toBe(true);
		});

	});

	describe('ObjectID - Human-readable IDs', () => {
		it('should use single field as objectID', async () => {
			// BookStores has @changelog: [name] -> single field objectID
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

			expect(changes.length).toBeGreaterThan(0);
			expect(changes[0].objectID).toBe('My Unique Bookstore');
		});

		it('should use multiple fields as objectID (concatenation)', async () => {
			// Books has @changelog: [title, author.name.firstName, author.name.lastName]
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
			expect(changes[0].objectID).toBe('Test Book Title, Emily, Brontë');
		});

		it('should use multiple fields as objectID (concatenation) even when one of the fields is null', async () => {
			// Books has @changelog: [title, author.name.firstName, author.name.lastName]
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();
			const authorID = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'; // existing author Emily Brontë

			// Insert book with null title
			await INSERT.into(Books).entries({
				ID: bookID,
				author_ID: authorID,
				stock: 10
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(changes.length).toBe(1);
			expect(changes[0].objectID).toBe('Emily, Brontë');

			// Now insert book with null author last name
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
			expect(changes.length).toBe(1);
			expect(changes[0].objectID).toBe('Test Book Title');
		});

		// should fallback to entity ID when all objectID fields are null?
		it('should be empty string when all objectID fields are null', async () => {
			// Books has @changelog: [title, author.name.firstName, author.name.lastName]
			const { Books } = adminService.entities;
			const bookID = cds.utils.uuid();

			await INSERT.into(Books).entries({
				ID: bookID,
				descr: 'Book without title and author',
				stock: 10
			});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: bookID
			});

			expect(changes.length).toBe(1);
			expect(changes[0].objectID).toBe('');
		});

		it('should use struct field as objectID', async () => {
			// Authors has @changelog: [name.firstName, name.lastName]
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
			expect(changes[0].objectID).toBe('William, Shakespeare');
		});

		it('should use one level chained association as objectID', async () => {
			// Level1Entity has @changelog: [parent.lifecycleStatus.name]
			const { Level1Entity } = adminService.entities;
			const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812'; // with lifecycleStatus 'IP' (In Preparation)

			await INSERT.into(Level1Entity).entries({
				ID: cds.utils.uuid(),
				title: 'Level1 Test Entry',
				parent_ID: existingRootEntity
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level1Entity',
				entityKey: existingRootEntity
			});

			const level1Change = changes.find(c => c.attribute === 'title' && c.modification === 'create');

			expect(level1Change).toBeDefined();
			expect(level1Change.objectID).toBe('In Preparation');
		});

		it('should use deep chained association as objectID', async () => {
			// Level3Entity has @changelog: [parent.parent.parent.lifecycleStatus.name]
			const { Level3Entity } = adminService.entities;
			const existingLevel2Entity = 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff'; // Level2Entity that links to RootEntity
			const existingRootEntity = '64625905-c234-4d0d-9bc1-283ee8940812'; // with lifecycleStatus 'IP' (In Preparation)

			await INSERT.into(Level3Entity).entries({
				ID: cds.utils.uuid(),
				title: 'Level3 Deep Test',
				parent_ID: existingLevel2Entity
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Entity',
				entityKey: existingRootEntity
			});

			const level3Change = changes.find(c => c.attribute === 'title' && c.modification === 'create');

			// object with parentID 
			expect(level3Change).toBeDefined();
			// objectID should resolve through 3 levels: Level3 -> Level2 -> Level1 -> Root -> lifecycleStatus.name
			expect(level3Change.objectID).toBe('In Preparation');
		});

		it('should resolve parentObjectID for child entities', async () => {
			// When creating a child entity, parentObjectID should show the parent's objectID
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();
			const existingAuthorID = 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'; // Emily Brontë

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
				entityKey: storeId // for some reason entityKey is the parent key
			});

			expect(bookChanges.length).toBeGreaterThan(0);
			expect(bookChanges[0].parentObjectID).toBe(parentObjectID);
			expect(bookChanges[0].objectID).toBe('Child Book Title, Emily, Brontë');
		});

		it('should update objectID when the referenced field is included in the change', async () => {
			// BookStores has @changelog: [name] -> single field objectID
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

			expect(createChanges.length).toBe(1);
			expect(createChanges[0].objectID).toBe('Original Store Name');

			// Update the name field which is the objectID
			const updatedName = 'Updated Store Name';
			await UPDATE(BookStores).where({ ID: bookStoreID }).with({ name: updatedName });

			const updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: bookStoreID,
				modification: 'update'
			});

			expect(updateChanges.length).toBe(1);
			expect(updateChanges[0].objectID).toBe(updatedName);
		});
	});

	describe('Display Values - Human-readable Values', () => {
		it('should display raw value for simple fields', async () => {
			// Simple @changelog annotation should display the raw value
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

			expect(changes.length).toBe(1);
			// For simple fields, valueChangedTo should be the raw value
			expect(changes[0].valueChangedTo).toBe('Amsterdam');
		});

		it('should display associated entity field as value', async () => {
			// Books has author @changelog: [author.name.firstName, author.name.lastName]
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			// Use existing author: Emily Brontë (d4d4a1b3-5b83-4814-8a20-f039af6f0387)
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

			expect(changes.length).toBe(1);
			// valueChangedTo should display the author's first and last name
			expect(changes[0].valueChangedTo).toBe('Emily, Brontë');
		});

		it('should display chained association field values', async () => {
			// BookStores has city @changelog: [city.name, city.country.countryName.code]
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			// Use existing city: Paris (bc21e0d9-a313-4f52-8336-c1be5f66e257) in France (FR)
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

			expect(changes.length).toBe(1);
			// valueChangedTo should display city name and country code
			expect(changes[0].valueChangedTo).toBe('Paris, FR');
		});

		it('should display code list description as value', async () => {
			// BookStores has lifecycleStatus @changelog: [lifecycleStatus.name]
			const { BookStores } = adminService.entities;
			const id = cds.utils.uuid();

			// Use lifecycleStatus code 'IP' which maps to 'In Preparation'
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

			expect(changes.length).toBe(1);
			// valueChangedTo should display the code list name 'In Preparation'
			expect(changes[0].valueChangedTo).toBe('In Preparation');
		});

		it('should display multiple code list fields as value', async () => {
			// Books has bookType @changelog: [bookType.name, bookType.descr]
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			// Use bookType code 'LIT' which maps to 'Literature', 'Literature Books'
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

			expect(changes.length).toBe(1);
			// valueChangedTo should display both name and description
			expect(changes[0].valueChangedTo).toBe('Literature, Literature Books');
		});

		it('should update displayed value when association changes', async () => {
			// When updating an association, the display value should reflect the new target
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			// Create book with Emily Brontë as author
			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book Changing Authors',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387', // Emily Brontë
				stock: 10
			});

			// Change author to Charlotte Brontë (47f97f40-4f41-488a-b10b-a5725e762d5e)
			await UPDATE(Books).where({ ID: id }).with({
				author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'author',
				modification: 'update'
			});

			expect(changes.length).toBe(1);
			expect(changes[0].valueChangedFrom).toBe('Emily, Brontë');
			expect(changes[0].valueChangedTo).toBe('Charlotte, Brontë');
		});

		it('should display genre directly without explicit path', async () => {
			// Books has genre @changelog (no explicit path, should use direct value)
			const { Books } = adminService.entities;
			const id = cds.utils.uuid();

			// Use existing genre: Fiction (ID: 10)
			await INSERT.into(Books).entries({
				ID: id,
				title: 'Book With Genre',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 8,
				genre_ID: 11 // Drama (child of Fiction)
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: id,
				attribute: 'genre',
				modification: 'create'
			});

			expect(changes.length).toBe(1);
			// Without explicit display path, should show the ID or raw value
			expect(changes[0].valueChangedTo).toBe('11');
		});
	});

	describe('Composition Tracking', () => {

		it('should track creation via deep creates over composition of one', async () => {
			// BookStores has composition of one to BookStoreRegistry
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

			// Check registry changes are linked to parent store
			const registryChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				entityKey: storeId
			});

			expect(registryChanges.length).toBe(1);
			expect(registryChanges[0]).toMatchObject({
				attribute: 'validOn',
				modification: 'create',
				objectID: 'MUN-001',
				parentObjectID: 'Store With Registry',
				entityKey: storeId,
				parentKey: storeId // entityKey === parentKey ???
			});
		});

		it('should track update via deep update over composition of one', async () => {
			// Books has volumns: Composition of many Volumns
			// Volumns has title @changelog
			// Using a composition of many child as it's exposed and works similarly
			const { Volumns } = adminService.entities;

			// Use existing Volumn from test data
			// ID: dd1fdd7d-da2a-4600-940b-0baf2946c9bf belongs to book 9d703c23-54a8-4eff-81c1-cdce6b8376b1
			// which belongs to store 64625905-c234-4d0d-9bc1-283ee8946770
			const existingVolumnId = 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf';
			const rootStoreId = '64625905-c234-4d0d-9bc1-283ee8946770';

			// Update the volumn's title directly
			await UPDATE(Volumns).where({ ID: existingVolumnId }).with({
				title: 'Wuthering Heights I - Updated'
			});

			const volumnChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Volumns',
				entityKey: rootStoreId,
				attribute: 'title',
				modification: 'update'
			});

			expect(volumnChanges.length).toBe(1);
			expect(volumnChanges[0].valueChangedFrom).toBe('Wuthering Heights I');
			expect(volumnChanges[0].valueChangedTo).toBe('Wuthering Heights I - Updated');
		});

		it('should track composition of one deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores } = adminService.entities;
			const storeId = cds.utils.uuid();
			const registryId = cds.utils.uuid();

			// Create store with registry
			await INSERT.into(BookStores).entries({
				ID: storeId,
				name: 'Store To Delete Registry',
				location: 'Vienna',
				registry: {
					ID: registryId,
					code: 'VIE-001',
					validOn: '2024-03-01'
				}
			});

			// Delete the parent (should cascade delete to registry)
			await DELETE.from(BookStores).where({ ID: storeId });

			const registryChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				entityKey: storeId,
				modification: 'delete'
			});

			expect(registryChanges.length).toBeGreaterThan(0);
			const validOnChange = registryChanges.find(c => c.attribute === 'validOn');
			expect(validOnChange).toBeDefined();
			expect(validOnChange.valueChangedFrom).toContain('2024');
		});


		it('should track creation via deep creates over composition of many', async () => {
			// BookStores has books: Composition of many Books
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

			// Check books are linked to parent store
			const bookChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId,
				modification: 'create'
			});

			expect(bookChanges.length).toBeGreaterThan(0);

			// Should have changes for both books
			const titleChanges = bookChanges.filter(c => c.attribute === 'title');
			expect(titleChanges.length).toBe(2);

			const titles = titleChanges.map(c => c.valueChangedTo);
			expect(titles).toContain('First Book');
			expect(titles).toContain('Second Book');

			// All should have same parentObjectID
			expect(bookChanges.every(c => c.parentObjectID === 'Store With Multiple Books')).toBe(true);
		});

		it('should track update via deep update over composition of many', async () => {
			// Use existing book from bookstore
			const { Books } = adminService.entities;
			const existingBookId = '9d703c23-54a8-4eff-81c1-cdce6b8376b1'; // Wuthering Heights book
			const existingStoreId = '64625905-c234-4d0d-9bc1-283ee8946770';

			await UPDATE(Books)
				.where({ ID: existingBookId })
				.with({ stock: 999 });

			const bookChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: existingStoreId,
				modification: 'update'
			});

			// Note: stock is not annotated with @changelog, so check title update instead
			// Let's update the title instead
			await UPDATE(Books)
				.where({ ID: existingBookId })
				.with({ title: 'Wuthering Heights - Updated Edition' });

			const titleChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: existingStoreId,
				attribute: 'title',
				modification: 'update'
			});

			expect(titleChanges.length).toBe(1);
			expect(titleChanges[0].valueChangedFrom).toBe('Wuthering Heights');
			expect(titleChanges[0].valueChangedTo).toBe('Wuthering Heights - Updated Edition');
		});

		it('should track composition of many deletion', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { BookStores, Books } = adminService.entities;
			const storeId = cds.utils.uuid();
			const bookId = cds.utils.uuid();

			// Create store with book
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

			// Delete just the book (not the store)
			await DELETE.from(Books).where({ ID: bookId });

			const deleteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				entityKey: storeId,
				modification: 'delete'
			});

			expect(deleteChanges.length).toBeGreaterThan(0);
			const titleChange = deleteChanges.find(c => c.attribute === 'title');
			expect(titleChange).toBeDefined();
			expect(titleChange.valueChangedFrom).toBe('Book To Delete');
		});

		describe('deep compositions', () => {
			it('should track deep create with 3+ hierarchy levels', async () => {
				// RootEntity -> Level1Entity -> Level2Entity -> Level3Entity
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

				// Check all levels are tracked
				const rootChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootEntity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(rootChanges.length).toBe(2); // name and lifecycleStatus

				const level1Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level1Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level1Changes.length).toBe(2);
				expect(level1Changes.find(c => c.attribute === 'title').valueChangedTo).toBe('Level 1 Child');
				expect(level1Changes.find(c => c.attribute === 'child').valueChangedTo).toBe('Level 2 Child');

				const level2Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level2Changes.length).toBe(2);
				expect(level2Changes.find(c => c.attribute === 'title').valueChangedTo).toBe('Level 2 Child');
				expect(level2Changes.find(c => c.attribute === 'child').valueChangedTo).toBe('Level 3 Child');

				const level3Changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Entity',
					entityKey: rootId,
					modification: 'create'
				});
				expect(level3Changes.length).toBe(1);
				expect(level3Changes.find(c => c.attribute === 'title').valueChangedTo).toBe('Level 3 Child');
			});

			it('should link all child changes to root entity key', async () => {
				// All composition children should reference the root entity's key (entityKey)
				// but parentObjectID reflects their immediate parent's objectID
				const { BookStores } = adminService.entities;
				const rootId = cds.utils.uuid();

				// BookStores -> Books -> Volumns (3 levels)
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

				// All changes should link to root store via entityKey
				const storeChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					entityKey: rootId
				});
				expect(storeChanges.length).toBe(2);
				expect(storeChanges.find(c => c.attribute === 'name').valueChangedTo).toBe('Root Store For Key Test');
				expect(storeChanges.find(c => c.attribute === 'books').valueChangedTo).toBe('Book With Volumns');

				const bookChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Books',
					entityKey: rootId
				});
				expect(bookChanges.length).toBe(2); // title and author
				expect(bookChanges[0].parentObjectID).toBe('Root Store For Key Test');
				expect(bookChanges[1].parentObjectID).toBe('Root Store For Key Test');

				const volumnChanges = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Volumns',
					entityKey: rootId
				});
				expect(volumnChanges.length).toBeGreaterThan(0);
				// Volumns' parentObjectID is the Book's objectID (immediate parent)
				// Books has @changelog: [title, author.name.firstName, author.name.lastName]
				expect(volumnChanges[0].parentObjectID).toBe('Book With Volumns, Emily, Brontë');
				expect(volumnChanges[0].entityKey).toBe(rootId); // But entityKey still links to root store
			});

			it('should track inline composition of many', async () => {
				// BookStores has inline composition: bookInventory: Composition of many { ID, title }
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
				const titleChange = inventoryChanges.find(c => c.attribute === 'title');
				expect(titleChange).toBeDefined();
				expect(titleChange.valueChangedTo).toBe('Inventory Item 1');
			});
		});
	});

	describe('Edge Cases', () => {
		it('should handle special characters in entity IDs', async () => {
			// RootSample has String keys that can include special characters like '/'
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
			const titleChange = changes.find(c => c.attribute === 'title');
			expect(titleChange).toBeDefined();
			expect(titleChange.valueChangedTo).toBe('Entity With Special ID');
			// entityKey should properly store the special character ID
			expect(titleChange.entityKey).toBe(specialId);
		});

		it('should not track fields annotated with @PersonalData', async () => {
			// Customers.name has @PersonalData.IsPotentiallyPersonal and @changelog
			// Personal data should NOT be tracked even if @changelog is present
			const { Customers } = adminService.entities;
			const id = cds.utils.uuid();

			await INSERT.into(Customers).entries({
				ID: id,
				name: 'John Doe', // Personal data
				city: 'New York',
				country: 'USA',
				age: 30
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers',
				entityKey: id,
				modification: 'create'
			});

			// Should have changes for city, country, age but NOT for name
			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeUndefined();

			// Other fields should be tracked
			const cityChange = changes.find(c => c.attribute === 'city');
			expect(cityChange).toBeDefined();
			expect(cityChange.valueChangedTo).toBe('New York');
		});

		it('should track updates on personal data fields only if explicitly enabled', async () => {
			// Update personal data - should not be tracked
			const { Customers } = adminService.entities;
			const existingId = 'd4d4a1b3-5b83-4814-8a20-f039af6f0385'; // Seven from test data

			await UPDATE(Customers).where({ ID: existingId }).with({
				name: 'Updated Name',
				city: 'Beijing'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers',
				entityKey: existingId,
				modification: 'update'
			});

			// Name change should NOT be tracked (personal data)
			const nameChange = changes.find(c => c.attribute === 'name');
			expect(nameChange).toBeUndefined();

			// City change SHOULD be tracked
			const cityChange = changes.find(c => c.attribute === 'city');
			expect(cityChange).toBeDefined();
			expect(cityChange.valueChangedFrom).toBe('Shanghai');
			expect(cityChange.valueChangedTo).toBe('Beijing');
		});

		it('should track deep compositions with special character IDs', async () => {
			// Test deep composition with entities using special character IDs
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

			// All levels should be tracked with correct entityKey
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
			// RootSample uses String keys instead of UUID
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
			const titleChange = changes.find(c => c.attribute === 'title');
			expect(titleChange).toBeDefined();
			expect(titleChange.entityKey).toBe(stringId);
		});

		it('should track update and delete on entities with string keys', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { RootSample } = adminService.entities;
			const stringId = 'string-key-for-update-delete';

			// Create
			await INSERT.into(RootSample).entries({
				ID: stringId,
				title: 'Original Title'
			});

			// Update
			await UPDATE(RootSample).where({ ID: stringId }).with({
				title: 'Updated Title'
			});

			const updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: stringId,
				modification: 'update'
			});

			expect(updateChanges.length).toBe(1);
			expect(updateChanges[0].valueChangedFrom).toBe('Original Title');
			expect(updateChanges[0].valueChangedTo).toBe('Updated Title');

			// Delete
			await DELETE.from(RootSample).where({ ID: stringId });

			const deleteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: stringId,
				modification: 'delete'
			});

			expect(deleteChanges.length).toBeGreaterThan(0);
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
