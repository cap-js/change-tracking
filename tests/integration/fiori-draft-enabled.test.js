const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { data, POST, PATCH, DELETE } = cds.test(bookshop);
const { RequestSend } = require('../utils/api');

let adminService = null;
let ChangeView = null;
let db = null;
let ChangeEntity = null;
let utils = null;
let ChangeLog = null;

describe('Draft-Enabled Change Tracking', () => {
	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
		db = await cds.connect.to('db');
		ChangeEntity = db.model.definitions['sap.changelog.Changes'];
		ChangeLog = db.model.definitions['sap.changelog.ChangeLog'];
		utils = new RequestSend(POST);
	});

	beforeEach(async () => {
		await data.reset();
	});

	describe('Preserve Deletes', () => {
		it('should retain all changelogs after root entity deletion when preserveDeletes is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;

			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: '01234567-89ab-cdef-0123-987654fedcba',
				name: 'New name for RootEntity',
				child: [
					{
						ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
						title: 'New name for Level1Entity',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
								title: 'New name for Level2Entity',
								child: [
									{
										ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
										title: 'New name for Level3Entity'
									}
								]
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', createAction, true);
			const beforeChanges = await adminService.run(SELECT.from(ChangeView));
			expect(beforeChanges.length > 0).toBeTruthy();

			await DELETE(`/odata/v4/admin/RootEntity(ID=01234567-89ab-cdef-0123-987654fedcba,IsActiveEntity=true)`);

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
			cds.services.AdminService.entities.Books.elements.price['@changelog'] = true;

			let action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: '01234567-89ab-cdef-0123-987654fedcba',
				price: 0,
				isUsed: false
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);
			let changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(2);

			const priceChange = changes.find((c) => c.attribute === 'price');
			expect(priceChange).toMatchObject({
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				modification: 'Create',
				entity: 'Book',
				valueChangedFrom: ''
			});
			expect(Number(priceChange.valueChangedTo)).toEqual(0);

			const isUsedChange = changes.find((c) => c.attribute === 'isUsed');
			expect(isUsedChange).toMatchObject({
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				modification: 'Create',
				entity: 'Book',
				valueChangedFrom: '',
				valueChangedTo: 'false'
			});

			delete cds.services.AdminService.entities.Books.elements.price['@changelog'];
		});

		it('should generate changelog for numeric zero and boolean false on delete', async () => {
			cds.services.AdminService.entities.Books.elements.price['@changelog'] = true;

			let action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: '01234567-89ab-cdef-0123-987654fedcba',
				price: 0,
				isUsed: false
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			action = DELETE.bind({}, `/odata/v4/admin/Books(ID=01234567-89ab-cdef-0123-987654fedcba,IsActiveEntity=false)`);
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);
			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					modification: 'delete'
				})
			);
			expect(changes).toHaveLength(2);

			const priceChange = changes.find((c) => c.attribute === 'price');
			expect(priceChange).toMatchObject({
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				modification: 'Delete',
				entity: 'Book',
				valueChangedTo: ''
			});
			expect(Number(priceChange.valueChangedFrom)).toEqual(0);

			const isUsedChange = changes.find((c) => c.attribute === 'isUsed');
			expect(isUsedChange).toMatchObject({
				entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
				modification: 'Delete',
				entity: 'Book',
				valueChangedFrom: 'false',
				valueChangedTo: ''
			});

			delete cds.services.AdminService.entities.Books.elements.price['@changelog'];
		});
	});

	describe('Child Entity Operations', () => {
		describe('Create', () => {
			it('should log basic data type changes on child entity creation', async () => {
				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
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
				const unmanagedAction = POST.bind({}, `/odata/v4/admin/Schools(ID=5ab2a87b-3a56-4d97-a697-7af72333c123,IsActiveEntity=false)/classes`, {
					ID: '9d703c23-54a8-4eff-81c1-cdec5c4267c5',
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
				cds.services.AdminService.entities.Books.elements.price['@changelog'] = true;

				const action = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b1,IsActiveEntity=false)`, {
					title: 'new title',
					author_ID: '47f97f40-4f41-488a-b10b-a5725e762d5e',
					genre_ID: 16,
					isUsed: false,
					price: 3000
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
					modification: 'Update',
					objectID: 'Shakespeare and Company',
					entity: 'Book Store',
					valueChangedFrom: 'new title',
					valueChangedTo: 'new title'
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
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Book',
					valueChangedFrom: 'Wuthering Heights',
					valueChangedTo: 'new title'
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
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Book',
					valueChangedFrom: 'Emily, Brontë',
					valueChangedTo: 'Charlotte, Brontë'
				});

				const genreChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'genre'
					})
				);
				expect(genreChanges).toHaveLength(1);
				expect(genreChanges[0]).toMatchObject({
					entityKey: '64625905-c234-4d0d-9bc1-283ee8946770',
					attribute: 'Genres',
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Book',
					valueChangedFrom: '11',
					valueChangedTo: '16'
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
					modification: 'Update',
					objectID: 'new title, Charlotte, Brontë',
					entity: 'Book',
					valueChangedFrom: 'true',
					valueChangedTo: 'false'
				});

				// The current price is 3000.0000, and update operation via OData service is price: 3000. In this case, a changelog should not be generated.
				const priceChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.Books',
						attribute: 'price'
					})
				);
				expect(priceChanges).toHaveLength(0);

				delete cds.services.AdminService.entities.Books.elements.price['@changelog'];
			});

			it('should log unmanaged entity update', async () => {
				const unmanagedAction = POST.bind({}, `/odata/v4/admin/Schools(ID=5ab2a87b-3a56-4d97-a697-7af72333c123,IsActiveEntity=false)/classes`, {
					ID: '9d703c23-54a8-4eff-81c1-cdec5c4267c5',
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

				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
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

				const createAction = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', createAction);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' }, { '=': 'stock' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
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

				const createAction = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
					title: 'test title',
					descr: 'test descr',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					stock: 1,
					price: 1.0
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', createAction);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'title' }, { '=': 'bookStore.name' }, { '=': 'bookStore.location' }, { '=': 'stock' }, { '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
					title: 'test title 1'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', actionPH);

				cds.services.AdminService.entities.Books['@changelog'] = [{ '=': 'bookStore.name' }, { '=': 'title' }, { '=': 'bookStore.location' }, { '=': 'author.name.firstName' }, { '=': 'stock' }, { '=': 'author.name.lastName' }];

				const actionDE = DELETE.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`);
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

				const createBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b6587c4',
					name: 'new name'
				});
				await utils.apiAction('admin', 'BookStores', '9d703c23-54a8-4eff-81c1-cdce6b6587c4', 'AdminService', createBookStoresAction, true);

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

				const createBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b6587c4',
					name: 'new name'
				});
				await utils.apiAction('admin', 'BookStores', '9d703c23-54a8-4eff-81c1-cdce6b6587c4', 'AdminService', createBookStoresAction, true);

				const updateBookStoresAction = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=9d703c23-54a8-4eff-81c1-cdce6b6587c4,IsActiveEntity=false)`, {
					name: 'name update'
				});
				await utils.apiAction('admin', 'BookStores', '9d703c23-54a8-4eff-81c1-cdce6b6587c4', 'AdminService', updateBookStoresAction);

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

				const createBooksAndBookStoresAction = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '48268451-8552-42a6-a3d7-67564be86634',
					city_ID: '60b4c55d-ec87-4edc-84cb-2e4ecd60de48',
					books: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-1942bd119007',
							title: 'New title'
						}
					]
				});

				await utils.apiAction('admin', 'BookStores', '48268451-8552-42a6-a3d7-67564be86634', 'AdminService', createBooksAndBookStoresAction, true);

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

				const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
					ID: '01234567-89ab-cdef-0123-987654fedcba',
					name: 'New name for RootEntity',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
							title: 'New name for Level1Entity',
							child: [
								{
									ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
									title: 'New name for Level2Entity',
									child: [
										{
											ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
											title: 'New name for Level3Entity'
										}
									]
								}
							]
						}
					]
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', createAction, true);

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

				const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
					ID: '01234567-89ab-cdef-0123-987654fedcba',
					name: 'New name for RootEntity',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
							title: 'New name for Level1Entity',
							child: [
								{
									ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
									title: 'New name for Level2Entity',
									child: [
										{
											ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
											title: 'New name for Level3Entity'
										}
									]
								}
							]
						}
					]
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', createAction, true);

				const updateAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=01234567-89ab-cdef-0123-987654fedcba,IsActiveEntity=false)`, {
					lifecycleStatus_code: 'AC',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
							child: [
								{
									ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
									child: [
										{
											ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
											title: 'Level3Entity title changed'
										}
									]
								}
							]
						}
					]
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', updateAction);

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

				const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
					ID: '01234567-89ab-cdef-0123-987654fedcba',
					name: 'New name for RootEntity',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
							title: 'New name for Level1Entity',
							child: [
								{
									ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
									title: 'New name for Level2Entity',
									child: [
										{
											ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
											title: 'New name for Level3Entity'
										}
									]
								}
							]
						}
					]
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', createAction, true);

				const updateAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=01234567-89ab-cdef-0123-987654fedcba,IsActiveEntity=false)`, {
					lifecycleStatus_code: 'AC',
					child: [
						{
							ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
							child: [
								{
									ID: '12ed5dd8-d45b-11ed-afa1-0242ac124446',
									child: [
										{
											ID: '12ed5dd8-d45b-11ed-afa1-0242ac123335',
											title: 'Level3Entity title changed'
										}
									]
								}
							]
						}
					]
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', updateAction);

				const deleteEntityAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=01234567-89ab-cdef-0123-987654fedcba,IsActiveEntity=false)`, {
					lifecycleStatus_code: 'CL',
					child: []
				});
				await utils.apiAction('admin', 'RootEntity', '01234567-89ab-cdef-0123-987654fedcba', 'AdminService', deleteEntityAction);

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
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
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

				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
					author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
					title: 'test title'
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				cds.services.AdminService.entities.Books.elements.author_ID['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];
				cds.services.AdminService.entities.Books.elements.author['@changelog'] = [{ '=': 'author.name.firstName' }, { '=': 'author.name.lastName' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
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
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
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

				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
					title: 'test title',
					stock: 2,
					price: 2.3
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				cds.services.AdminService.entities.BookStores.elements.books['@changelog'] = [{ '=': 'books.stock' }, { '=': 'books.title' }, { '=': 'books.price' }];

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=9d703c23-54a8-4eff-81c1-cdce6b8376b2,IsActiveEntity=false)`, {
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
				const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '01234567-89ab-cdef-0123-456789abcdef',
					name: 'test name'
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

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
				const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '01234567-89ab-cdef-0123-456789abcdef',
					name: 'test name'
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

				const actionPH = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`, {
					lifecycleStatus: {
						code: 'CL'
					}
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', actionPH);

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
					ID: '7e9d4199-4602-47f1-8767-85dae82ce639',
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
				const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
					ID: '7e9d4199-4602-47f1-8767-85dae82ce639',
					bookType: {
						code: 'MAN'
					}
				});
				await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

				const actionPH = PATCH.bind({}, `/odata/v4/admin/Books(ID=7e9d4199-4602-47f1-8767-85dae82ce639,IsActiveEntity=false)`, {
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

				const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '01234567-89ab-cdef-0123-456789abcdef',
					name: 'test name'
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

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

				const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '01234567-89ab-cdef-0123-456789abcdef',
					name: 'test name'
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

				cds.services.AdminService.entities.BookStores['@changelog'] = [{ '=': 'lifecycleStatus.name' }, { '=': 'name' }];
				const actionPH = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`, {
					lifecycleStatus: {
						code: 'CL'
					},
					name: 'new test name'
				});

				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', actionPH);

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
			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: '01234567-89ab-cdef-0123-456789abcdef',
				city_ID: 'bc21e0d9-a313-4f52-8336-c1be5f66e257'
			});

			await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

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
			const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
				ID: '01234567-89ab-cdef-0123-456789abcdef',
				city_ID: 'bc21e0d9-a313-4f52-8336-c1be5f66e257'
			});

			await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

			const updateAction = PATCH.bind({}, `/odata/v4/admin/BookStores(ID=01234567-89ab-cdef-0123-456789abcdef,IsActiveEntity=false)`, {
				city_ID: '60b4c55d-ec87-4edc-84cb-2e4ecd60de48'
			});
			await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', updateAction);

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
			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: 'c56b392c-e476-41a2-a460-ce6123be090a',
				info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346',
				child: [
					{
						ID: '1868758f-fb18-44e8-b6c5-ed552d6b3706',
						title: 'New name for Level1Entity'
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', 'c56b392c-e476-41a2-a460-ce6123be090a', 'AdminService', createAction, true);

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
			const createAction = POST.bind({}, `/odata/v4/admin/RootEntity`, {
				ID: 'c56b392c-e476-41a2-a460-ce6123be090a',
				info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f88c346',
				child: [
					{
						ID: '1868758f-fb18-44e8-b6c5-ed552d6b3706',
						title: 'New name for Level1Entity'
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', 'c56b392c-e476-41a2-a460-ce6123be090a', 'AdminService', createAction, true);

			const updateInfoAction = PATCH.bind({}, `/odata/v4/admin/RootEntity(ID=c56b392c-e476-41a2-a460-ce6123be090a,IsActiveEntity=false)`, {
				info_ID: 'bc21e0d9-a313-4f52-8336-c1be5f44f435',
				child: [
					{
						ID: '1868758f-fb18-44e8-b6c5-ed552d6b3706',
						title: 'Level1Entity title changed'
					}
				]
			});
			await utils.apiAction('admin', 'RootEntity', 'c56b392c-e476-41a2-a460-ce6123be090a', 'AdminService', updateInfoAction);

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
			const originalChangelog = JSON.parse(JSON.stringify(cds.services.AdminService.entities.BookStores['@changelog']));
			delete cds.services.AdminService.entities.BookStores['@changelog'];
			delete cds.db.entities.BookStores['@changelog'];

			const action = POST.bind({}, `/odata/v4/admin/BookStores(ID=64625905-c234-4d0d-9bc1-283ee8946770,IsActiveEntity=false)/books`, {
				ID: '9d703c23-54a8-4eff-81c1-cdce6b8376b2',
				title: 'test title',
				descr: 'test descr',
				author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				stock: 1,
				price: 1.0
			});
			await utils.apiAction('admin', 'BookStores', '64625905-c234-4d0d-9bc1-283ee8946770', 'AdminService', action);

			const selectedColumns = ['attribute', 'modification', 'entity', 'objectID', 'parentObjectID'];
			const bookElementChanges = [];
			for (const selectedColumn of selectedColumns) {
				const bookChanges = await adminService.run(
					SELECT.from(ChangeView)
						.where({
							entity: 'sap.capire.bookshop.BookStores',
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
			expect(bookElementChanges[2].entity).toEqual('sap.capire.bookshop.BookStores');

			// To do localization, object id needs parameters entity (if no object id is annotated), so the localization could not be done
			// If no object id is annotated, the real value stored in db of object id should be "".
			expect(bookElementChanges[3].objectID).toEqual('');

			cds.services.AdminService.entities.BookStores['@changelog'] = originalChangelog;
			cds.db.entities.BookStores['@changelog'] = originalChangelog;
		});
	});

	describe('Composition of One', () => {
		describe('Create', () => {
			it('should log changes for composition of one node creation', async () => {
				const action = POST.bind({}, `/odata/v4/admin/BookStores`, {
					ID: '01234567-89ab-cdef-0123-456789abcdef',
					name: 'Murder on the Orient Express',
					registry: {
						ID: '12ed5dd8-d45b-11ed-afa1-0242ac120003',
						code: 'San Francisco-2',
						validOn: '2022-01-01',
						DraftAdministrativeData: {
							DraftUUID: '12ed5dd8-d45b-11ed-afa1-0242ac120003'
						}
					}
				});
				await utils.apiAction('admin', 'BookStores', '01234567-89ab-cdef-0123-456789abcdef', 'AdminService', action, true);

				const registryChanges = await adminService.run(
					SELECT.from(ChangeView).where({
						entity: 'sap.capire.bookshop.BookStoreRegistry',
						attribute: 'validOn'
					})
				);
				expect(registryChanges).toHaveLength(1);
				expect(registryChanges[0]).toMatchObject({
					entityKey: '01234567-89ab-cdef-0123-456789abcdef',
					attribute: 'Valid On',
					modification: 'Create',
					objectID: 'San Francisco-2',
					entity: 'Book Store Registry',
					valueChangedFrom: '',
					valueChangedTo: 'Jan 1, 2022',
					parentKey: '01234567-89ab-cdef-0123-456789abcdef',
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
			cds.services.AdminService.entities.RootSampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }];
			cds.services.AdminService.entities.Level1SampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }, { '=': 'parent.ID' }];

			const createAction = POST.bind({}, `/odata/v4/admin/RootSampleDraft`, {
				ID: '/drafttwo',
				title: 'New title for RootSampleDraft',
				child: [
					{
						ID: '/level1drafttwo',
						title: 'New title for Level1SampleDraft',
						child: [
							{
								ID: '/level2drafttwo',
								title: 'New title for Level2SampleDraft'
							}
						]
					}
				]
			});
			await utils.apiAction('admin', 'RootSampleDraft', `'${encodeURIComponent('/drafttwo')}'`, 'AdminService', createAction, true);

			let changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.RootSampleDraft',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for RootSampleDraft',
				entityKey: '/drafttwo',
				parentKey: '',
				objectID: '/drafttwo, New title for RootSampleDraft'
			});

			changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level1SampleDraft',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for Level1SampleDraft',
				entityKey: '/drafttwo',
				parentKey: '/drafttwo',
				objectID: '/level1drafttwo, New title for Level1SampleDraft, /drafttwo'
			});

			changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2SampleDraft',
					attribute: 'title',
					modification: 'create'
				})
			);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'New title for Level2SampleDraft',
				entityKey: '/drafttwo',
				parentKey: '/level1drafttwo',
				objectID: '/level2drafttwo, New title for Level2SampleDraft, /drafttwo'
			});

			cds.db.entities.RootSampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }];
			cds.db.entities.Level1SampleDraft['@changelog'] = [{ '=': 'ID' }, { '=': 'title' }, { '=': 'parent.ID' }];
		});
	});
});
