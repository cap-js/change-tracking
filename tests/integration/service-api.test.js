const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { data, GET } = cds.test(bookshop);

let adminService = null;
let ChangeView = null;
let db = null;

describe('change log integration test', () => {
	let log = cds.test.log();

	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		db = await cds.connect.to('db');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false; // why?
	});

	beforeEach(async () => {
		//await data.reset();
	});

	it('should keep all changelogs after root entity is deleted and generate a changelog for the deletion operation when preserveDeletes is activated', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		const { Authors } = adminService.entities;

		const authorData = [
			{
				ID: '64625905-c234-4d0d-9bc1-283ee8940812',
				name_firstName: 'Sam',
				name_lastName: 'Smiths',
				placeOfBirth: 'test place'
			}
		];

		await INSERT.into(Authors).entries(authorData);
		const beforeChanges = await adminService.run(SELECT.from(ChangeView));
		expect(beforeChanges.length > 0).toBeTruthy();

		await DELETE.from(Authors).where({ ID: '64625905-c234-4d0d-9bc1-283ee8940812' });

		const afterChanges = await adminService.run(SELECT.from(ChangeView));
		expect(afterChanges.length).toEqual(beforeChanges.length * 2);
	});

	it('should track numeric 0 and boolean false on create and delete', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		const { Order } = adminService.entities;

		const ordersData = {
			ID: '0faaff2d-7e0e-4494-97fe-c815ee973fa1',
			isUsed: false,
			netAmount: 0
		};

		await INSERT.into(Order).entries(ordersData);
		let changes = await adminService.run(SELECT.from(ChangeView));

		expect(changes.length).toEqual(2);

		const change1 = changes.find((c) => c.attribute === 'netAmount');

		expect(change1).toHaveProperty('entityKey', '0faaff2d-7e0e-4494-97fe-c815ee973fa1');
		expect(change1).toHaveProperty('modification', 'create');
		expect(change1).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change1.valueChangedFrom).toEqual(null);
		expect(Number(change1.valueChangedTo)).toEqual(0);

		const change2 = changes.find((c) => c.attribute === 'isUsed');

		expect(change2).toHaveProperty('entityKey', '0faaff2d-7e0e-4494-97fe-c815ee973fa1');
		expect(change2).toHaveProperty('modification', 'create');
		expect(change2).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change2.valueChangedFrom).toEqual(null);
		expect(change2.valueChangedTo).toEqual('false');

		await DELETE.from(Order).where({ ID: '0faaff2d-7e0e-4494-97fe-c815ee973fa1' });
		changes = await adminService.run(
			SELECT.from(ChangeView).where({ modification: 'delete' })
		);

		expect(changes.length).toEqual(2);

		const change3 = changes.find((c) => c.attribute === 'netAmount');

		expect(change3).toHaveProperty('entityKey', '0faaff2d-7e0e-4494-97fe-c815ee973fa1');
		expect(change3).toHaveProperty('modification', 'delete');
		expect(change3).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(Number(change3.valueChangedFrom)).toEqual(0);
		expect(change3.valueChangedTo).toEqual(null);

		const change4 = changes.find((c) => c.attribute === 'isUsed');

		expect(change4).toHaveProperty('entityKey', '0faaff2d-7e0e-4494-97fe-c815ee973fa1');
		expect(change4).toHaveProperty('modification', 'delete');
		expect(change4).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change4.valueChangedFrom).toEqual('false');
		expect(change4.valueChangedTo).toEqual(null);

		delete cds.services.AdminService.entities.Order.elements.netAmount['@changelog'];
		delete cds.services.AdminService.entities.Order.elements.isUsed['@changelog'];
	});

	it('1.9 For DateTime and Timestamp, support for input via Date objects.', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		const { RootEntity } = adminService.entities;

		const rootEntityData = [
			{
				ID: '64625905-c234-4d0d-9bc1-283ee8940717',
				dateTime: new Date('2024-10-16T08:53:48Z'),
				timestamp: new Date('2024-10-23T08:53:54.000Z')
			}
		];
		await INSERT.into(RootEntity).entries(rootEntityData);
		let changes = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootEntity',
				attribute: 'dateTime'
			})
		);
		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual('64625905-c234-4d0d-9bc1-283ee8940717');
		expect(changes[0].attribute).toEqual('dateTime');
		expect(changes[0].modification).toEqual('create');
		expect(changes[0].valueChangedFrom).toEqual(null);
		/**
		 * REVISIT: Currently, when using '@cap-js/sqlite' or '@cap-js/hana' and inputting values of type Date in javascript,
		 * there is an issue with inconsistent formats before and after, which requires a fix from cds-dbs (Issue-873).
		 */
		expect(changes[0].valueChangedTo).toEqual(
			new Date('2024-10-16T08:53:48Z').toLocaleDateString('en', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: true
			})
		);
		cds.env.requires['change-tracking'].preserveDeletes = false;
	});

	it('2.5 Root entity deep creation by service API  - should log changes on root entity', async () => {
		const { BookStores } = adminService.entities;

		const bookStoreData = {
			ID: '843b3681-8b32-4d30-82dc-937cdbc68b3a',
			name: 'test bookstore name',
			location: 'test location',
			books: [
				{
					ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a0d1a',
					title: 'test title',
					descr: 'test',
					stock: 333,
					price: 13.13,
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387'
				}
			]
		};

		// CAP currently support run queries on the draft-enabled entity on application service, so we can re-enable it. (details in CAP/Issue#16292)
		await adminService.run(INSERT.into(BookStores).entries(bookStoreData));

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual(bookStoreData.ID);
		expect(changes[0].objectID).toEqual('test bookstore name');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Books',
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual(bookStoreData.books[0].ID);
		expect(changes[0].objectID).toEqual('test title, Emily, Brontë');
	});

	it('2.6 Root entity deep update by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)', async () => {
		const { BookStores } = adminService.entities;

		await UPDATE(BookStores)
			.where({ ID: '64625905-c234-4d0d-9bc1-283ee8946770' })
			.with({
				books: [{ ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b1', title: 'Wuthering Heights Test' }]
			});

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Books',
			attribute: 'title'
		});

		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual('9d703c23-54a8-4eff-81c1-cdce6b8376b1');
		expect(changes[0].rootEntityKey).toEqual('64625905-c234-4d0d-9bc1-283ee8946770');
		expect(changes[0].objectID).toEqual('Wuthering Heights Test, Emily, Brontë');
		expect(changes[0].rootObjectID).toEqual('Shakespeare and Company, Paris');
	});

	it('3.6 Composition operation of inline entity operation by QL API', async () => {
		await UPDATE(adminService.entities['Order.Items'])
			.where({
				up__ID: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
				ID: '2b23bb4b-4ac7-4a24-ac02-aa10cabd842c'
			})
			.with({
				quantity: 12
			});

		const changes = await adminService.run(SELECT.from(ChangeView));

		expect(changes.length).toEqual(1);
		expect(changes[0].attribute).toEqual('quantity');
		expect(changes[0].modification).toEqual('update');
		expect(changes[0].valueChangedFrom).toEqual('10');
		expect(changes[0].valueChangedTo).toEqual('12');
		expect(changes[0].rootEntityKey).toEqual('3b23bb4b-4ac7-4a24-ac02-aa10cabd842c');
		expect(changes[0].entityKey).toEqual('3b23bb4b-4ac7-4a24-ac02-aa10cabd842c||2b23bb4b-4ac7-4a24-ac02-aa10cabd842c');
	});

	// REVISIT: create entry for rootEntity and not parent entity (Root -> Level1 -> Level2 -> Level3)
	it('7.3 Annotate fields from chained associated entities as objectID (ERP4SMEPREPWORKAPPPLAT-4542)', async () => {
		const { BookStores, Level3Entity, RootEntity } = adminService.entities;
		const Changes = cds.model.definitions['sap.changelog.Changes'];
		// cds.services.AdminService.entities.BookStores['@changelog'].push({ '=': 'city.name' });

		const bookStoreData = {
			ID: '9d703c23-54a8-4eff-81c1-cdce6b6587c4',
			name: 'new name'
		};
		await INSERT.into(BookStores).entries(bookStoreData);
		let createBookStoresChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name',
			modification: 'create'
		});
		expect(createBookStoresChanges.length).toEqual(1);
		expect(createBookStoresChanges[0].objectID).toEqual('new name');

		await UPDATE(BookStores).where({ ID: '9d703c23-54a8-4eff-81c1-cdce6b6587c4' })
			.with({ name: 'BookStores name changed' });
		const updateBookStoresChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.BookStores',
				attribute: 'name',
				modification: 'update'
			})
		);
		expect(updateBookStoresChanges.length).toEqual(1);
		expect(updateBookStoresChanges[0].objectID).toEqual('BookStores name changed');

		//cds.services.AdminService.entities.BookStores['@changelog'].pop();

		const level3EntityData = [
			{
				ID: '12ed5dd8-d45b-11ed-afa1-0242ac654321',
				title: 'Service api Level3 title',
				parent_ID: 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff'
			}
		];
		await INSERT.into(Level3Entity).entries(level3EntityData);
		let createChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level3Entity',
			attribute: 'title',
			modification: 'create'
		});
		expect(createChanges.length).toEqual(1);
		expect(createChanges[0].objectID).toEqual('In Preparation');
		expect(createChanges[0].rootEntityKey).toEqual('dd1fdd7d-da2a-4600-940b-0baf2946c4ff');
		expect(createChanges[0].rootObjectID).toEqual('In Preparation');

		// Check the changeLog to make sure the entity information is root
		// Rechange
		const changeLogs = await SELECT.from(Changes).where({
			rootEntity: 'sap.capire.bookshop.Level2Entity',
			rootEntityKey: 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff'
		});

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.RootEntity');
		expect(changeLogs[0].entityKey).toEqual('64625905-c234-4d0d-9bc1-283ee8940812');
		// expect(changeLogs[0].serviceEntity).toEqual('AdminService.RootEntity');

		await UPDATE(Level3Entity, '12ed5dd8-d45b-11ed-afa1-0242ac654321').with({
			title: 'L3 title changed by QL API'
		});
		let updateChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level3Entity',
			attribute: 'title',
			modification: 'update'
		});
		expect(createChanges.length).toEqual(1);
		expect(updateChanges[0].objectID).toEqual('In Preparation');
		expect(createChanges[0].rootEntityKey).toEqual('dd1fdd7d-da2a-4600-940b-0baf2946c4ff');
		expect(createChanges[0].rootObjectID).toEqual('In Preparation');

		await DELETE.from(Level3Entity).where({ ID: '12ed5dd8-d45b-11ed-afa1-0242ac654321' });
		let deleteChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level3Entity',
			attribute: 'title',
			modification: 'delete'
		});
		expect(deleteChanges.length).toEqual(1);
		expect(deleteChanges[0].objectID).toEqual('In Preparation');
		expect(createChanges[0].rootEntityKey).toEqual('dd1fdd7d-da2a-4600-940b-0baf2946c4ff');
		expect(createChanges[0].rootObjectID).toEqual('In Preparation');

		// Test object id when parent and child nodes are created at the same time
		const RootEntityData = {
			ID: '01234567-89ab-cdef-0123-987654fedcba',
			name: 'New name for RootEntity',
			lifecycleStatus_code: 'IP',
			child: [
				{
					ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
					title: 'New name for Level1Entity',
					parent_ID: '01234567-89ab-cdef-0123-987654fedcba',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
							title: 'New name for Level2Entity',
							parent_ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003'
						}
					]
				}
			]
		};
		await INSERT.into(RootEntity).entries(RootEntityData);

		const createEntityChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Entity',
				attribute: 'title',
				modification: 'create'
			})
		);
		expect(createEntityChanges.length).toEqual(1);
		expect(createEntityChanges[0].objectID).toEqual('In Preparation');

		// Test the object id when the parent node and child node are modified at the same time
		await UPDATE(RootEntity, { ID: '01234567-89ab-cdef-0123-987654fedcba' }).with({
			ID: '01234567-89ab-cdef-0123-987654fedcba',
			name: 'RootEntity name changed',
			lifecycleStatus_code: 'AC',
			child: [
				{
					ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
					parent_ID: '01234567-89ab-cdef-0123-987654fedcba',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
							parent_ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
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
		expect(updateEntityChanges.length).toEqual(1);
		expect(updateEntityChanges[0].objectID).toEqual('Open');

		// Tests the object id when the parent node update and child node deletion occur simultaneously
		await UPDATE(adminService.entities.RootEntity, { ID: '01234567-89ab-cdef-0123-987654fedcba' }).with({
			ID: '01234567-89ab-cdef-0123-987654fedcba',
			name: 'RootEntity name del',
			lifecycleStatus_code: 'CL',
			child: [
				{
					ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
					parent_ID: '01234567-89ab-cdef-0123-987654fedcba',
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
		expect(deleteEntityChanges.length).toEqual(1);
		const deleteEntityChange = deleteEntityChanges[0];
		expect(deleteEntityChange.objectID).toEqual('Closed');
	});

	it('8.3 Annotate fields from chained associated entities as displayed value (ERP4SMEPREPWORKAPPPLAT-4542)', async () => {
		const { RootEntity } = adminService.entities;
		const rootEntityData = [
			{
				ID: '01234567-89ab-cdef-0123-456789dcbafe',
				info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346'
			}
		];
		await INSERT.into(RootEntity).entries(rootEntityData);
		let createChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.RootEntity',
			attribute: 'info',
			modification: 'create'
		});
		expect(createChanges.length).toEqual(1);
		expect(createChanges[0].valueChangedFrom).toEqual(null);
		expect(createChanges[0].valueChangedTo).toEqual('Super Mario1');

		await UPDATE(RootEntity, '01234567-89ab-cdef-0123-456789dcbafe').with({
			info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f44f435'
		});

		let updateChanges = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.RootEntity',
			attribute: 'info',
			modification: 'update'
		});
		expect(updateChanges.length).toEqual(1);
		expect(updateChanges[0].valueChangedFrom).toEqual('Super Mario1');
		expect(updateChanges[0].valueChangedTo).toEqual('Super Mario3');
	});

	// REVISIT: rootEntityKey and rootObjectID are null for composition of one node
	it('10.7 Composition of one node deep created by service API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		const { BookStores } = adminService.entities;

		const bookStoreData = {
			ID: '843b3681-8b32-4d30-82dc-937cdbc68b3a',
			name: 'test bookstore name',
			registry: {
				ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
				code: 'San Francisco-2',
				validOn: '2022-01-01'
			}
		};

		// CAP currently support run queries on the draft-enabled entity on application service, so we can re-enable it. (details in CAP/Issue#16292)
		await adminService.run(INSERT.into(BookStores).entries(bookStoreData));

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStoreRegistry',
			attribute: 'validOn'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual(bookStoreData.registry.ID);
		expect(changes[0].objectID).toEqual('San Francisco-2, 2022-01-01');
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('2022-01-01');
		expect(changes[0].rootEntityKey).toEqual(bookStoreData.ID);
		expect(changes[0].rootObjectID).toEqual('test bookstore name');
	});

	// REVISIT: rootEntityKey and rootObjectID are null for composition of one node
	it('10.8 Composition of one node deep updated by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		//cds.services.AdminService.entities.BookStoreRegistry['@changelog'] = [{ '=': 'code' }, { '=': 'validOn' }];
		const { BookStores } = adminService.entities;

		await UPDATE(BookStores)
			.where({ ID: '64625905-c234-4d0d-9bc1-283ee8946770' })
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

		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual('12ed5ac2-d45b-11ed-afa1-0242ac120001');
		expect(changes[0].objectID).toEqual('Paris-1, 2022-01-01');
		expect(changes[0].modification).toEqual('update');
		expect(changes[0].valueChangedFrom).toEqual('2012-01-01');
		expect(changes[0].valueChangedTo).toEqual('2022-01-01');
		expect(changes[0].rootEntityKey).toEqual('64625905-c234-4d0d-9bc1-283ee8946770');
		expect(changes[0].rootObjectID).toEqual('Shakespeare and Company');
		cds.services.AdminService.entities.BookStoreRegistry['@changelog'] = [{ '=': 'code' }];
	});

	// REVISIT: rootEntityKey and rootObjectID are null for composition of one node
	it('10.9 Child entity deep delete by QL API  - should log changes on root entity (ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		const { BookStores } = adminService.entities;

		// Registry ID of BookStore ID '64625905-c234-4d0d-9bc1-283ee8946770' is '12ed5ac2-d45b-11ed-afa1-0242ac120001'
		await UPDATE(BookStores).where({ ID: '64625905-c234-4d0d-9bc1-283ee8946770' }).with({
			registry: null,
			registry_ID: null
		});

		const changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStoreRegistry',
			attribute: 'validOn'
		});

		expect(changes.length).toEqual(1);
		expect(changes[0].entityKey).toEqual('12ed5ac2-d45b-11ed-afa1-0242ac120001');
		expect(changes[0].objectID).toEqual('Paris-1, 2012-01-01');
		expect(changes[0].modification).toEqual('delete');
		expect(changes[0].rootObjectID).toEqual('Shakespeare and Company');
		expect(changes[0].valueChangedFrom).toEqual('2012-01-01');
		expect(changes[0].valueChangedTo).toEqual(null);
	});

	// RREVISIT: access this information via session_context?
	// Otherwise, create table to store info and access via trigger too
	it.skip(`11.1 "disableUpdateTracking" setting`, async () => {
		cds.env.requires['change-tracking'].disableUpdateTracking = true;
		const { BookStores } = adminService.entities;

		await UPDATE(BookStores).where({ ID: '64625905-c234-4d0d-9bc1-283ee8946770' }).with({ name: 'New name' });

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name',
			modification: 'update'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableUpdateTracking = false;
		await UPDATE(BookStores).where({ ID: '64625905-c234-4d0d-9bc1-283ee8946770' }).with({ name: 'Another name' });

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name',
			modification: 'update'
		});
		expect(changes.length).toEqual(1);
	});

	it.skip(`11.2 "disableCreateTracking" setting`, async () => {
		cds.env.requires['change-tracking'].disableCreateTracking = true;
		await INSERT.into(adminService.entities.BookStores).entries({
			ID: '9d703c23-54a8-4eff-81c1-cdce6b6587c4',
			name: 'new name'
		});

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name',
			modification: 'create'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableCreateTracking = false;
		await INSERT.into(adminService.entities.BookStores).entries({
			ID: '04e93234-a5cb-4bfb-89b3-f242ddfaa4ad',
			name: 'another name'
		});

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.BookStores',
			attribute: 'name',
			modification: 'create'
		});
		expect(changes.length).toEqual(1);
	});

	it.skip(`11.3 "disableDeleteTracking" setting`, async () => {
		cds.env.requires['change-tracking'].disableDeleteTracking = true;
		await DELETE.from(adminService.entities.Level3Entity).where({ ID: '12ed5dd8-d45b-11ed-afa1-0242ac654321' });

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level3Entity',
			attribute: 'title',
			modification: 'delete'
		});
		expect(changes.length).toEqual(0);

		cds.env.requires['change-tracking'].disableDeleteTracking = false;
		await DELETE.from(adminService.entities.Level2Entity).where({ ID: 'dd1fdd7d-da2a-4600-940b-0baf2946c4ff' });

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level2Entity',
			attribute: 'title',
			modification: 'delete'
		});
		expect(changes.length).toEqual(1);
	});

	it('Do not change track personal data', async () => {
		const { Customers } = adminService.entities;

		const allCustomers = await SELECT.from(Customers);
		await UPDATE(Customers).where({ ID: allCustomers[0].ID }).with({
			name: 'John Doe'
		});

		const changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Customers'
		});

		expect(changes.length).toEqual(0);
	});

	// REVISIT: additional changelogs are created for order??? currently 18 changes instead of 12
	// also changes for attribute 'order' in Order.Items are created, why?
	it('When creating multiple root records, change tracking for each entity should also be generated', async () => {
		const { Order } = adminService.entities;

		cds.env.requires['change-tracking'].preserveDeletes = true;
		// cds.services.AdminService.entities.Order.elements.netAmount['@changelog'] = true;
		// cds.services.AdminService.entities.Order.elements.isUsed['@changelog'] = true;

		const ordersData = [
			{
				ID: 'fa4d0140-efdd-4c32-aafd-efb7f1d0c8e1',
				isUsed: false,
				netAmount: 0,
				orderItems: [
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a0d1a',
						quantity: 10
					},
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a1c2b',
						quantity: 12
					}
				]
			},
			{
				ID: 'ec365b25-b346-4444-8f03-8f5b7d94f040',
				isUsed: true,
				netAmount: 10,
				orderItems: [
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a2c2a',
						quantity: 10
					},
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a2b3b',
						quantity: 12
					}
				]
			},
			{
				ID: 'ab9e5510-a60b-4dfc-b026-161c5c2d4056',
				isUsed: false,
				netAmount: 20,
				orderItems: [
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a2c1a',
						quantity: 10
					},
					{
						ID: 'f35b2d4c-9b21-4b9a-9b3c-ca1ad32a4c1b',
						quantity: 12
					}
				]
			}
		];

		await INSERT.into(Order).entries(ordersData);
		let changes = await adminService.run(SELECT.from(ChangeView));

		expect(changes.length).toEqual(12);

		expect(changes.some((c) => c.modification !== 'create')).toEqual(false);

		let changesOrder1 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: 'fa4d0140-efdd-4c32-aafd-efb7f1d0c8e1' }));

		const change1 = changesOrder1.find((change) => change.attribute === 'netAmount');
		expect(change1.entity).toEqual('sap.capire.bookshop.Order');
		expect(change1.valueChangedFrom).toEqual(null);
		expect(Number(change1.valueChangedTo)).toEqual(0);

		const change2 = changesOrder1.find((change) => change.attribute === 'isUsed');
		expect(change2.entity).toEqual('sap.capire.bookshop.Order');
		expect(change2.valueChangedFrom).toEqual(null);
		expect(change2.valueChangedTo).toEqual('false');

		const quantityChanges1 = changesOrder1.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
		expect(quantityChanges1[0].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges1[0].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges1[0].valueChangedTo)).toEqual(10);

		expect(quantityChanges1[1].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges1[1].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges1[1].valueChangedTo)).toEqual(12);

		let changesOrder2 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: 'ec365b25-b346-4444-8f03-8f5b7d94f040' }));

		const change3 = changesOrder2.find((change) => change.attribute === 'netAmount');
		expect(change3.entity).toEqual('sap.capire.bookshop.Order');
		expect(change3.valueChangedFrom).toEqual(null);
		expect(Number(change3.valueChangedTo)).toEqual(10);

		const change4 = changesOrder2.find((change) => change.attribute === 'isUsed');
		expect(change4.entity).toEqual('sap.capire.bookshop.Order');
		expect(change4.valueChangedFrom).toEqual(null);
		expect(change4.valueChangedTo).toEqual('true');

		const quantityChanges2 = changesOrder2.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
		expect(quantityChanges2[0].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges2[0].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges2[0].valueChangedTo)).toEqual(10);

		expect(quantityChanges2[1].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges2[1].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges2[1].valueChangedTo)).toEqual(12);

		let changesOrder3 = await adminService.run(SELECT.from(ChangeView).where({ entityKey: 'ab9e5510-a60b-4dfc-b026-161c5c2d4056' }));

		const change5 = changesOrder3.find((change) => change.attribute === 'netAmount');
		expect(change5.entity).toEqual('sap.capire.bookshop.Order');
		expect(change5.valueChangedFrom).toEqual(null);
		expect(Number(change5.valueChangedTo)).toEqual(20);

		const change6 = changesOrder3.find((change) => change.attribute === 'isUsed');
		expect(change6.entity).toEqual('sap.capire.bookshop.Order');
		expect(change6.valueChangedFrom).toEqual(null);
		expect(change6.valueChangedTo).toEqual('false');

		const quantityChanges3 = changesOrder3.filter((change) => change.attribute === 'quantity').sort((a, b) => a.valueChangedTo - b.valueChangedTo);
		expect(quantityChanges3[0].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges3[0].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges3[0].valueChangedTo)).toEqual(10);

		expect(quantityChanges3[1].entity).toEqual('sap.capire.bookshop.OrderItem');
		expect(quantityChanges3[1].valueChangedFrom).toEqual(null);
		expect(Number(quantityChanges3[1].valueChangedTo)).toEqual(12);

		cds.env.requires['change-tracking'].preserveDeletes = false;
		delete cds.services.AdminService.entities.Order.elements.netAmount['@changelog'];
		delete cds.services.AdminService.entities.Order.elements.isUsed['@changelog'];
	});

	// REVISIT: objectID not correctly set for Level 3 (parent.parent.ID)
	it('Special Character Handling in service-api - issue#187', async () => {
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
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('RootSample title3');
		expect(changes[0].entityKey).toEqual('/three');
		expect(changes[0].rootEntityKey).toEqual(null);
		expect(changes[0].objectID).toEqual('/three, RootSample title3');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level1Sample',
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level1Sample title3');
		expect(changes[0].entityKey).toEqual('/level1three');
		expect(changes[0].rootEntityKey).toEqual('/three');
		expect(changes[0].objectID).toEqual('/level1three, Level1Sample title3, /three');
		expect(changes[0].rootObjectID).toEqual('/three, RootSample title3');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level2Sample',
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual(null);
		expect(changes[0].valueChangedTo).toEqual('Level2Sample title3');
		expect(changes[0].entityKey).toEqual('/level2three');
		expect(changes[0].rootEntityKey).toEqual('/level1three');
		expect(changes[0].objectID).toEqual('/level2three, Level2Sample title3, /three');
	});

	it.skip('Leave localization logic early if entity is not part of the model', async () => {
		const { Changes } = cds.entities('sap.changelog');
		const { Volumns } = cds.entities('VolumnsService');
		const VolumnsSrv = await cds.connect.to('VolumnsService');
		await VolumnsSrv.run(UPDATE.entity(Volumns).where({ ID: 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf' }).set({ title: 'new title' }));
		const {
			data: { value: changes }
		} = await GET('/odata/v4/volumns/Volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf)/changes');
		expect(changes.length).toEqual(1);
		await UPDATE(Changes).where({ ID: changes[0].ID }).set({ serviceEntity: 'Volumns' });
		const {
			data: { value: changes2 }
		} = await GET('/odata/v4/volumns/Volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf)/changes');
		expect(changes2.length).toEqual(1);
		// expect(changes2[0].serviceEntity).toEqual('Volumns');
		expect(log.output.length).toBeGreaterThan(0);
		expect(log.output).toMatch(/Cannot localize the attribute/);
	});

	it.skip('Leave localization logic early if attribute value is not part of the model', async () => {
		const { Changes } = cds.entities('sap.changelog');
		const { Volumns } = cds.entities('VolumnsService');
		const VolumnsSrv = await cds.connect.to('VolumnsService');
		await VolumnsSrv.run(UPDATE.entity(Volumns).where({ ID: 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf' }).set({ title: 'new title' }));
		const {
			data: { value: changes }
		} = await GET('/odata/v4/volumns/Volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf)/changes');
		expect(changes.length).toEqual(1);
		await UPDATE(Changes).where({ ID: changes[0].ID }).set({ attribute: 'abc' });
		const {
			data: { value: changes2 }
		} = await GET('/odata/v4/volumns/Volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf)/changes');
		expect(changes2.length).toEqual(1);
		expect(changes2[0].attribute).toEqual('abc');
		expect(log.output.length).toBeGreaterThan(0);
		expect(log.output).toMatch(/Cannot localize the attribute/);
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
