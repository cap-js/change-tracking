const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { data, POST, PATCH, DELETE } = cds.test(bookshop);
const { RequestSend } = require('../utils/api');

let adminService = null;
let draftTestService = null;
let ChangeView = null;
let DraftTestChangeView = null;
let db = null;
let ChangeEntity = null;
let utils = null;
let draftUtils = null;
let ChangeLog = null;

describe('Draft-Enabled Change Tracking', () => {
	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		draftTestService = await cds.connect.to('DraftTestService');
		ChangeView = adminService.entities.ChangeView;
		DraftTestChangeView = draftTestService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
		DraftTestChangeView['@cds.autoexposed'] = false;
		db = await cds.connect.to('db');
		ChangeEntity = db.model.definitions['sap.changelog.Changes'];
		ChangeLog = db.model.definitions['sap.changelog.ChangeLog'];
		utils = new RequestSend(POST);
		draftUtils = new RequestSend(POST);
	});

	beforeEach(async () => {
		await data.reset();
	});

	describe('Preserve Deletes', () => {
		it('should retain all changelogs after root entity deletion when preserveDeletes is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;

			const newRootId = cds.utils.uuid();
			const newLevel1Id = cds.utils.uuid();
			const newLevel2Id = cds.utils.uuid();
			const newLevel3Id = cds.utils.uuid();

			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: newRootId,
				name: 'New name for RootEntity',
				child: [
					{
						ID: newLevel1Id,
						title: 'New name for Level1Entity',
						child: [
							{
								ID: newLevel2Id,
								title: 'New name for Level2Entity',
								child: [
									{
										ID: newLevel3Id,
										title: 'New name for Level3Entity'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', newRootId, 'AdminService', createAction, true);
			const beforeChanges = await adminService.run(SELECT.from(ChangeView));
			expect(beforeChanges.length > 0).toBeTruthy();

			await DELETE(`/odata/v4/admin/RootEntity(ID=${newRootId},IsActiveEntity=true)`);

			const afterChanges = await adminService.run(SELECT.from(ChangeView));

			const changelogCreated = afterChanges.filter((ele) => ele.modification === 'Create');
			const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'Delete');

			const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'parentKey', 'serviceEntityPath', 'valueDataType', 'objectID', 'parentObjectID', 'entityKey'];

			let commonItems = changelogCreated.filter((beforeItem) => {
				return changelogDeleted.some((afterItem) => {
					return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
				});
			});
			expect(commonItems.length > 0).toBeTruthy();
			expect(afterChanges).toHaveLength(14);
		});
	});

	describe('Zero and False Values', () => {
		it('should generate changelog for numeric zero and boolean false on create', async () => {
			const bookStoreId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
			const newBookId = cds.utils.uuid();

			let action = POST.bind({}, `/odata/v4/draft-test/BookStoresBasic(ID=${bookStoreId},IsActiveEntity=false)/books`, {
				ID: newBookId,
				price: 0,
				isUsed: false
			});
			await draftUtils.apiAction('draft-test', 'BookStoresBasic', bookStoreId, 'DraftTestService', action);
			let changes = await draftTestService.run(SELECT.from(DraftTestChangeView));
			expect(changes).toHaveLength(2);

			const priceChange = changes.find((c) => c.attribute === 'Price');
			expect(priceChange).toMatchObject({
				entityKey: bookStoreId,
				modification: 'Create',
				entity: 'Books With Price Tracking',
				valueChangedFrom: ''
			});
			expect(Number(priceChange.valueChangedTo)).toEqual(0);

			const isUsedChange = changes.find((c) => c.attribute === 'Is Used');
			expect(isUsedChange).toMatchObject({
				entityKey: bookStoreId,
				modification: 'Create',
				entity: 'Books With Price Tracking',
				valueChangedFrom: '',
				valueChangedTo: 'false'
			});
		});

		it('should generate changelog for numeric zero and boolean false on delete', async () => {
			const bookStoreId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
			const newBookId = cds.utils.uuid();

			let action = POST.bind({}, `/odata/v4/draft-test/BookStoresBasic(ID=${bookStoreId},IsActiveEntity=false)/books`, {
				ID: newBookId,
				price: 0,
				isUsed: false
			});
			await draftUtils.apiAction('draft-test', 'BookStoresBasic', bookStoreId, 'DraftTestService', action);

			action = DELETE.bind({}, `/odata/v4/draft-test/BooksWithPriceTracking(ID=${newBookId},IsActiveEntity=false)`);
			await draftUtils.apiAction('draft-test', 'BookStoresBasic', bookStoreId, 'DraftTestService', action);
			const changes = await draftTestService.run(
				SELECT.from(DraftTestChangeView).where({
					modification: 'delete'
				})
			);
			expect(changes).toHaveLength(2);

			const priceChange = changes.find((c) => c.attribute === 'Price');
			expect(priceChange).toMatchObject({
				entityKey: bookStoreId,
				modification: 'Delete',
				entity: 'Books With Price Tracking',
				valueChangedTo: ''
			});
			expect(Number(priceChange.valueChangedFrom)).toEqual(0);

			const isUsedChange = changes.find((c) => c.attribute === 'Is Used');
			expect(isUsedChange).toMatchObject({
				entityKey: bookStoreId,
				modification: 'Delete',
				entity: 'Books With Price Tracking',
				valueChangedFrom: 'false',
				valueChangedTo: ''
			});
		});
	});

	describe('Child Entity Operations', () => {
		describe('Create', () => {
			it('should log basic data type changes on child entity creation', async () => {
				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: cds.utils.uuid(),
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0,
					isUsed: true
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const bookChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'books'
					})
				);
				expect(bookChanges).toHaveLength(1);
				expect(bookChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Books',
					modification: 'Create',
					objectID: 'Shakespeare and Company',
					entity: 'Book Store',
					valueChangedFrom: '',
					valueChangedTo: 'test title'
				});

				const titleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);
				expect(titleChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Title',
					modification: 'Create',
					objectID: 'test title, Emily, Brontë',
					entity: 'Book',
					valueChangedFrom: '',
					valueChangedTo: 'test title'
				});

				const authorChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'author'
					})
				);
				expect(authorChanges).toHaveLength(1);
				expect(authorChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Author',
					modification: 'Create',
					objectID: 'test title, Emily, Brontë',
					entity: 'Book',
					valueChangedFrom: '',
					valueChangedTo: 'Emily, Brontë'
				});

				const isUsedChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'isUsed'
					})
				);
				expect(isUsedChanges).toHaveLength(1);
				expect(isUsedChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'isUsed',
					modification: 'Create',
					objectID: 'test title, Emily, Brontë',
					entity: 'Book',
					valueChangedFrom: '',
					valueChangedTo: 'true'
				});
			});

			it('should log unmanaged entity creation', async () => {
				const newClassId = cds.utils.uuid();
				const unmanagedAction = POST.bind({}, `/odata/v4/admin/Schools(ID=5ab2a87b-3a56-4d97-a697-7af72333c123,IsActiveEntity=false)/classes`, {
					ID: newClassId,
					name: 'Biology 101',
					teacher: 'Mr. Smith',
					up__ID: '9d703c23-54a8-4eff-81c1-cdce6b0528c4'
				});
				await utils.apiAction('admin', 'Schools', '5ab2a87b-3a56-4d97-a697-7af72333c123', 'AdminService', unmanagedAction);

				const schoolChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Schools',
						attribute: 'classes'
					})
				);
				expect(schoolChanges).toHaveLength(1);
				expect(schoolChanges[0]).toMatchObject({
					entityKey: '5ab2a87b-3a56-4d97-a697-7af72333c123',
					attribute: 'classes',
					modification: 'Create',
					valueChangedFrom: '',
					valueChangedTo: 'Biology 101, Mr. Smith'
				});
			});
		});

		describe('Update', () => {
			it('should log basic data type changes on child entity update', async () => {
				const bookStoreId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
				const existingBookId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

				const action = PATCH.bind({}, `/odata/v4/draft-test/BooksWithPriceTracking(ID=${existingBookId},IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e',
					isUsed: false,
					price: 2500
				});
				await draftUtils.apiAction('draft-test', 'BookStoresBasic', bookStoreId, 'DraftTestService', action);

				const bookChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView).where({
						entity: 'sap.capire.bookshop.test.draft.BookStoresBasic',
						attribute: 'books'
					})
				);
				expect(bookChanges).toHaveLength(1);
				expect(bookChanges[0]).toMatchObject({
					entityKey: bookStoreId,
					attribute: 'Books',
					modification: 'Update',
					objectID: 'Draft Test Bookstore',
					entity: 'Book Stores Basic',
					valueChangedFrom: 'new title',
					valueChangedTo: 'new title'
				});

				const titleChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView).where({
						entity: 'sap.capire.bookshop.test.draft.BooksWithPriceTracking',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);
				expect(titleChanges[0]).toMatchObject({
					entityKey: bookStoreId,
					attribute: 'Title',
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Books With Price Tracking',
					valueChangedFrom: 'Test Book With Price',
					valueChangedTo: 'new title'
				});

				const authorChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView).where({
						entity: 'sap.capire.bookshop.test.draft.BooksWithPriceTracking',
						attribute: 'author'
					})
				);
				expect(authorChanges).toHaveLength(1);
				expect(authorChanges[0]).toMatchObject({
					entityKey: bookStoreId,
					attribute: 'Author',
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Books With Price Tracking',
					valueChangedFrom: 'Emily, Brontë',
					valueChangedTo: 'Charlotte, Brontë'
				});

				const isUsedChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView).where({
						entity: 'sap.capire.bookshop.test.draft.BooksWithPriceTracking',
						attribute: 'isUsed'
					})
				);
				expect(isUsedChanges).toHaveLength(1);
				expect(isUsedChanges[0]).toMatchObject({
					entityKey: bookStoreId,
					attribute: 'Is Used',
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Books With Price Tracking',
					valueChangedFrom: 'true',
					valueChangedTo: 'false'
				});

				// The current price is 2500.0000, and update operation via OData service is price: 2500. In this case, a changelog should not be generated.
				const priceChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView).where({
						entity: 'sap.capire.bookshop.test.draft.BooksWithPriceTracking',
						attribute: 'price'
					})
				);
				expect(priceChanges).toHaveLength(0);
			});

			it('should log unmanaged entity update', async () => {
				const newClassId = cds.utils.uuid();
				const unmanagedAction = POST.bind({}, `/odata/v4/admin/Schools(ID=5ab2a87b-3a56-4d97-a697-7af72333c123,IsActiveEntity=false)/classes`, {
					ID: newClassId,
					name: 'Biology 101',
					teacher: 'Mr. Smith',
					up__ID: '9d703c23-54a8-4eff-81c1-cdce6b0528c4'
				});
				await utils.apiAction('admin', 'Schools', '5ab2a87b-3a56-4d97-a697-7af72333c123', 'AdminService', unmanagedAction);

				const schoolChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Schools',
						attribute: 'classes'
					})
				);
				expect(schoolChanges).toHaveLength(1);
				expect(schoolChanges[0]).toMatchObject({
					entityKey: '5ab2a87b-3a56-4d97-a697-7af72333c123',
					attribute: 'classes',
					modification: 'Create',
					valueChangedFrom: '',
					valueChangedTo: 'Biology 101, Mr. Smith'
				});
			});

			it('should log object type as object ID when objectID annotation is missing', async () => {
				delete cds.services.AdminService.entities.Books['@changelog'];
				delete cds.services.AdminService.entities.BookStores['@changelog'];
				delete cds.db.entities.Books['@changelog'];
				delete cds.db.entities.BookStores['@changelog'];

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const changes = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(changes).toHaveLength(1);
				expect(changes[0].objectID).toEqual('Book');
				expect(changes[0].parentObjectID).toEqual('Book Store');

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.services.AdminService.entities.BookStores['@changelog'] = [{ '=': 'name' }];
				cds.db.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.db.entities.BookStores['@changelog'] = [{ '=': 'name' }];
			});
		});

		describe('Delete', () => {
			it('should log basic data type changes on child entity deletion', async () => {
				const action = DELETE.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`);
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const bookChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'books'
					})
				);
				expect(bookChanges).toHaveLength(1);
				expect(bookChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Books',
					modification: 'Delete',
					objectID: 'Shakespeare and Company',
					entity: 'Book Store',
					valueChangedFrom: 'Wuthering Heights',
					valueChangedTo: ''
				});

				const bookTitleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(bookTitleChanges).toHaveLength(1);
				expect(bookTitleChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Title',
					modification: 'Delete',
					objectID: 'Wuthering Heights, Emily, Brontë',
					entity: 'Book',
					valueChangedFrom: 'Wuthering Heights',
					valueChangedTo: ''
				});

				const bookAuthorChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'author'
					})
				);
				expect(bookAuthorChanges).toHaveLength(1);
				expect(bookAuthorChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Author',
					modification: 'Delete',
					objectID: 'Wuthering Heights, Emily, Brontë',
					entity: 'Book',
					valueChangedFrom: 'Emily, Brontë',
					valueChangedTo: ''
				});

				const volumnTitleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Volumns',
						attribute: 'title'
					})
				);
				expect(volumnTitleChanges).toHaveLength(1);
				expect(volumnTitleChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Title',
					modification: 'Delete',
					objectID: 'Wuthering Heights I',
					entity: 'Volumn',
					valueChangedFrom: 'Wuthering Heights I',
					valueChangedTo: ''
				});
			});

			it('should log unmanaged entity deletion', async () => {
				const unmanagedAction = DELETE.bind({}, `/odata/v4/admin/Schools_classes(up__ID=5ab2a87b-3a56-4d97-a697-7af72333c123,ID=9d703c23-54a8-4eff-81c1-cdec5a0422c3,IsActiveEntity=false)`);
				await utils.apiAction('admin', 'Schools', '5ab2a87b-3a56-4d97-a697-7af72333c123', 'AdminService', unmanagedAction);

				const schoolChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Schools',
						attribute: 'classes'
					})
				);
				expect(schoolChanges).toHaveLength(1);
				expect(schoolChanges[0]).toMatchObject({
					entityKey: '5ab2a87b-3a56-4d97-a697-7af72333c123',
					attribute: 'classes',
					modification: 'Delete',
					valueChangedFrom: 'Physics 500, Mrs. Johnson',
					valueChangedTo: ''
				});
			});
		});
	});

	describe('Composition of Inline Entity', () => {
		it('should log changes for composition of inline entity update', async () => {
			const action = PATCH.bind({}, `/odata/v4/admin/BookStores_bookInventory(up__ID=64625905-c234-4d0d-9bc1-283ee8946770,ID=3ccf474c-3881-44b7-99fb-59a2a4668418,IsActiveEntity=false)`, {
				title: 'update title'
			});

			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			const changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				attribute: 'title',
				modification: 'Update',
				valueChangedFrom: 'Eleonora',
				valueChangedTo: 'update title',
				parentKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				keys: 'ID=3ccf474c-3881-44b7-99fb-59a2a4668418'
			});
		});
	});

	describe('Object ID Annotations', () => {
		describe('Multiple Native and Association Attributes', () => {
			it('should use multiple native and association attributes as object ID', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'].push({ '=': 'stock' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' });

				const newBookId = cds.utils.uuid();
				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: newBookId,
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const titleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);
				expect(titleChanges[0].objectID).toEqual('test title, Emily, Brontë, 1, Shakespeare and Company, Paris');

				const authorChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'author'
					})
				);
				expect(authorChanges).toHaveLength(1);
				expect(authorChanges[0].objectID).toEqual('test title, Emily, Brontë, 1, Shakespeare and Company, Paris');

				cds.services.AdminService.entities.Books['@changelog'] = originalChangelog;
			});

			it('should respect object ID sequence on update', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'].push({ '=': 'stock' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' });

				const newBookId = cds.utils.uuid();
				const createAction = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: newBookId,
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', createAction);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' }, { '=': 'stock' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=${newBookId},IsActiveEntity=false)`, {
					title: 'test title 1'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				const updateTitleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title',
						modification: 'update'
					})
				);
				expect(updateTitleChanges).toHaveLength(1);
				expect(updateTitleChanges[0].objectID).toEqual('test title 1, Shakespeare and Company, Paris, 1, Emily, Brontë');

				cds.services.AdminService.entities.Books['@changelog'] = originalChangelog;
			});

			it('should respect object ID sequence on delete', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'].push({ '=': 'stock' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' });

				const newBookId = cds.utils.uuid();
				const createAction = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: newBookId,
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', createAction);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' }, { '=': 'stock' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=${newBookId},IsActiveEntity=false)`, {
					title: 'test title 1'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.name' }, { '=': 'title' }, { '=': 'bookStore.location' }, { '=': 'author.name.firstName' }, { '=': 'stock' }, { '=': 'author.name.lastName' }];

				const actionDE = DELETE.bind({}, `/odata/v4/admin/Books(ID=${newBookId},IsActiveEntity=false)`);
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionDE);

				const deleteTitleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title',
						modification: 'delete'
					})
				);
				expect(deleteTitleChanges).toHaveLength(1);
				expect(deleteTitleChanges[0].objectID).toEqual('Shakespeare and Company, test title 1, Paris, Emily, 1, Brontë');

				cds.services.AdminService.entities.Books['@changelog'] = originalChangelog;
			});
		});

		describe('Multiple Native Attributes', () => {
			it('should use multiple native attributes as object ID', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'price' }, { '=': 'title' }, { '=': 'stock' }];

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e',
					genre_ID: 16
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const titleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);

				const titleChangeParts = titleChanges[0].objectID.split(', ');
				expect(Number(titleChangeParts[0])).toEqual(3000);
				expect(titleChangeParts[1]).toEqual('new title');
				expect(Number(titleChangeParts[2])).toEqual(12);

				cds.services.AdminService.entities.Books['@changelog'] = originalChangelog;
			});
		});

		describe('Multiple Association Attributes', () => {
			it('should use multiple association attributes as object ID', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.location' }, { '=': 'author.name.lastName' }, { '=': 'author.name.firstName' }, { '=': 'bookStore.name' }, { '=': 'genre.ID' }];

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e',
					genre_ID: 16
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const titleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);
				expect(titleChanges[0].objectID).toEqual('Paris, Brontë, Charlotte, Shakespeare and Company, 16');

				cds.services.AdminService.entities.Books['@changelog'] = originalChangelog;
			});
		});

		describe('Chained Association Attributes', () => {
			it('should use chained association attributes as object ID on create', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
				cds.services.AdminService.entities.BookStores['@changelog'].push({ '=': 'city.name' });

				const newBookStoreId = cds.utils.uuid();
				const createBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: newBookStoreId,
					name: 'new name'
				});
				await utils.apiAction('admin', 'BookStores', newBookStoreId, 'AdminService', createBookStoresAction, true);

				const BookStoresChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'name'
					})
				);
				expect(BookStoresChanges).toHaveLength(1);
				expect(BookStoresChanges[0].objectID).toEqual('new name');

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

			it('should use chained association attributes as object ID on update', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
				cds.services.AdminService.entities.BookStores['@changelog'].push({ '=': 'city.name' });

				const newBookStoreId = cds.utils.uuid();
				const createBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: newBookStoreId,
					name: 'new name'
				});
				await utils.apiAction('admin', 'BookStores', newBookStoreId, 'AdminService', createBookStoresAction, true);

				const updateBookStoresAction = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=${newBookStoreId},IsActiveEntity=false)`, {
					name: 'name update'
				});
				await utils.apiAction('admin', 'BookStores', newBookStoreId, 'AdminService', updateBookStoresAction);

				const updateBookStoresChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'name',
						modification: 'update'
					})
				);
				expect(updateBookStoresChanges).toHaveLength(1);
				expect(updateBookStoresChanges[0].objectID).toEqual('name update');

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

			it('should use deeply chained association attributes as object ID', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
				delete cds.services.AdminService.entities.BookStores['@changelog'];

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.lifecycleStatus.name' }, { '=': 'bookStore.location' }, { '=': 'bookStore.city.name' }, { '=': 'bookStore.city.country.countryName.code' }];

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const titleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title'
					})
				);
				expect(titleChanges).toHaveLength(1);
				expect(titleChanges[0].objectID).toEqual('In Preparation, Paris, Paris, FR');

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

			it('should use chained association attributes as object ID on delete', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
				delete cds.services.AdminService.entities.BookStores['@changelog'];

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.lifecycleStatus.name' }, { '=': 'bookStore.location' }, { '=': 'bookStore.city.name' }, { '=': 'bookStore.city.country.countryName.code' }];

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'bookStore.lifecycleStatus.name' }, { '=': 'bookStore.city.country.countryName.name' }];

				const deleteAction = DELETE.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`);
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', deleteAction);

				const deleteTitleChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title',
						modification: 'delete'
					})
				);
				expect(deleteTitleChanges).toHaveLength(1);
				expect(deleteTitleChanges[0].objectID).toEqual('new title, In Preparation, France');

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

			it('should capture chained association object ID when creating root and child simultaneously', async () => {
				const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.city.country.countryName.code' }];

				const newBookStoreId = cds.utils.uuid();
				const createBooksAndBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: newBookStoreId,
					city_ID: '60b4c55d-ec87-4edc-84cb-2e4ecd60de48',
					books: [
						{
							ID: cds.utils.uuid(),
							title: 'New title'
						}
					]
				});

				await utils.apiAction('admin', 'BookStores', newBookStoreId, 'AdminService', createBooksAndBookStoresAction, true);

				const createBooksAndBookStoresChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'title',
						modification: 'create'
					})
				);
				expect(createBooksAndBookStoresChanges).toHaveLength(1);
				expect(createBooksAndBookStoresChanges[0].objectID).toEqual('USA');

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

		it('should capture object ID when parent and child nodes are created simultaneously', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			const rootId = cds.utils.uuid();

			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: rootId,
				name: 'New name for RootEntity',
				child: [
					{
						ID: cds.utils.uuid(),
						title: 'New name for Level1Entity',
						child: [
							{
								ID: cds.utils.uuid(),
								title: 'New name for Level2Entity',
								child: [
									{
										ID: cds.utils.uuid(),
										title: 'New name for Level3Entity'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', createAction, true);

				const createEntityChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Level3Entity',
						modification: 'create'
					})
				);
				expect(createEntityChanges).toHaveLength(1);
				expect(createEntityChanges[0].objectID).toEqual('In Preparation');

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

		it('should capture object ID when parent and child nodes are updated simultaneously', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			const rootId = cds.utils.uuid();
			const level1Id = cds.utils.uuid();
			const level2Id = cds.utils.uuid();
			const level3Id = cds.utils.uuid();

			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: rootId,
				name: 'New name for RootEntity',
				child: [
					{
						ID: level1Id,
						title: 'New name for Level1Entity',
						child: [
							{
								ID: level2Id,
								title: 'New name for Level2Entity',
								child: [
									{
										ID: level3Id,
										title: 'New name for Level3Entity'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', createAction, true);

			const updateAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=${rootId},IsActiveEntity=false)`, {
				lifecycleStatus_code: 'AC',
				child: [
					{
						ID: level1Id,
						child: [
							{
								ID: level2Id,
								child: [
									{
										ID: level3Id,
										title: 'Level3Entity title changed'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', updateAction);

				const updateEntityChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Level3Entity',
						attribute: 'title',
						modification: 'update'
					})
				);
				expect(updateEntityChanges).toHaveLength(1);
				expect(updateEntityChanges[0].objectID).toEqual('Open');

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

		it('should capture object ID when parent update and child deletion occur simultaneously', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			const rootId = cds.utils.uuid();
			const level1Id = cds.utils.uuid();
			const level2Id = cds.utils.uuid();
			const level3Id = cds.utils.uuid();

			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: rootId,
				name: 'New name for RootEntity',
				child: [
					{
						ID: level1Id,
						title: 'New name for Level1Entity',
						child: [
							{
								ID: level2Id,
								title: 'New name for Level2Entity',
								child: [
									{
										ID: level3Id,
										title: 'New name for Level3Entity'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', createAction, true);

			const updateAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=${rootId},IsActiveEntity=false)`, {
				lifecycleStatus_code: 'AC',
				child: [
					{
						ID: level1Id,
						child: [
							{
								ID: level2Id,
								child: [
									{
										ID: level3Id,
										title: 'Level3Entity title changed'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', updateAction);

			const deleteEntityAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=${rootId},IsActiveEntity=false)`, {
				lifecycleStatus_code: 'CL',
				child: []
			});
			await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', deleteEntityAction);

				const deleteEntityChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Level3Entity',
						modification: 'delete'
					})
				);
				expect(deleteEntityChanges).toHaveLength(1);
				expect(deleteEntityChanges[0].objectID).toEqual('Closed');

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});
		});
	});

	describe('Value Data Type', () => {
		describe('Association Attributes', () => {
		it('should record data type of association attributes as displayed value on create', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books.elements.author_ID['@changelog']));
			cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.dateOfBirth' }, { '=': 'author.name.lastName' }];
			cds.services.AdminService.entities.Books.elements.author['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.dateOfBirth' }, { '=': 'author.name.lastName' }];

			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: cds.utils.uuid(),
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				title: 'test title'
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const authorChangesInDb = await SELECT.from(ChangeEntity).where({
					entity: 'sap.capire.bookshop.Books',
					attribute: 'author',
					modification: 'create'
				});
				expect(authorChangesInDb).toHaveLength(1);
				expect(authorChangesInDb[0]).toMatchObject({
					valueChangedFrom: '',
					valueChangedTo: 'Emily, 1818-07-30, Brontë',
					valueDataType: 'cds.String, cds.Date, cds.String'
				});

				cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = originalChangelog;
				cds.services.AdminService.entities.Books.elements.author['@changelog'] = originalChangelog;
			});

		it('should record data type of association attributes as displayed value on update', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.Books.elements.author_ID['@changelog']));
			cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.dateOfBirth' }, { '=': 'author.name.lastName' }];
			cds.services.AdminService.entities.Books.elements.author['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.dateOfBirth' }, { '=': 'author.name.lastName' }];
			const bookId = cds.utils.uuid();

			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: bookId,
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				title: 'test title'
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
			cds.services.AdminService.entities.Books.elements.author['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

			const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=${bookId},IsActiveEntity=false)`, {
				author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e'
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				const authorUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
					entity: 'sap.capire.bookshop.Books',
					attribute: 'author',
					modification: 'update'
				});
				expect(authorUpdateChangesInDb).toHaveLength(1);
				expect(authorUpdateChangesInDb[0]).toMatchObject({
					valueChangedFrom: 'Emily, Brontë',
					valueChangedTo: 'Charlotte, Brontë',
					valueDataType: 'cds.String, cds.String'
				});

				cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = originalChangelog;
				cds.services.AdminService.entities.Books.elements.author['@changelog'] = originalChangelog;
			});
		});

		describe('Composition Attributes', () => {
		it('should record data type of composition attributes as displayed value on create', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores.elements.books['@changelog']));
			cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.title' }, { '=': 'books.stock' }, { '=': 'books.price' }];

			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: cds.utils.uuid(),
				title: 'test title',
				stock: 2,
				price: 2.3
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const booksChangesInDb = await SELECT.from(ChangeEntity).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'books',
					modification: 'create'
				});
				expect(booksChangesInDb).toHaveLength(1);

				const bookChangesInDb = booksChangesInDb[0];
				expect(bookChangesInDb.valueChangedFrom).toEqual('');
				const titleSegments = bookChangesInDb.valueChangedTo.split(', ');
				expect(titleSegments[0]).toEqual('test title');
				expect(Number(titleSegments[1])).toEqual(2);
				expect(Number(titleSegments[2])).toEqual(2.3);
				expect(bookChangesInDb.valueDataType).toEqual('cds.String, cds.Integer, cds.Decimal');

				cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = originalChangelog;
			});

		it('should record data type of composition attributes as displayed value on update', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores.elements.books['@changelog']));
			cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.title' }, { '=': 'books.stock' }, { '=': 'books.price' }];
			const bookId = cds.utils.uuid();

			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: bookId,
				title: 'test title',
				stock: 2,
				price: 2.3
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.stock' }, { '=': 'books.title' }, { '=': 'books.price' }];

			const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=${bookId},IsActiveEntity=false)`, {
				stock: 3
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				const booksUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'books',
					modification: 'update'
				});
				expect(booksUpdateChangesInDb).toHaveLength(1);

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

				cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = originalChangelog;
			});
		});
	});

	describe('Code List Annotations', () => {
		describe('Single Attribute', () => {
		it('should log single code list attribute as value on create', async () => {
			const bookStoreId = cds.utils.uuid();
			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: bookStoreId,
				name: 'test name'
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

				const lifecycleStatusChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'lifecycleStatus'
					})
				);
				expect(lifecycleStatusChanges).toHaveLength(1);
				expect(lifecycleStatusChanges[0]).toMatchObject({
					modification: 'Create',
					valueChangedFrom: '',
					valueChangedTo: 'In Preparation'
				});
			});

		it('should log single code list attribute as value on update', async () => {
			const bookStoreId = cds.utils.uuid();
			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: bookStoreId,
				name: 'test name'
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

			const actionPH = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=${bookStoreId},IsActiveEntity=false)`, {
				lifecycleStatus: {
					code: 'CL'
				}
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', actionPH);

				const lifecycleStatusUpdateChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'lifecycleStatus',
						modification: 'update'
					})
				);
				expect(lifecycleStatusUpdateChanges).toHaveLength(1);
				expect(lifecycleStatusUpdateChanges[0]).toMatchObject({
					modification: 'Update',
					valueChangedFrom: 'In Preparation',
					valueChangedTo: 'Closed'
				});
			});
		});

		describe('Multiple Attributes', () => {
		it('should log multiple code list attributes as value on create', async () => {
			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: cds.utils.uuid(),
				bookType: {
					code: 'MAN'
				}
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const bookTypeChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'bookType'
					})
				);
				expect(bookTypeChanges).toHaveLength(1);
				expect(bookTypeChanges[0]).toMatchObject({
					modification: 'Create',
					valueChangedFrom: '',
					valueChangedTo: 'Management, Management Books'
				});
			});

		it('should log multiple code list attributes as value on update', async () => {
			const bookId = cds.utils.uuid();
			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: bookId,
				bookType: {
					code: 'MAN'
				}
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=${bookId},IsActiveEntity=false)`, {
				bookType: {
					code: 'SCI'
				}
			});

			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				const bookTypeUpdateChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'bookType',
						modification: 'update'
					})
				);
				expect(bookTypeUpdateChanges).toHaveLength(1);
				expect(bookTypeUpdateChanges[0]).toMatchObject({
					modification: 'Update',
					valueChangedFrom: 'Management, Management Books',
					valueChangedTo: 'Science, Science Books'
				});
			});
		});

		describe('Code List as Object ID', () => {
		it('should use code list attributes as object ID on create', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			cds.services.AdminService.entities.BookStores['@changelog'] = [{ '=': 'name' }, { '=': 'lifecycleStatus.name' }];
			const bookStoreId = cds.utils.uuid();

			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: bookStoreId,
				name: 'test name'
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

				const lifecycleStatusChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'lifecycleStatus',
						modification: 'create'
					})
				);
				expect(lifecycleStatusChanges).toHaveLength(1);
				expect(lifecycleStatusChanges[0]).toMatchObject({
					modification: 'Create',
					objectID: 'test name, In Preparation'
				});

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});

		it('should use code list attributes as object ID on update', async () => {
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			cds.services.AdminService.entities.BookStores['@changelog'] = [{ '=': 'name' }, { '=': 'lifecycleStatus.name' }];
			const bookStoreId = cds.utils.uuid();

			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: bookStoreId,
				name: 'test name'
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

			cds.services.AdminService.entities.BookStores['@changelog'] = [{ '=': 'lifecycleStatus.name' }, { '=': 'name' }];
			const actionPH = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=${bookStoreId},IsActiveEntity=false)`, {
				lifecycleStatus: {
					code: 'CL'
				},
				name: 'new test name'
			});

			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', actionPH);

				const lifecycleStatusUpdateChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStores',
						attribute: 'lifecycleStatus',
						modification: 'update'
					})
				);
				expect(lifecycleStatusUpdateChanges).toHaveLength(1);
				expect(lifecycleStatusUpdateChanges[0]).toMatchObject({
					modification: 'Update',
					objectID: 'Closed, new test name'
				});

				cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			});
		});
	});

	describe('Chained Association Displayed Value', () => {
	it('should log chained association fields as displayed value on create', async () => {
		const bookStoreId = cds.utils.uuid();
		const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
			ID: bookStoreId,
			city_ID: 'bc21e0d9-a313-4f52-8336-c1be5f66e257'
		});

		await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

			const cityChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'city',
					modification: 'create'
				})
			);
			expect(cityChanges).toHaveLength(1);
			expect(cityChanges[0]).toMatchObject({
				modification: 'Create',
				valueChangedFrom: '',
				valueChangedTo: 'Paris, FR'
			});
		});

	it('should log chained association fields as displayed value on update', async () => {
		const bookStoreId = cds.utils.uuid();
		const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
			ID: bookStoreId,
			city_ID: 'bc21e0d9-a313-4f52-8336-c1be5f66e257'
		});

		await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

		const updateAction = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=${bookStoreId},IsActiveEntity=false)`, {
			city_ID: '60b4c55d-ec87-4edc-84cb-2e4ecd60de48'
		});
		await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', updateAction);

			const updateCityChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStores',
					attribute: 'city',
					modification: 'update'
				})
			);
			expect(updateCityChanges).toHaveLength(1);
			expect(updateCityChanges[0]).toMatchObject({
				valueChangedFrom: 'Paris, FR',
				valueChangedTo: 'New York, USA'
			});
		});

	it('should log chained association fields when creating root with child and info association', async () => {
		const rootId = cds.utils.uuid();
		const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
			ID: rootId,
			info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346',
			child: [
				{
					ID: cds.utils.uuid(),
					title: 'New name for Level1Entity'
				}
			]
		});
		await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', createAction, true);

			const createChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootEntity',
					attribute: 'info',
					modification: 'create'
				})
			);
			expect(createChanges).toHaveLength(1);
			expect(createChanges[0]).toMatchObject({
				modification: 'Create',
				valueChangedFrom: '',
				valueChangedTo: 'Super Mario1'
			});
		});

	it('should log chained association fields when updating root with child and info association', async () => {
		const rootId = cds.utils.uuid();
		const childId = cds.utils.uuid();
		const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
			ID: rootId,
			info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346',
			child: [
				{
					ID: childId,
					title: 'New name for Level1Entity'
				}
			]
		});
		await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', createAction, true);

		const updateInfoAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=${rootId},IsActiveEntity=false)`, {
			info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f44f435',
			child: [
				{
					ID: childId,
					title: 'Level1Entity title changed'
				}
			]
		});
		await utils.apiAction('admin', 'RootEntity', rootId, 'AdminService', updateInfoAction);

			const updateChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootEntity',
					attribute: 'info',
					modification: 'update'
				})
			);
			expect(updateChanges).toHaveLength(1);
			expect(updateChanges[0]).toMatchObject({
				modification: 'Update',
				valueChangedFrom: 'Super Mario1',
				valueChangedTo: 'Super Mario3'
			});
		});
	});

	describe('Localization', () => {
		it('should handle localization when reading change view without required parameters', async () => {
			const bookStoreNoObjIdId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
			const newBookId = cds.utils.uuid();

			const action = POST.bind({}, `/odata/v4/draft-test/BookStoresNoObjectId(ID=${bookStoreNoObjIdId},IsActiveEntity=false)/books`, {
				ID: newBookId,
				title: 'test title'
			});
			await draftUtils.apiAction('draft-test', 'BookStoresNoObjectId', bookStoreNoObjIdId, 'DraftTestService', action);

			const selectedColumns = ['attribute', 'modification', 'entity', 'objectID', 'parentObjectID'];
			const bookElementChanges = [];
			for (const selectedColumn of selectedColumns) {
				const bookChanges = await draftTestService.run(
					SELECT.from(DraftTestChangeView)
						.where({
							entity: 'sap.capire.bookshop.test.draft.BookStoresNoObjectId',
							attribute: 'books'
						})
						.columns(`${selectedColumn}`)
				);
				bookElementChanges.push(bookChanges[0]);
			}

			// To do localization, attribute needs parameters attribute and service entity, so the localization could not be done
			expect(bookElementChanges[0].attribute).toEqual('books');

			// To do localization, modification only needs parameters modification itself, so the localization could be done
			expect(bookElementChanges[1].modification).toEqual('Create');

			// To do localization, entity only needs parameters entity itself, so the localization could be done
			expect(bookElementChanges[2].entity).toEqual('sap.capire.bookshop.test.draft.BookStoresNoObjectId');

			// To do localization, object id needs parameters entity (if no object id is annotated), so the localization could not be done
			// If no object id is annotated, the real value stored in db of object id should be "".
			expect(bookElementChanges[3].objectID).toEqual('');
		});
	});

	describe('Composition of One', () => {
		describe('Create', () => {
		it('should log changes for composition of one node creation', async () => {
			const bookStoreId = cds.utils.uuid();
			const registryId = cds.utils.uuid();
			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: bookStoreId,
				name: 'Murder on the Orient Express',
				registry: {
					ID: registryId,
					code: 'San Francisco-2',
					validOn: '2022-01-01',
					DraftAdministrativeData: {
						DraftUUID: registryId
					}
				}
			});
			await utils.apiAction('admin', 'BookStores', bookStoreId, 'AdminService', action, true);

			const registryChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.BookStoreRegistry',
					attribute: 'validOn'
				})
			);
			expect(registryChanges).toHaveLength(1);
			expect(registryChanges[0]).toMatchObject({
				entityKey: bookStoreId,
				attribute: 'Valid On',
				modification: 'Create',
				objectID: 'San Francisco-2',
				entity: 'Book Store Registry',
				valueChangedFrom: '',
				valueChangedTo: 'Jan 1, 2022',
				parentKey: bookStoreId,
				parentObjectID: 'Murder on the Orient Express'
			});
		});
		});

		describe('Update', () => {
			it('should log changes for composition of one node updated via root node', async () => {
				const action = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=5ab2a87b-3a56-4d97-a697-7af72334a384,IsActiveEntity=false)`, {
					registry: {
						ID: '12ed5dd8-d45b-11ed-afa1-0242ac120001',
						validOn: '2022-01-01',
						DraftAdministrativeData: {
							DraftUUID: '12ed5dd8-d45b-11ed-afa1-0242ac120004'
						}
					}
				});
				await utils.apiAction('admin', 'BookStores', '5ab2a87b-3a56-4d97-a697-7af72334a384', 'AdminService', action);

				const registryChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						attribute: 'validOn'
					})
				);
				expect(registryChanges).toHaveLength(1);
				expect(registryChanges[0]).toMatchObject({
					attribute: 'Valid On',
					modification: 'Update',
					valueChangedFrom: 'Oct 15, 2022',
					valueChangedTo: 'Jan 1, 2022',
					parentKey: '5ab2a87b-3a56-4d97-a697-7af72334a384',
					parentObjectID: 'The Strand'
				});
			});

			it('should log changes for composition of one node updated via child node', async () => {
				const action = PATCH.bind({}, `/odata/v4/admin/BookStoreRegistry(ID=12ed5dd8-d45b-11ed-afa1-0242ac120002,IsActiveEntity=false)`, {
					validOn: '2022-01-01'
				});
				await utils.apiAction('admin', 'BookStores', '8aaed432-8336-4b0d-be7e-3ef1ce7f13ea', 'AdminService', action);

				const registryChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						attribute: 'validOn'
					})
				);
				expect(registryChanges).toHaveLength(1);
				expect(registryChanges[0]).toMatchObject({
					attribute: 'Valid On',
					modification: 'Update',
					valueChangedFrom: 'Sep 1, 2018',
					valueChangedTo: 'Jan 1, 2022',
					parentKey: '8aaed432-8336-4b0d-be7e-3ef1ce7f13ea',
					parentObjectID: 'City Lights Books'
				});
			});
		});

		describe('Delete', () => {
			it('should log changes for composition of one node deletion', async () => {
				const action = DELETE.bind({}, `/odata/v4/admin/BookStoreRegistry(ID=12ed5dd8-d45b-11ed-afa1-0242ac120002,IsActiveEntity=false)`);
				await utils.apiAction('admin', 'BookStores', '8aaed432-8336-4b0d-be7e-3ef1ce7f13ea', 'AdminService', action);

				const registryChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						attribute: 'validOn'
					})
				);
				expect(registryChanges).toHaveLength(1);
				expect(registryChanges[0]).toMatchObject({
					attribute: 'Valid On',
					modification: 'Delete',
					valueChangedFrom: 'Sep 1, 2018',
					valueChangedTo: '',
					parentKey: '8aaed432-8336-4b0d-be7e-3ef1ce7f13ea',
					parentObjectID: 'City Lights Books'
				});
			});
		});
	});

	describe('Custom Actions', () => {
		it('should capture change log when child entity triggers a custom action', async () => {
			await POST(
				`/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=true)/books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=true)/volumns(ID=dd1fdd7d-da2a-4600-940b-0baf2946c9bf,IsActiveEntity=true)/AdminService.activate`
			);

			let changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Volumns',
				attribute: 'ActivationStatus'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'VALID',
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				parentKey: '9d703c23-54a8-4eff-81c1-cdce6b8376b1'
			});

			let changeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				serviceEntity: 'AdminService.BookStores'
			});
			expect(changeLogs).toHaveLength(1);
			expect(changeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				serviceEntity: 'AdminService.BookStores'
			});

			changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Books',
				attribute: 'title'
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Jane Eyre',
				valueChangedTo: 'Black Myth wukong',
				entityKey: '5ab2a87b-3a56-4d97-a697-7af72334a384',
				parentKey: '5ab2a87b-3a56-4d97-a697-7af72334a384'
			});

			changeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: '5ab2a87b-3a56-4d97-a697-7af72334a384',
				serviceEntity: 'AdminService.BookStores'
			});
			expect(changeLogs).toHaveLength(1);
			expect(changeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.BookStores',
				entityKey: '5ab2a87b-3a56-4d97-a697-7af72334a384',
				serviceEntity: 'AdminService.BookStores'
			});
		});
	});

	describe('Special Characters', () => {
		it('should handle special characters in entity IDs', async () => {
			delete cds.services.AdminService.entities.RootSampleDraft['@changelog'];
			delete cds.services.AdminService.entities.Level1SampleDraft['@changelog'];
			delete cds.db.entities.Level1SampleDraft['@changelog'];
			delete cds.db.entities.RootSampleDraft['@changelog'];

			const action = PATCH.bind({}, `/odata/v4/admin/Level1SampleDraft(ID='${encodeURIComponent('/level1draftone')}',IsActiveEntity=false)`, {
				title: 'new special title'
			});
			await utils.apiAction('admin', 'RootSampleDraft', `'${encodeURIComponent('/draftone')}'`, 'AdminService', action);

			let changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level1SampleDraft',
					attribute: 'title'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: 'Level1SampleDraft title',
				valueChangedTo: 'new special title',
				entityKey: '/draftone',
				parentKey: '/draftone',
				objectID: 'Level1 Sample Draft',
				parentObjectID: 'Root Sample Draft'
			});

			cds.services.AdminService.entities.RootSampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }];
			cds.services.AdminService.entities.Level1SampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }, { '=': 'parent.ID' }];
			cds.db.entities.RootSampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }];
			cds.db.entities.Level1SampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }, { '=': 'parent.ID' }];
		});

		it('should handle special characters when creating nested entities simultaneously', async () => {
			const createAction = POST.bind({}, `/odata/v4/draft-test/RootSampleDraftWithObjectId`, {
				ID: '/draftwithobjidnew',
				title: 'New title for RootSampleDraftWithObjectId',
				child: [
					{
						ID: '/level1draftwithobjidnew',
						title: 'New title for Level1SampleDraftWithObjectId',
						child: [
							{
								ID: '/level2draftwithobjidnew',
								title: 'New title for Level2SampleDraftWithObjectId'
							}
						]
					}
				]
			});
			await draftUtils.apiAction('draft-test', 'RootSampleDraftWithObjectId', `'${encodeURIComponent('/draftwithobjidnew')}'`, 'DraftTestService', createAction, true);

			let changes = await draftTestService.run(
				SELECT.from(DraftTestChangeView).where({
					entity: 'sap.capire.bookshop.test.draft.RootSampleDraftWithObjectId',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for RootSampleDraftWithObjectId',
				entityKey: '/draftwithobjidnew',
				parentKey: '',
				objectID: '/draftwithobjidnew, New title for RootSampleDraftWithObjectId'
			});

			changes = await draftTestService.run(
				SELECT.from(DraftTestChangeView).where({
					entity: 'sap.capire.bookshop.test.draft.Level1SampleDraftWithObjectId',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for Level1SampleDraftWithObjectId',
				entityKey: '/draftwithobjidnew',
				parentKey: '/draftwithobjidnew',
				objectID: '/level1draftwithobjidnew, New title for Level1SampleDraftWithObjectId, /draftwithobjidnew'
			});

			changes = await draftTestService.run(
				SELECT.from(DraftTestChangeView).where({
					entity: 'sap.capire.bookshop.test.draft.Level2SampleDraftWithObjectId',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for Level2SampleDraftWithObjectId',
				entityKey: '/draftwithobjidnew',
				parentKey: '/level1draftwithobjidnew',
				objectID: '/level2draftwithobjidnew, New title for Level2SampleDraftWithObjectId, /draftwithobjidnew'
			});
		});
	});
});
