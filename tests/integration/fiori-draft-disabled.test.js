const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { data, POST, PATCH, DELETE } = cds.test(bookshop);

let adminService = null;
let ChangeView = null;
let db = null;
let ChangeEntity = null;
let ChangeLog = null;

describe('Draft-Disabled Change Tracking', () => {
	beforeAll(async () => {
		adminService = await cds.connect.to('AdminService');
		ChangeView = adminService.entities.ChangeView;
		ChangeView['@cds.autoexposed'] = false;
		db = await cds.connect.to('db');
		ChangeEntity = db.model.definitions['sap.changelog.Changes'];
		ChangeLog = db.model.definitions['sap.changelog.ChangeLog'];
	});

	beforeEach(async () => {
		await data.reset();
	});

	describe('Root Entity Operations', () => {
		it('should log creation with basic data types', async () => {
			const author = await POST(`/odata/v4/admin/Authors`, {
				name_firstName: 'Sam',
				name_lastName: 'Smiths',
				placeOfBirth: 'test place'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const nameLog = changes.find((change) => change.attribute === 'Author Name');
			const placeOfBirthLog = changes.find((change) => change.attribute === 'Place Of Birth');

			expect(nameLog).toMatchObject({
				entityKey: author.data.ID,
				modification: 'Create',
				objectID: 'Sam, Smiths',
				entity: 'Author',
				valueChangedFrom: ''
			});
			expect(nameLog.parentObjectID).toBeFalsy();
			expect(nameLog.parentKey).toBeFalsy();
			expect(changes.some((c) => c.valueChangedTo === 'Sam')).toBe(true);

			expect(placeOfBirthLog).toMatchObject({
				entityKey: author.data.ID,
				modification: 'Create',
				objectID: 'Sam, Smiths',
				entity: 'Author',
				valueChangedFrom: '',
				valueChangedTo: 'test place'
			});
			expect(placeOfBirthLog.parentObjectID).toBeFalsy();
			expect(placeOfBirthLog.parentKey).toBeFalsy();
		});

		it('should log field update', async () => {
			await PATCH(`/odata/v4/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
				placeOfBirth: 'new placeOfBirth'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				attribute: 'Place Of Birth',
				entityKey: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387',
				modification: 'Update',
				objectID: 'Emily, Brontë',
				entity: 'Author',
				valueChangedFrom: 'Thornton, Yorkshire',
				valueChangedTo: 'new placeOfBirth'
			});
			expect(changes[0].parentObjectID).toBeFalsy();
			expect(changes[0].parentKey).toBeFalsy();
		});

		it('should delete change logs when entity is deleted', async () => {
			const author = await POST(`/odata/v4/admin/Authors`, {
				name_firstName: 'Sam',
				name_lastName: 'Smiths',
				placeOfBirth: 'test place'
			});

			const beforeChanges = await adminService.run(SELECT.from(ChangeView));
			expect(beforeChanges.length).toBeGreaterThan(0);

			await DELETE(`/odata/v4/admin/Authors(ID=${author.data.ID})`);

			const afterChanges = await adminService.run(SELECT.from(ChangeView));
			expect(afterChanges).toHaveLength(0);
		});

		it('should preserve change logs when preserveDeletes is enabled', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;

			cds.services.AdminService.entities.RootObject['@changelog'] = [{ '=': 'title' }];
			cds.services.AdminService.entities.Level1Object['@changelog'] = [{ '=': 'parent.title' }];
			cds.services.AdminService.entities.Level2Object['@changelog'] = [{ '=': 'parent.parent.title' }];

			const RootObject = await POST(`/odata/v4/admin/RootObject`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
				title: 'new RootObject title',
				child: [
					{
						ID: '48268451-8552-42a6-a3d7-67564be97733',
						title: 'new Level1Object title',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-1942bd228115',
								title: 'new Level2Object title'
							}
						]
					}
				]
			});

			const beforeChanges = await adminService.run(SELECT.from(ChangeView));
			expect(beforeChanges.length).toBeGreaterThan(0);

			await DELETE(`/odata/v4/admin/RootObject(ID=${RootObject.data.ID})`);

			const afterChanges = await adminService.run(SELECT.from(ChangeView));
			expect(afterChanges).toHaveLength(8);

			const changelogCreated = afterChanges.filter((ele) => ele.modification === 'Create');
			const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'Delete');

			const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'parentKey', 'serviceEntityPath', 'valueDataType', 'objectID', 'parentObjectID', 'entityKey'];

			const commonItems = changelogCreated.filter((beforeItem) => {
				return changelogDeleted.some((afterItem) => {
					return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
				});
			});

			expect(commonItems.length).toBeGreaterThan(0);

			delete cds.services.AdminService.entities.RootObject['@changelog'];
			delete cds.services.AdminService.entities.Level1Object['@changelog'];
			delete cds.services.AdminService.entities.Level2Object['@changelog'];
		});

		it('should track numeric zero and boolean false values', async () => {
			cds.env.requires['change-tracking'].preserveDeletes = true;
			cds.services.AdminService.entities.Order.elements.netAmount['@changelog'] = true;
			cds.services.AdminService.entities.Order.elements.isUsed['@changelog'] = true;

			await POST(`/odata/v4/admin/Order`, {
				ID: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
				isUsed: false,
				netAmount: 0
			});

			let changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(2);

			const createNetAmount = changes.find((c) => c.attribute === 'netAmount');
			expect(createNetAmount).toMatchObject({
				entityKey: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
				modification: 'Create',
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: ''
			});
			expect(Number(createNetAmount.valueChangedTo)).toEqual(0);

			const createIsUsed = changes.find((c) => c.attribute === 'isUsed');
			expect(createIsUsed).toMatchObject({
				entityKey: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
				modification: 'Create',
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: '',
				valueChangedTo: 'false'
			});

			await DELETE('/odata/v4/admin/Order(ID=3e745e35-5974-4383-b60a-2f5c9bdd31ac)');

			changes = await adminService.run(
				SELECT.from(ChangeView).where({
					modification: 'delete'
				})
			);
			expect(changes).toHaveLength(2);

			const deleteNetAmount = changes.find((c) => c.attribute === 'netAmount');
			expect(deleteNetAmount).toMatchObject({
				entityKey: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
				modification: 'Delete',
				entity: 'sap.capire.bookshop.Order',
				valueChangedTo: ''
			});
			expect(Number(deleteNetAmount.valueChangedFrom)).toEqual(0);

			const deleteIsUsed = changes.find((c) => c.attribute === 'isUsed');
			expect(deleteIsUsed).toMatchObject({
				entityKey: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
				modification: 'Delete',
				entity: 'sap.capire.bookshop.Order',
				valueChangedFrom: 'false',
				valueChangedTo: ''
			});

			delete cds.services.AdminService.entities.Order.elements.netAmount['@changelog'];
			delete cds.services.AdminService.entities.Order.elements.isUsed['@changelog'];
		});
	});

	describe('Composition of Many', () => {
		it('should log creation via OData request', async () => {
			await POST(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes`, {
				content: 'new content'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const orderChanges = changes.filter((change) => change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31');

			expect(orderChanges).toHaveLength(1);
			expect(orderChanges[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'Create',
				valueChangedFrom: '',
				valueChangedTo: 'new content',
				parentKey: '9a61178f-bfb3-4c17-8d17-c6b4a63e0097',
				parentObjectID: 'sap.capire.bookshop.OrderItem'
			});

			const changeLogs = await SELECT.from(ChangeLog);
			expect(changeLogs).toHaveLength(1);
			expect(changeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				serviceEntity: 'AdminService.Order'
			});
		});

		it('should log update via OData request', async () => {
			await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`, {
				content: 'new content'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const orderChanges = changes.filter((change) => change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31');

			expect(orderChanges).toHaveLength(1);
			expect(orderChanges[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'Update',
				valueChangedFrom: 'note 1',
				valueChangedTo: 'new content',
				parentKey: '9a61178f-bfb3-4c17-8d17-c6b4a63e0097',
				parentObjectID: 'sap.capire.bookshop.OrderItem'
			});

			const changeLogs = await SELECT.from(ChangeLog);
			expect(changeLogs).toHaveLength(1);
			expect(changeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				serviceEntity: 'AdminService.Order'
			});
		});

		it('should log deletion via OData request', async () => {
			await DELETE(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`);

			const changes = await adminService.run(SELECT.from(ChangeView));
			const orderChanges = changes.filter((change) => change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31');

			expect(orderChanges).toHaveLength(1);
			expect(orderChanges[0]).toMatchObject({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'content',
				modification: 'Delete',
				valueChangedFrom: 'note 1',
				valueChangedTo: '',
				parentKey: '9a61178f-bfb3-4c17-8d17-c6b4a63e0097',
				parentObjectID: 'sap.capire.bookshop.OrderItem'
			});
		});

		it('should log changes when URL contains association', async () => {
			await POST(`/odata/v4/admin/Report(ID=0a41a666-a2ff-4df6-bd12-fae8996e6666)/orders(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems`, {
				order_ID: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				quantity: 10,
				price: 5
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const orderChanges = changes.filter((change) => change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31');

			expect(orderChanges).toHaveLength(2);
		});

		it('should track inline composition changes', async () => {
			await PATCH(`/odata/v4/admin/Order_Items(up__ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,ID=2b23bb4b-4ac7-4a24-ac02-aa10cabd842c)`, {
				quantity: 12.0
			});

			const changes = await adminService.run(SELECT.from(ChangeView));

			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({
				attribute: 'quantity',
				modification: 'Update',
				valueChangedFrom: '10',
				valueChangedTo: '12',
				parentKey: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
				keys: 'ID=2b23bb4b-4ac7-4a24-ac02-aa10cabd842c'
			});
		});
	});

	describe('Composition of One', () => {
		it('should log creation', async () => {
			await POST(`/odata/v4/admin/Order`, {
				ID: '11234567-89ab-cdef-0123-456789abcdef',
				header: {
					status: 'Ordered'
				}
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const headerChanges = changes.filter((change) => change.entity === 'sap.capire.bookshop.OrderHeader');

			expect(headerChanges).toHaveLength(1);
			expect(headerChanges[0]).toMatchObject({
				attribute: 'status',
				modification: 'Create',
				valueChangedFrom: '',
				valueChangedTo: 'Ordered',
				parentKey: '11234567-89ab-cdef-0123-456789abcdef',
				parentObjectID: 'sap.capire.bookshop.Order'
			});
		});

		it('should log update', async () => {
			cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];

			await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)`, {
				header: {
					ID: '8567d0de-d44f-11ed-afa1-0242ac120002',
					status: 'Ordered'
				}
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			const headerChanges = changes.filter((change) => change.entity === 'sap.capire.bookshop.OrderHeader');

			expect(headerChanges).toHaveLength(1);
			expect(headerChanges[0]).toMatchObject({
				attribute: 'status',
				modification: 'Update',
				valueChangedFrom: 'Shipped',
				valueChangedTo: 'Ordered',
				parentKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				parentObjectID: 'Post'
			});

			delete cds.services.AdminService.entities.Order['@changelog'];
		});

		it('should log deletion', async () => {
			cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];

			await DELETE(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/header`);

			const changes = await adminService.run(SELECT.from(ChangeView));
			const headerChanges = changes.filter((change) => change.entity === 'sap.capire.bookshop.OrderHeader');

			expect(headerChanges).toHaveLength(1);
			expect(headerChanges[0]).toMatchObject({
				attribute: 'status',
				modification: 'Delete',
				valueChangedFrom: 'Shipped',
				valueChangedTo: '',
				parentKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				parentObjectID: 'Post'
			});

			delete cds.services.AdminService.entities.Order['@changelog'];
		});
	});

	describe('Object ID Annotations', () => {
		it('should use native and associated attributes as object ID', async () => {
			cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'customer.city' }, { '=': 'order.status' }, { '=': 'price' }, { '=': 'quantity' }];

			await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
				quantity: 14
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(1);

			const IDsegments = changes[0].objectID.split(', ');
			expect(IDsegments[0]).toEqual('Ōsaka');
			expect(IDsegments[1]).toEqual('Post');
			expect(Number(IDsegments[2])).toEqual(5);
			expect(Number(IDsegments[3])).toEqual(14);

			delete cds.services.AdminService.entities.OrderItem['@changelog'];
		});

		it('should use multiple native attributes as object ID', async () => {
			cds.services.AdminService.entities.Authors['@changelog'] = [{ '=': 'placeOfBirth' }, { '=': 'name.firstName' }, { '=': 'name.lastName' }, { '=': 'placeOfDeath' }, { '=': 'dateOfDeath' }, { '=': 'dateOfBirth' }];

			await PATCH(`/odata/v4/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
				placeOfBirth: 'new placeOfBirth'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('new placeOfBirth, Emily, Brontë, Haworth, Yorkshire, 1848-12-19, 1818-07-30');

			cds.services.AdminService.entities.Authors['@changelog'] = [{ '=': 'name.firstName' }, { '=': 'name.lastName' }];
		});

		it('should use multiple associated attributes as object ID', async () => {
			cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'customer.city' }, { '=': 'order.status' }, { '=': 'customer.country' }, { '=': 'customer.name' }];

			await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
				quantity: 14
			});

			const changes = await adminService.run(SELECT.from(ChangeView));
			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('Ōsaka, Post, Japan, Honda');

			delete cds.services.AdminService.entities.OrderItem['@changelog'];
		});
	});

	describe('Chained Association Object ID', () => {
		it('should resolve object ID from chained associations', async () => {
			cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'order.report.comment' }, { '=': 'order.status' }, { '=': 'customer.name' }];

			await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
				quantity: 14
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.OrderItem',
					attribute: 'quantity'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('some comment, Post, Honda');

			delete cds.services.AdminService.entities.OrderItem['@changelog'];
		});

		it('should resolve object ID on deep nested create', async () => {
			cds.services.AdminService.entities.Level3Object['@changelog'] = [{ '=': 'parent.parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc25b8c',
				parent_ID: 'a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc',
				title: 'new L3 title'
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Object',
					attribute: 'title',
					modification: 'create'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('RootObject title1');

			delete cds.services.AdminService.entities.Level3Object['@changelog'];
		});

		it('should resolve object ID on deep nested update', async () => {
			cds.services.AdminService.entities.Level3Object['@changelog'] = [{ '=': 'parent.parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc25b8c',
				parent_ID: 'a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc',
				title: 'new L3 title'
			});

			await PATCH(`/odata/v4/admin/Level3Object(ID=a670e8e1-ee06-4cad-9cbd-a2354dc25b8c)`, {
				title: 'L3 title changed'
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Object',
					attribute: 'title',
					modification: 'update'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('RootObject title1');

			delete cds.services.AdminService.entities.Level3Object['@changelog'];
		});

		it('should resolve object ID on deep nested delete', async () => {
			cds.services.AdminService.entities.Level3Object['@changelog'] = [{ '=': 'parent.parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc25b8c',
				parent_ID: 'a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc',
				title: 'new L3 title'
			});

			await DELETE(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child(ID=a670e8e1-ee06-4cad-9cbd-a2354dc25b8c)`);

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Object',
					attribute: 'title',
					modification: 'delete'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('RootObject title1');

			delete cds.services.AdminService.entities.Level3Object['@changelog'];
		});

		it('should resolve object ID when parent and child created simultaneously', async () => {
			cds.services.AdminService.entities.Level2Object['@changelog'] = [{ '=': 'parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
				title: 'new RootObject title',
				child: [
					{
						ID: '48268451-8552-42a6-a3d7-67564be97733',
						title: 'new Level1Object title',
						parent_ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-1942bd228115',
								title: 'new Level2Object title',
								parent_ID: '48268451-8552-42a6-a3d7-67564be97733'
							}
						]
					}
				]
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Object',
					attribute: 'title',
					modification: 'create'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('new RootObject title');

			delete cds.services.AdminService.entities.Level2Object['@changelog'];
		});

		it('should resolve object ID when parent and child updated simultaneously', async () => {
			cds.services.AdminService.entities.Level2Object['@changelog'] = [{ '=': 'parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
				title: 'new RootObject title',
				child: [
					{
						ID: '48268451-8552-42a6-a3d7-67564be97733',
						title: 'new Level1Object title',
						parent_ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-1942bd228115',
								title: 'new Level2Object title',
								parent_ID: '48268451-8552-42a6-a3d7-67564be97733'
							}
						]
					}
				]
			});

			await PATCH(`/odata/v4/admin/RootObject(ID=a670e8e1-ee06-4cad-9cbd-a2354dc37c9d)`, {
				title: 'RootObject title changed',
				child: [
					{
						ID: '48268451-8552-42a6-a3d7-67564be97733',
						parent_ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-1942bd228115',
								title: 'Level2Object title changed',
								parent_ID: '48268451-8552-42a6-a3d7-67564be97733'
							}
						]
					}
				]
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Object',
					attribute: 'title',
					modification: 'update'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('RootObject title changed');

			delete cds.services.AdminService.entities.Level2Object['@changelog'];
		});

		it('should resolve object ID when parent updated and child deleted simultaneously', async () => {
			cds.services.AdminService.entities.Level2Object['@changelog'] = [{ '=': 'parent.parent.title' }];

			await POST(`/odata/v4/admin/RootObject`, {
				ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
				title: 'new RootObject title',
				child: [
					{
						ID: '48268451-8552-42a6-a3d7-67564be97733',
						title: 'new Level1Object title',
						parent_ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc37c9d',
						child: [
							{
								ID: '12ed5dd8-d45b-11ed-afa1-1942bd228115',
								title: 'new Level2Object title',
								parent_ID: '48268451-8552-42a6-a3d7-67564be97733'
							}
						]
					}
				]
			});

			await PATCH(`/odata/v4/admin/RootObject(ID=a670e8e1-ee06-4cad-9cbd-a2354dc37c9d)`, {
				title: 'RootObject title del',
				child: []
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level2Object',
					attribute: 'title',
					modification: 'delete'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].objectID).toEqual('RootObject title del');

			delete cds.services.AdminService.entities.Level2Object['@changelog'];
		});

		it('should resolve object ID with optional association path', async () => {
			cds.db.entities.Order['@changelog'] = [{ '=': 'title' }, { '=': 'type.title' }];

			await POST(`/odata/v4/admin/Order`, {
				ID: '0a41a187-a2ff-4df6-bd12-fae8996e7c44',
				title: 'test Order title'
			});

			const createChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Order',
					attribute: 'title',
					modification: 'create'
				})
			);

			expect(createChanges).toHaveLength(1);
			expect(createChanges[0].objectID).toEqual('test Order title');

			await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e7c44)`, {
				title: 'Order title changed'
			});

			const updateChanges = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Order',
					attribute: 'title',
					modification: 'update'
				})
			);

			expect(updateChanges).toHaveLength(1);
			expect(updateChanges[0].objectID).toEqual('Order title changed');

			delete cds.db.entities.Order['@changelog'];
		});
	});

	describe('Value Data Type', () => {
		it('should record data type for association attributes', async () => {
			await POST(`/odata/v4/admin/OrderItem`, {
				ID: '9a61178f-bfb3-4c17-8d17-c6b4a63e0422',
				order_ID: '6ac4afbf-deda-45ae-88e6-2883157cc010',
				customer_ID: '47f97f40-4f41-488a-b10b-a5725e762d57',
				quantity: 27
			});

			const createChanges = await SELECT.from(ChangeEntity).where({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'customer',
				modification: 'create'
			});

			expect(createChanges).toHaveLength(1);
			expect(createChanges[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'Japan, Honda, Ōsaka',
				valueDataType: 'cds.String, cds.String, cds.String'
			});

			await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
				customer_ID: '5c30d395-db0a-4095-bd7e-d4de3464660a'
			});

			const updateChanges = await SELECT.from(ChangeEntity).where({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'customer',
				modification: 'update'
			});

			expect(updateChanges).toHaveLength(1);
			expect(updateChanges[0]).toMatchObject({
				valueChangedFrom: 'Japan, Honda, Ōsaka',
				valueChangedTo: 'America, Dylan, Dallas',
				valueDataType: 'cds.String, cds.String, cds.String'
			});
		});
	});

	describe('Displayed Value', () => {
		it('should use chained associations as displayed value for OrderItem', async () => {
			await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
				order_ID: '6ac4afbf-deda-45ae-88e6-2883157cc010'
			});

			const changes = await adminService.run(SELECT.from(ChangeView));

			expect(changes).toHaveLength(1);
			expect(changes[0].valueChangedTo).toEqual('some report comment, Post');
		});

		it('should use chained associations as displayed value for Level3Object', async () => {
			await PATCH(`/odata/v4/admin/Level3Object(ID=a40a9fd8-573d-4f41-1111-fb8ea0d8c5cc)`, {
				parent_ID: '55bb60e4-ed86-46e6-9378-346153eba8d4'
			});

			const changes = await adminService.run(
				SELECT.from(ChangeView).where({
					entity: 'sap.capire.bookshop.Level3Object',
					attribute: 'parent',
					modification: 'update'
				})
			);

			expect(changes).toHaveLength(1);
			expect(changes[0].valueChangedTo).toEqual('RootObject title2');
		});
	});

	describe('Custom Actions', () => {
		it('should capture changes from custom actions on child entities', async () => {
			await POST(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/AdminService.activate`);

			const noteChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.OrderItemNote',
				attribute: 'ActivationStatus'
			});

			expect(noteChanges).toHaveLength(1);
			expect(noteChanges[0]).toMatchObject({
				valueChangedFrom: '',
				valueChangedTo: 'VALID',
				entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				parentKey: '9a61178f-bfb3-4c17-8d17-c6b4a63e0097'
			});

			const noteChangeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.Order',
				entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				serviceEntity: 'AdminService.Order'
			});

			expect(noteChangeLogs).toHaveLength(1);
			expect(noteChangeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.Order',
				entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
				serviceEntity: 'AdminService.Order'
			});

			const level2Changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Object',
				attribute: 'title'
			});

			expect(level2Changes).toHaveLength(1);
			expect(level2Changes[0]).toMatchObject({
				valueChangedFrom: 'Level2Object title2',
				valueChangedTo: 'Game Science',
				entityKey: '6ac4afbf-deda-45ae-88e6-2883157cd576',
				parentKey: 'ae0d8b10-84cf-4777-a489-a198d1717c75'
			});

			const level2ChangeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.RootObject',
				entityKey: '6ac4afbf-deda-45ae-88e6-2883157cd576',
				serviceEntity: 'AdminService.RootObject'
			});

			expect(level2ChangeLogs).toHaveLength(1);
			expect(level2ChangeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.RootObject',
				entityKey: '6ac4afbf-deda-45ae-88e6-2883157cd576',
				serviceEntity: 'AdminService.RootObject'
			});
		});
	});

	describe('Special Characters', () => {
		it('should handle special characters in entity keys', async () => {
			await POST(`/odata/v4/admin/RootSample(ID='${encodeURIComponent('/one')}')/child(ID='${encodeURIComponent('/level1one')}')/child(ID='${encodeURIComponent('/level2one')}')/AdminService.activate`);

			const level2Changes = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Sample',
				attribute: 'title'
			});

			expect(level2Changes).toHaveLength(1);
			expect(level2Changes[0]).toMatchObject({
				valueChangedFrom: 'Level2Sample title1',
				valueChangedTo: 'special title',
				entityKey: '/one',
				parentKey: '/level1one',
				objectID: '/level2one, special title, /one'
			});

			const level2ChangeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: '/one',
				serviceEntity: 'AdminService.RootSample'
			});

			expect(level2ChangeLogs).toHaveLength(1);
			expect(level2ChangeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: '/one',
				serviceEntity: 'AdminService.RootSample'
			});

			const rootChanges = await SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.RootSample',
				attribute: 'title'
			});

			expect(rootChanges[0]).toMatchObject({
				valueChangedFrom: 'RootSample title2',
				valueChangedTo: 'Black Myth Zhong Kui',
				entityKey: '/two',
				parentKey: '',
				objectID: '/two, Black Myth Zhong Kui'
			});

			const rootChangeLogs = await SELECT.from(ChangeLog).where({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: '/two',
				serviceEntity: 'AdminService.RootSample'
			});

			expect(rootChangeLogs).toHaveLength(1);
			expect(rootChangeLogs[0]).toMatchObject({
				entity: 'sap.capire.bookshop.RootSample',
				entityKey: '/two',
				serviceEntity: 'AdminService.RootSample'
			});
		});
	});
});
