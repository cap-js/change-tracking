const cds = require('@sap/cds');
const { val } = require('@sap/cds/lib/ql/cds-ql');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { data, GET } = cds.test(bookshop);

let adminService = null;
let ChangeView = null;
let ChangeLog = null;
let db = null;

// Test data IDs used multiple times across tests
const TEST_DATA = {
	bookStores: {
		SHAKESPEARE: '64625905-c234-4d0d-9bc1-283ee8946770',
		NEW_STORE: '843b3681-8b32-4d30-82dc-937cdbc68b3a',
		OBJECTID_TEST: '9d703c23-54a8-4eff-81c1-cdce6b6587c4',
	},
	rootEntity: {
		WUTHERING: '64625905-c234-4d0d-9bc1-283ee8940812',
		NEW_NESTED: '01234567-89ab-cdef-0123-987654fedcba',
		DATE_TIME_TEST: '64625905-c234-4d0d-9bc1-283ee8940717',
		INFO_TEST: '01234567-89ab-cdef-0123-456789dcbafe',
	},
	level1Entity: {
		NEW_CHILD: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
	},
	level2Entity: {
		EXISTING: 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff',
		NEW_CHILD: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
	},
	level3Entity: {
		TEST: '12ed5dd8-d45b-11ed-afa1-0242ac654321',
	},
	orders: {
		EXISTING: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
		ZERO_FALSE_TEST: '0faaff2d-7e0e-4494-97fe-c815ee973fa1',
		MULTI_TEST_1: 'fa4d0140-efdd-4c32-aafd-efb7f1d0c8e1',
		MULTI_TEST_2: 'ec365b25-b346-4444-8f03-8f5b7d94f040',
		MULTI_TEST_3: 'ab9e5510-a60b-4dfc-b026-161c5c2d4056',
	},
	orderItems: {
		EXISTING: '2b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
	},
	books: {
		WUTHERING: '9d703c23-54a8-4eff-81c1-cdce6b8376b1',
		TEST_BOOK: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a0d1a',
	},
	registry: {
		NEW: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
	},
	volumns: {
		TEST: 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf',
	},
};

describe('Change Tracking - Service API Integration Tests', () => {
	let log = cds.test.log();

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

	describe('Deletion Tracking Behavoiur with preserveDeletes', () => {

		afterEach(() => {
			cds.env.requires['change-tracking'].preserveDeletes = false;
		});

		it('should retain all changelogs after root entity deletion and create delete changelog when preserveDeletes is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			const { Authors } = adminService.entities;

			const newAuthorId = cds.utils.uuid();
			const authorData = [
				{
					ID: newAuthorId,
					name_firstName: 'Sam',
					name_lastName: 'Smiths',
					placeOfBirth: 'test place'
				}
			];
			await INSERT.into(Authors).entries(authorData);

			const beforeDelete = await adminService.run(SELECT.from(ChangeView).where({ entityKey: newAuthorId }));
			expect(beforeDelete.length).toEqual(3);

			await DELETE.from(Authors).where({ ID: newAuthorId });

			const afterDelete = await adminService.run(SELECT.from(ChangeView).where({ entityKey: newAuthorId }));
			expect(afterDelete).toHaveLength(6);
		});

		it('should delete all changelogs when preserveDeletes is disabled (by default)', async () => {
			const { Authors } = adminService.entities;

			const newAuthorId = cds.utils.uuid();
			const authorData = [
				{
					ID: newAuthorId,
					name_firstName: 'Sam',
					name_lastName: 'Smiths',
					placeOfBirth: 'test place'
				}
			];
			await INSERT.into(Authors).entries(authorData);

			const beforeDelete = await adminService.run(SELECT.from(ChangeView).where({ entityKey: newAuthorId }));
			expect(beforeDelete.length).toEqual(3);

			await DELETE.from(Authors).where({ ID: newAuthorId });

			const afterDelete = await adminService.run(SELECT.from(ChangeView).where({ entityKey: newAuthorId }));
			expect(afterDelete).toHaveLength(0);
		});

	});

	describe('Tracking Special Data Types', () => {

		afterEach(() => {
			const { Order, RootEntity } = adminService.entities;
			delete Order.elements.netAmount['@changelog'];
			delete Order.elements.isUsed['@changelog'];
			delete RootEntity.elements.dateTime['@changelog'];
			delete RootEntity.elements.timestamp['@changelog'];
		});
		it('should track numeric zero value on create', async () => {
			const { Order } = adminService.entities;
			Order.elements.netAmount['@changelog'] = true;

			const orderID = cds.utils.uuid();
			const ordersData = {
				ID: orderID,
				netAmount: 0
			};

			await INSERT.into(Order).entries(ordersData);
			const changes = await adminService.run(SELECT.from(ChangeView));

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: orderID,
				modification: 'create',
				attribute: 'netAmount',
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				// valueChangedTo: 0
			});
			expect(Number(changes[0].valueChangedTo)).toBe(0);
		});

		it('should track boolean false value on create', async () => {
			const { Order } = adminService.entities;
			Order.elements.isUsed['@changelog'] = true;

			const orderID = cds.utils.uuid();
			const ordersData = {
				ID: orderID,
				isUsed: false
			};

			await INSERT.into(Order).entries(ordersData);
			const changes = await adminService.run(SELECT.from(ChangeView).where({ entity: 'sap.capire.bookshop.Order', attribute: 'isUsed' }));

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: orderID,
				modification: 'create',
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				valueChangedTo: 'false',
			});
		});

		it.skip('should support Date objects for DateTime and Timestamp fields on create', async () => {
			// logic appears to store Date.toString() output
			const { RootEntity } = adminService.entities;
			RootEntity.elements.dateTime['@changelog'] = true;
			RootEntity.elements.timestamp['@changelog'] = true;

			const formatOptions = {
				timeZone: 'UTC',
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: true
			};

			const dateTime = '2024-10-16T08:53:48Z';
			const timestamp = '2024-10-23T08:53:54.000Z';
			const rootEntityId = cds.utils.uuid();

			await INSERT.into(RootEntity).entries({
				ID: rootEntityId,
				dateTime: new Date(dateTime),
				timestamp: new Date(timestamp)
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootEntity',
					attribute: ['dateTime', 'timestamp']
				})
			);
			expect(changes).toHaveLength(2);

			const changesDateTime = changes.find(c => c.attribute === 'dateTime');
			expect(changesDateTime).toMatchObject({
				entityKey: rootEntityId,
				attribute: 'dateTime',
				modification: 'create',
				valueChangedFrom: '',
				valueChangedTo: new Date(dateTime).toLocaleString('en-US', formatOptions)
			});

			const changesTimestamp = changes.find(c => c.attribute === 'timestamp');
			expect(changesTimestamp).toMatchObject({
				entityKey: rootEntityId,
				attribute: 'timestamp',
				modification: 'create',
				valueChangedFrom: '',
				valueChangedTo: new Date(timestamp).toLocaleString('en-US', formatOptions)
			});
		});

	});

	describe('Deep Composition Operations', () => {
		it('should log changes on root entity when deep creating BookStore with books', async () => {
			const { BookStores } = adminService.entities;

			const bookStoreID = cds.utils.uuid();
			const bookID = cds.utils.uuid();
			const bookTitle = 'test title';
			const bookStoreData = {
				ID: bookStoreID,
				name: 'test bookstore name',
				location: 'test location',
				books: [
					{
						ID: bookID,
						title: bookTitle,
						descr: 'test',
						stock: 333,
						price: 13.13,
						author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'
					}
				]
			};
			await adminService.run(INSERT.into(BookStores).entries(bookStoreData));

			let changes = await SELECT.from(ChangeView).where({entity: 'sap.capire.bookshop.BookStores', attribute: 'books'});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: bookStoreID,
				modification: 'create',
				objectID: 'test bookstore name',
				valueChangedFrom: '',
				valueChangedTo: bookTitle
			});

			// child entity change log for title
			changes = await SELECT.from(ChangeView).where({entity: 'sap.capire.bookshop.Books', attribute: 'title'});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: bookStoreID,
				keys: `ID=${bookID}`,
				modification: 'create',
				objectID: 'test title, Emily, Brontë',
				parentKey: bookStoreID,
				parentObjectID: 'test bookstore name'
			});
		});

		it('should track changes on deep update', async () => {
			const { BookStores } = adminService.entities;
			const bookStoreID = cds.utils.uuid();
			const bookID = cds.utils.uuid();

			// Create initial BookStore with registry
			const bookStoreData = {
				ID: bookStoreID,
				name: 'test bookstore name',
				books: [
					{
						ID: bookID,
						title: 'test title'
					}
				]
			};
			await adminService.run(INSERT.into(BookStores).entries(bookStoreData));

			await UPDATE(BookStores).where({ ID: bookStoreID })
				.with({
					books: [{ ID: bookID, title: 'Wuthering Heights Test' }]
				});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				attribute: 'title'
			});

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: bookStoreID,
				objectID: 'Wuthering Heights Test, Emily, Brontë',
				parentObjectID: 'test bookstore name',
			});
		});
	});

	describe('Inline Entity Operations', () => {
		it('should track changes on inline composition update', async () => {
			const OrderItems = adminService.entities['Order.Items'];

			await UPDATE(OrderItems)
				.where({
					up__ID: TEST_DATA.orders.EXISTING,
					ID: TEST_DATA.orderItems.EXISTING
				})
				.with({
					quantity: 12
				});

			const changes = await adminService.run(SELECT.from(ChangeView));

			expect(changes).toHaveLength(1);
			const change = changes[0];
			expect(change).toMatchObject({
				attribute: 'quantity',
				modification: 'Update',
				valueChangedFrom: '10',
				valueChangedTo: '12',
				parentKey: TEST_DATA.orders.EXISTING,
				keys: 'ID=' + TEST_DATA.orderItems.EXISTING,
			});
		});
	});

	describe('ObjectID from Associations', () => {
		it('should resolve objectID from chained associations on create', async () => {
			const { BookStores, Level3Entity } = adminService.entities;

			BookStores['@changelog'].push({ '=': 'city.name' });

			const bookStoreData = {
				ID: TEST_DATA.bookStores.OBJECTID_TEST,
				name: 'new name'
			};
			await INSERT.into(BookStores).entries(bookStoreData);

			let createBookStoresChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				attribute: 'name',
				modification: 'create'
			});
			expect(createBookStoresChanges).toHaveLength(1);
			expect(createBookStoresChanges[0].objectID).toBe('new name');

			const level3EntityData = [
				{
					ID: cds.utils.uuid(),
					title: 'Service api Level3 title',
					parent_ID: TEST_DATA.level2Entity.EXISTING
				}
			];
			await INSERT.into(Level3Entity).entries(level3EntityData);

			let createChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Entity',
				attribute: 'title',
				modification: 'create'
			});
			expect(createChanges).toHaveLength(1);
			const createChange = createChanges[0];
			expect(createChange).toMatchObject({
				objectID: 'In Preparation',
				parentKey: TEST_DATA.level2Entity.EXISTING,
				parentObjectID: 'In Preparation',
			});

			const changeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.RootEntity',
				entityKey: TEST_DATA.rootEntity.WUTHERING,
				serviceEntity: 'AdminService.RootEntity'
			});

			expect(changeLogs).toHaveLength(1);
			expect(changeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.RootEntity',
				entityKey: TEST_DATA.rootEntity.WUTHERING,
				serviceEntity: 'AdminService.RootEntity',
			});

			BookStores['@changelog'].pop();
		});

		it('should resolve objectID from chained associations on update', async () => {
			const { BookStores, Level3Entity, RootEntity } = adminService.entities;

			BookStores['@changelog'].push({ '=': 'city.name' });

			await UPDATE(BookStores)
				.where({
					ID: TEST_DATA.bookStores.OBJECTID_TEST
				})
				.with({
					name: 'BookStores name changed'
				});

			const updateBookStoresChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'name',
					modification: 'update'
				})
			);
			expect(updateBookStoresChanges).toHaveLength(1);
			expect(updateBookStoresChanges[0].objectID).toBe('BookStores name changed');

			await UPDATE(Level3Entity, TEST_DATA.level3Entity.TEST).with({
				title: 'L3 title changed by QL API'
			});

			let updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Entity',
				attribute: 'title',
				modification: 'update'
			});
			expect(updateChanges).toHaveLength(1);
			const updateChange = updateChanges[0];
			expect(updateChange).toMatchObject({
				objectID: 'In Preparation',
				parentKey: TEST_DATA.level2Entity.EXISTING,
				parentObjectID: 'In Preparation',
			});

			const rootEntityData = {
				ID: TEST_DATA.rootEntity.NEW_NESTED,
				name: 'New name for RootEntity',
				lifecycleStatus_code: 'IP',
				child: [
					{
						ID: TEST_DATA.level1Entity.NEW_CHILD,
						title: 'New name for Level1Entity',
						parent_ID: TEST_DATA.rootEntity.NEW_NESTED,
						child: [
							{
								ID: TEST_DATA.level2Entity.NEW_CHILD,
								title: 'New name for Level2Entity',
								parent_ID: TEST_DATA.level1Entity.NEW_CHILD
							}
						]
					}
				]
			};
			await INSERT.into(RootEntity).entries(rootEntityData);

			const createEntityChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(createEntityChanges).toHaveLength(1);
			expect(createEntityChanges[0].objectID).toBe('In Preparation');

			await UPDATE(RootEntity, { ID: TEST_DATA.rootEntity.NEW_NESTED }).with({
				ID: TEST_DATA.rootEntity.NEW_NESTED,
				name: 'RootEntity name changed',
				lifecycleStatus_code: 'AC',
				child: [
					{
						ID: TEST_DATA.level1Entity.NEW_CHILD,
						parent_ID: TEST_DATA.rootEntity.NEW_NESTED,
						child: [
							{
								ID: TEST_DATA.level2Entity.NEW_CHILD,
								parent_ID: TEST_DATA.level1Entity.NEW_CHILD,
								title: 'Level2Entity title changed'
							}
						]
					}
				]
			});

			const updateEntityChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					attribute: 'title',
					modification: 'update'
				})
			);
			expect(updateEntityChanges).toHaveLength(1);
			expect(updateEntityChanges[0].objectID).toBe('Open');

			BookStores['@changelog'].pop();
		});

		it('should resolve objectID from chained associations on delete', async () => {
			const { Level3Entity, RootEntity } = adminService.entities;

			await DELETE.from(Level3Entity).where({ ID: TEST_DATA.level3Entity.TEST });

			let deleteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Entity',
				attribute: 'title',
				modification: 'delete'
			});
			expect(deleteChanges).toHaveLength(1);
			const deleteChange = deleteChanges[0];
			expect(deleteChange).toMatchObject({
				objectID: 'In Preparation',
				parentKey: TEST_DATA.level2Entity.EXISTING,
				parentObjectID: 'In Preparation',
			});

			await UPDATE(RootEntity, { ID: TEST_DATA.rootEntity.NEW_NESTED }).with({
				ID: TEST_DATA.rootEntity.NEW_NESTED,
				name: 'RootEntity name del',
				lifecycleStatus_code: 'CL',
				child: [
					{
						ID: TEST_DATA.level1Entity.NEW_CHILD,
						parent_ID: TEST_DATA.rootEntity.NEW_NESTED,
						child: []
					}
				]
			});

			const deleteEntityChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					attribute: 'title',
					modification: 'delete'
				})
			);
			expect(deleteEntityChanges).toHaveLength(1);
			expect(deleteEntityChanges[0].objectID).toBe('Closed');
		});
	});

	describe('Display Values from Associations', () => {
		it('should resolve display values from chained associations', async () => {
			const { RootEntity } = adminService.entities;

			const rootEntityData = [
				{
					ID: TEST_DATA.rootEntity.INFO_TEST,
					info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346'
				}
			];
			await INSERT.into(RootEntity).entries(rootEntityData);

			let createChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootEntity',
				attribute: 'info',
				modification: 'create'
			});
			expect(createChanges).toHaveLength(1);
			const createChange = createChanges[0];
			expect(createChange).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'Super Mario1',
			});

			await UPDATE(RootEntity, TEST_DATA.rootEntity.INFO_TEST).with({
				info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f44f435'
			});

			let updateChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootEntity',
				attribute: 'info',
				modification: 'update'
			});
			expect(updateChanges).toHaveLength(1);
			const updateChange = updateChanges[0];
			expect(updateChange).toMatchObject({
				valueChangedFrom: 'Super Mario1',
				valueChangedTo: 'Super Mario3',
			});
		});
	});

	describe('Composition of One Operations', () => {
		it('should track changes on deep create with composition of one', async () => {
			const { BookStores } = adminService.entities;

			const bookStoreData = {
				ID: TEST_DATA.bookStores.NEW_STORE,
				name: 'test bookstore name',
				registry: {
					ID: TEST_DATA.registry.NEW,
					code: 'San Francisco-2',
					validOn: '2022-01-01'
				}
			};

			await adminService.run(INSERT.into(BookStores).entries(bookStoreData));

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				attribute: 'validOn'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: TEST_DATA.bookStores.NEW_STORE,
				objectID: 'San Francisco-2',
				valueChangedFrom: '',
				valueChangedTo: '2022-01-01',
				parentKey: TEST_DATA.bookStores.NEW_STORE,
				parentObjectID: 'test bookstore name',
			});
		});

		it('should track changes on deep update with composition of one', async () => {
			const { BookStores } = adminService.entities;

			const BookStoreRegistry = cds.services.AdminService.entities.BookStoreRegistry;
			BookStoreRegistry['@changelog'] = [{ '=': 'code' }, { '=': 'validOn' }];

			await UPDATE(BookStores)
				.where({ ID: TEST_DATA.bookStores.SHAKESPEARE })
				.with({
					registry: {
						ID: '12ed5ac2-d45b-11ed-afa1-0242ac120001',
						validOn: '2022-01-01'
					}
				});

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				attribute: 'validOn'
			});

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: TEST_DATA.bookStores.SHAKESPEARE,
				objectID: 'Paris-1, 2022-01-01',
				modification: 'update',
				valueChangedFrom: '2012-01-01',
				valueChangedTo: '2022-01-01',
				parentKey: TEST_DATA.bookStores.SHAKESPEARE,
				parentObjectID: 'Shakespeare and Company',
			});

			BookStoreRegistry['@changelog'] = [{ '=': 'code' }];
		});

		it('should track changes on deep delete with composition of one', async () => {
			const { BookStores } = adminService.entities;

			await UPDATE(BookStores).where({ ID: TEST_DATA.bookStores.SHAKESPEARE }).with({
				registry: null,
				registry_ID: null
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStoreRegistry',
				attribute: 'validOn'
			});

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				entityKey: TEST_DATA.bookStores.SHAKESPEARE,
				objectID: 'Paris-1',
				modification: 'delete',
				parentObjectID: 'Shakespeare and Company',
				valueChangedFrom: '2012-01-01',
				valueChangedTo: '',
			});
		});
	});

	describe('Configuration Settings', () => {
		describe('disableUpdateTracking', () => {
			it('should not track updates when enabled', async () => {
				const { BookStores } = adminService.entities;

				cds.env.requires['change-tracking'].disableUpdateTracking = true;

				await UPDATE(BookStores).where({ ID: TEST_DATA.bookStores.SHAKESPEARE }).with({ name: 'New name' });

				let changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'name',
					modification: 'update'
				});
				expect(changes).toHaveLength(0);

				cds.env.requires['change-tracking'].disableUpdateTracking = false;
			});

			it('should track updates when disabled', async () => {
				const { BookStores } = adminService.entities;

				cds.env.requires['change-tracking'].disableUpdateTracking = false;

				await UPDATE(BookStores).where({ ID: TEST_DATA.bookStores.SHAKESPEARE }).with({ name: 'Another name' });

				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'name',
					modification: 'update'
				});
				expect(changes).toHaveLength(1);
			});
		});

		describe('disableCreateTracking', () => {
			it('should not track creates when enabled', async () => {
				const { BookStores } = adminService.entities;

				cds.env.requires['change-tracking'].disableCreateTracking = true;

				await INSERT.into(BookStores).entries({
					ID: TEST_DATA.bookStores.OBJECTID_TEST,
					name: 'new name'
				});

				let changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'name',
					modification: 'create'
				});
				expect(changes).toHaveLength(0);

				cds.env.requires['change-tracking'].disableCreateTracking = false;
			});

			it('should track creates when disabled', async () => {
				const { BookStores } = adminService.entities;

				cds.env.requires['change-tracking'].disableCreateTracking = false;

				await INSERT.into(BookStores).entries({
					ID: cds.utils.uuid(),
					name: 'another name'
				});

				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'name',
					modification: 'create'
				});
				expect(changes).toHaveLength(1);
			});
		});

		describe('disableDeleteTracking', () => {
			it('should not track deletes when enabled', async () => {
				const { Level3Entity } = adminService.entities;

				cds.env.requires['change-tracking'].disableDeleteTracking = true;

				await DELETE.from(Level3Entity).where({ ID: TEST_DATA.level3Entity.TEST });

				let changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Entity',
					attribute: 'title',
					modification: 'delete'
				});
				expect(changes).toHaveLength(0);

				cds.env.requires['change-tracking'].disableDeleteTracking = false;
			});

			it('should track deletes when disabled', async () => {
				const { Level2Entity } = adminService.entities;

				cds.env.requires['change-tracking'].disableDeleteTracking = false;

				await DELETE.from(Level2Entity).where({ ID: TEST_DATA.level2Entity.EXISTING });

				const changes = await SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Entity',
					attribute: 'title',
					modification: 'delete'
				});
				expect(changes).toHaveLength(1);
			});
		});
	});

	describe('Edge Cases', () => {
		it('should not track personal data changes', async () => {
			const { Customers } = adminService.entities;

			const allCustomers = await SELECT.from(Customers);
			await UPDATE(Customers).where({ ID: allCustomers[0].ID }).with({
				name: 'John Doe'
			});

			const changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Customers'
			});

			expect(changes).toHaveLength(0);
		});

		it('should track changes for multiple root entities created together', async () => {
			const { Order } = adminService.entities;

			cds.env.requires['change-tracking'].preserveDeletes = true;

			Order.elements.netAmount['@changelog'] = true;
			Order.elements.isUsed['@changelog'] = true;

			const ordersData = [
				{
					ID: TEST_DATA.orders.MULTI_TEST_1,
					isUsed: false,
					netAmount: 0,
					orderItems: [
						{
							ID: cds.utils.uuid(),
							quantity: 10
						},
						{
							ID: cds.utils.uuid(),
							quantity: 12
						}
					]
				},
				{
					ID: TEST_DATA.orders.MULTI_TEST_2,
					isUsed: true,
					netAmount: 10,
					orderItems: [
						{
							ID: cds.utils.uuid(),
							quantity: 10
						},
						{
							ID: cds.utils.uuid(),
							quantity: 12
						}
					]
				},
				{
					ID: TEST_DATA.orders.MULTI_TEST_3,
					isUsed: false,
					netAmount: 20,
					orderItems: [
						{
							ID: cds.utils.uuid(),
							quantity: 10
						},
						{
							ID: cds.utils.uuid(),
							quantity: 12
						}
					]
				}
			];

			await INSERT.into(Order).entries(ordersData);
			let changes = await adminService.run(SELECT.from(ChangeView));

			expect(changes).toHaveLength(12);
			expect(changes.some((c) => c.modification !== 'create')).toBe(false);

			let changesOrder1 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: TEST_DATA.orders.MULTI_TEST_1 }));

			const netAmountChange1 = changesOrder1.find((change) => change.attribute === 'netAmount');
			expect(netAmountChange1).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
			});
			expect(Number(netAmountChange1.valueChangedTo)).toBe(0);

			const isUsedChange1 = changesOrder1.find((change) => change.attribute === 'isUsed');
			expect(isUsedChange1).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				valueChangedTo: 'false',
			});

			const quantityChanges1 = changesOrder1.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges1[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges1[0].valueChangedTo)).toBe(10);
			expect(quantityChanges1[1]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges1[1].valueChangedTo)).toBe(12);

			let changesOrder2 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: TEST_DATA.orders.MULTI_TEST_2 }));

			const netAmountChange2 = changesOrder2.find((change) => change.attribute === 'netAmount');
			expect(netAmountChange2).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
			});
			expect(Number(netAmountChange2.valueChangedTo)).toBe(10);

			const isUsedChange2 = changesOrder2.find((change) => change.attribute === 'isUsed');
			expect(isUsedChange2).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				valueChangedTo: 'true',
			});

			const quantityChanges2 = changesOrder2.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges2[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges2[0].valueChangedTo)).toBe(10);
			expect(quantityChanges2[1]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges2[1].valueChangedTo)).toBe(12);

			let changesOrder3 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: TEST_DATA.orders.MULTI_TEST_3 }));

			const netAmountChange3 = changesOrder3.find((change) => change.attribute === 'netAmount');
			expect(netAmountChange3).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
			});
			expect(Number(netAmountChange3.valueChangedTo)).toBe(20);

			const isUsedChange3 = changesOrder3.find((change) => change.attribute === 'isUsed');
			expect(isUsedChange3).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				valueChangedTo: 'false',
			});

			const quantityChanges3 = changesOrder3.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
			expect(quantityChanges3[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges3[0].valueChangedTo)).toBe(10);
			expect(quantityChanges3[1]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItem',
				valueChangedFrom: '',
			});
			expect(Number(quantityChanges3[1].valueChangedTo)).toBe(12);

			cds.env.requires['change-tracking'].preserveDeletes = false;
			delete Order.elements.netAmount['@changelog'];
			delete Order.elements.isUsed['@changelog'];
		});

		it('should handle special characters in entity keys', async () => {
			const { RootSample } = adminService.entities;

			const sampleData = {
				ID: '/three',
				title: 'RootSample title3',
				child: [
					{
						ID: '/level1three',
						title: 'Level1Sample title3',
						child: [
							{
								ID: '/level2three',
								title: 'Level2Sample title3'
							}
						]
					}
				]
			};

			await adminService.run(INSERT.into(RootSample).entries(sampleData));

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				attribute: 'title'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'RootSample title3',
				entityKey: '/three',
				parentKey: '',
				objectID: '/three, RootSample title3',
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level1Sample',
				attribute: 'title'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'Level1Sample title3',
				entityKey: '/three',
				parentKey: '/three',
				objectID: '/level1three, Level1Sample title3, /three',
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Sample',
				attribute: 'title'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'Level2Sample title3',
				entityKey: '/three',
				parentKey: '/level1three',
				objectID: '/level2three, Level2Sample title3, /three',
			});
		});

		describe('Localization edge cases', () => {
			it('should handle entity not in model', async () => {
				const { Changes } = cds.entities('sap.changelog');
				const { Volumns } = cds.entities('VolumnsService');
				const VolumnsSrv = await cds.connect.to('VolumnsService');

				await VolumnsSrv.run(UPDATE.entity(Volumns).where({ ID: TEST_DATA.volumns.TEST }).set({ title: 'new title' }));

				const {
					data: { value: changes }
				} = await GET('/odata/v4/volumns/Volumns(ID=' + TEST_DATA.volumns.TEST + ')/changes');
				expect(changes).toHaveLength(1);

				await UPDATE(Changes).where({ ID: changes[0].ID }).set({ serviceEntity: 'Volumns' });

				const {
					data: { value: changes2 }
				} = await GET('/odata/v4/volumns/Volumns(ID=' + TEST_DATA.volumns.TEST + ')/changes');
				expect(changes2).toHaveLength(1);
				expect(changes2[0].serviceEntity).toBe('Volumns');
				expect(log.output.length).toBeGreaterThan(0);
				expect(log.output).toMatch(/Cannot localize the attribute/);
			});

			it('should handle attribute not in model', async () => {
				const { Changes } = cds.entities('sap.changelog');
				const { Volumns } = cds.entities('VolumnsService');
				const VolumnsSrv = await cds.connect.to('VolumnsService');

				await VolumnsSrv.run(UPDATE.entity(Volumns).where({ ID: TEST_DATA.volumns.TEST }).set({ title: 'new title' }));

				const {
					data: { value: changes }
				} = await GET('/odata/v4/volumns/Volumns(ID=' + TEST_DATA.volumns.TEST + ')/changes');
				expect(changes).toHaveLength(1);

				await UPDATE(Changes).where({ ID: changes[0].ID }).set({ attribute: 'abc' });

				const {
					data: { value: changes2 }
				} = await GET('/odata/v4/volumns/Volumns(ID=' + TEST_DATA.volumns.TEST + ')/changes');
				expect(changes2).toHaveLength(1);
				expect(changes2[0].attribute).toBe('abc');
				expect(log.output.length).toBeGreaterThan(0);
				expect(log.output).toMatch(/Cannot localize the attribute/);
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
