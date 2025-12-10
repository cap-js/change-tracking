const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { data, POST, PATCH, DELETE } = cds.test(bookshop);

let adminService = null;
let ChangeView = null;
let db = null;
let ChangeEntity = null;
let ChangeLog = null;

describe('change log draft disabled test', () => {
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

	it('1.1 Root entity creation - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)', async () => {
		const author = await POST(`/odata/v4/admin/Authors`, {
			name_firstName: 'Sam',
			name_lastName: 'Smiths',
			placeOfBirth: 'test place'
		});

		const changes = await adminService.run(SELECT.from(ChangeView));
		const nameLog = changes.sort((a, b) => a.valueChangedTo - b.valueChangedTo).find((change) => change.attribute === 'Author Name');
		const placeOfBirthLog = changes.find((change) => change.attribute === 'Place Of Birth');

		expect(nameLog).toBeTruthy();
		expect(nameLog.entityKey).toEqual(author.data.ID);
		expect(nameLog.modification).toEqual('Create');
		expect(nameLog.objectID).toEqual('Sam, Smiths');
		expect(nameLog.entity).toEqual('Author');
		expect(!nameLog.parentObjectID).toBeTruthy();
		expect(!nameLog.parentKey).toBeTruthy();
		expect(nameLog.valueChangedFrom).toEqual('');
		expect(nameLog.valueChangedTo).toEqual('Sam');

		expect(placeOfBirthLog).toBeTruthy();
		expect(placeOfBirthLog.entityKey).toEqual(author.data.ID);
		expect(placeOfBirthLog.modification).toEqual('Create');
		expect(placeOfBirthLog.objectID).toEqual('Sam, Smiths');
		expect(placeOfBirthLog.entity).toEqual('Author');
		expect(!placeOfBirthLog.parentObjectID).toBeTruthy();
		expect(!placeOfBirthLog.parentKey).toBeTruthy();
		expect(placeOfBirthLog.valueChangedFrom).toEqual('');
		expect(placeOfBirthLog.valueChangedTo).toEqual('test place');
	});

	it('1.2 Root entity update - should log basic data type changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)', async () => {
		await PATCH(`/odata/v4/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
			placeOfBirth: 'new placeOfBirth'
		});

		const changes = await adminService.run(SELECT.from(ChangeView));
		expect(changes.length).toEqual(1);

		const change = changes[0];
		expect(change.attribute).toEqual('Place Of Birth');
		expect(change.entityKey).toEqual('d4d4a1b3-5b83-4814-8a20-f039af6f0387');
		expect(change.modification).toEqual('Update');
		expect(change.objectID).toEqual('Emily, Brontë');
		expect(change.entity).toEqual('Author');
		expect(!change.parentObjectID).toBeTruthy();
		expect(!change.parentKey).toBeTruthy();
		expect(change.valueChangedFrom).toEqual('Thornton, Yorkshire');
		expect(change.valueChangedTo).toEqual('new placeOfBirth');
	});

	it('1.3 Root entity delete - should delete related changes (ERP4SMEPREPWORKAPPPLAT-32 ERP4SMEPREPWORKAPPPLAT-613)', async () => {
		const author = await POST(`/odata/v4/admin/Authors`, {
			name_firstName: 'Sam',
			name_lastName: 'Smiths',
			placeOfBirth: 'test place'
		});

		const beforeChanges = await adminService.run(SELECT.from(ChangeView));
		expect(beforeChanges.length > 0).toBeTruthy();

		await DELETE(`/odata/v4/admin/Authors(ID=${author.data.ID})`);

		const afterChanges = await adminService.run(SELECT.from(ChangeView));
		expect(afterChanges.length).toEqual(0);
	});

	it('1.4 When the global switch is on, all changelogs should be retained after the root entity is deleted, and a changelog for the deletion operation should be generated', async () => {
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
		expect(beforeChanges.length > 0).toBeTruthy();

		// Test when the root and child entity deletion occur simultaneously
		await DELETE(`/odata/v4/admin/RootObject(ID=${RootObject.data.ID})`);

		const afterChanges = await adminService.run(SELECT.from(ChangeView));
		expect(afterChanges.length).toEqual(8);

		const changelogCreated = afterChanges.filter((ele) => ele.modification === 'Create');
		const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'Delete');

		const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'parentKey', 'serviceEntityPath', 'valueDataType', 'objectID', 'parentObjectID', 'entityKey'];

		let commonItems = changelogCreated.filter((beforeItem) => {
			return changelogDeleted.some((afterItem) => {
				return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
			});
		});

		expect(commonItems.length > 0).toBeTruthy();

		delete cds.services.AdminService.entities.RootObject['@changelog'];
		delete cds.services.AdminService.entities.Level1Object['@changelog'];
		delete cds.services.AdminService.entities.Level2Object['@changelog'];
	});

	it('1.7 When creating or deleting a record with a numeric type of 0 and a boolean type of false, a changelog should also be generated', async () => {
		cds.env.requires['change-tracking'].preserveDeletes = true;
		cds.services.AdminService.entities.Order.elements.netAmount['@changelog'] = true;
		cds.services.AdminService.entities.Order.elements.isUsed['@changelog'] = true;

		await POST(`/odata/v4/admin/Order`, {
			ID: '3e745e35-5974-4383-b60a-2f5c9bdd31ac',
			isUsed: false,
			netAmount: 0
		});

		let changes = await adminService.run(SELECT.from(ChangeView));

		expect(changes.length).toEqual(2);

		const change1 = changes.find((c) => c.attribute === 'netAmount');

		expect(change1).toHaveProperty('entityKey', '3e745e35-5974-4383-b60a-2f5c9bdd31ac');
		expect(change1).toHaveProperty('modification', 'Create');
		expect(change1).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change1.valueChangedFrom).toEqual('');
		expect(Number(change1.valueChangedTo)).toEqual(0);

		const change2 = changes.find((c) => c.attribute === 'isUsed');

		expect(change2).toHaveProperty('entityKey', '3e745e35-5974-4383-b60a-2f5c9bdd31ac');
		expect(change2).toHaveProperty('modification', 'Create');
		expect(change2).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change2.valueChangedFrom).toEqual('');
		expect(change2.valueChangedTo).toEqual('false');

		await DELETE('/odata/v4/admin/Order(ID=3e745e35-5974-4383-b60a-2f5c9bdd31ac)');

		changes = await adminService.run(
			SELECT.from(ChangeView).where({
				modification: 'delete'
			})
		);

		expect(changes.length).toEqual(2);

		const change3 = changes.find((c) => c.attribute === 'netAmount');

		expect(change3).toHaveProperty('entityKey', '3e745e35-5974-4383-b60a-2f5c9bdd31ac');
		expect(change3).toHaveProperty('modification', 'Delete');
		expect(change3).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(Number(change3.valueChangedFrom)).toEqual(0);
		expect(change3.valueChangedTo).toEqual('');

		const change4 = changes.find((c) => c.attribute === 'isUsed');

		expect(change4).toHaveProperty('entityKey', '3e745e35-5974-4383-b60a-2f5c9bdd31ac');
		expect(change4).toHaveProperty('modification', 'Delete');
		expect(change4).toHaveProperty('entity', 'sap.capire.bookshop.Order');
		expect(change4.valueChangedFrom).toEqual('false');
		expect(change4.valueChangedTo).toEqual('');

		delete cds.services.AdminService.entities.Order.elements.netAmount['@changelog'];
		delete cds.services.AdminService.entities.Order.elements.isUsed['@changelog'];
	});

	it('3.1 Composition creatition by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)', async () => {
		await POST(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes`, {
			content: 'new content'
		});
		let changes = await adminService.run(SELECT.from(ChangeView));
		const orderChanges = changes.filter((change) => {
			return change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31';
		});
		expect(orderChanges.length).toEqual(1);
		const orderChange = orderChanges[0];
		expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
		expect(orderChange.attribute).toEqual('content');
		expect(orderChange.modification).toEqual('Create');
		expect(orderChange.valueChangedFrom).toEqual('');
		expect(orderChange.valueChangedTo).toEqual('new content');
		expect(orderChange.parentKey).toEqual('9a61178f-bfb3-4c17-8d17-c6b4a63e0097');
		expect(orderChange.parentObjectID).toEqual('sap.capire.bookshop.OrderItem');

		// Check the changeLog to make sure the entity information is root
		let changeLogs = await SELECT.from(ChangeLog);

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.Order');
		expect(changeLogs[0].entityKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.Order');
	});

	it('3.2 Composition update by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)', async () => {
		await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`, {
			content: 'new content'
		});

		let changes = await adminService.run(SELECT.from(ChangeView));
		const orderChanges = changes.filter((change) => {
			return change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31';
		});
		expect(orderChanges.length).toEqual(1);
		const orderChange = orderChanges[0];
		expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
		expect(orderChange.attribute).toEqual('content');
		expect(orderChange.modification).toEqual('Update');
		expect(orderChange.valueChangedFrom).toEqual('note 1');
		expect(orderChange.valueChangedTo).toEqual('new content');
		expect(orderChange.parentKey).toEqual('9a61178f-bfb3-4c17-8d17-c6b4a63e0097');
		expect(orderChange.parentObjectID).toEqual('sap.capire.bookshop.OrderItem');

		// Check the changeLog to make sure the entity information is root
		let changeLogs = await SELECT.from(ChangeLog);

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.Order');
		expect(changeLogs[0].entityKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.Order');
	});

	it('3.3 Composition delete by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-670)', async () => {
		await DELETE(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)`);

		let changes = await adminService.run(SELECT.from(ChangeView));
		const orderChanges = changes.filter((change) => {
			return change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31';
		});
		expect(orderChanges.length).toEqual(1);
		const orderChange = orderChanges[0];
		expect(orderChange.entity).toEqual('sap.capire.bookshop.OrderItemNote');
		expect(orderChange.attribute).toEqual('content');
		expect(orderChange.modification).toEqual('Delete');
		expect(orderChange.valueChangedFrom).toEqual('note 1');
		expect(orderChange.valueChangedTo).toEqual('');
		expect(orderChange.parentKey).toEqual('9a61178f-bfb3-4c17-8d17-c6b4a63e0097');
		expect(orderChange.parentObjectID).toEqual('sap.capire.bookshop.OrderItem');
	});

	it('3.4 Composition create by odata request on draft disabled entity - should log changes for root entity if url path contains association entity (ERP4SMEPREPWORKAPPPLAT-670)', async () => {
		// Report has association to many Orders, changes on OrderItem shall be logged on Order
		await POST(`/odata/v4/admin/Report(ID=0a41a666-a2ff-4df6-bd12-fae8996e6666)/orders(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems`, {
			order_ID: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
			quantity: 10,
			price: 5
		});

		let changes = await adminService.run(SELECT.from(ChangeView));
		const orderChanges = changes.filter((change) => {
			return change.entityKey === '0a41a187-a2ff-4df6-bd12-fae8996e6e31';
		});
		expect(orderChanges.length).toEqual(2);
	});

	it('3.5 Composition of inline entity for draft disabled entity', async () => {
		await PATCH(`/odata/v4/admin/Order_Items(up__ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,ID=2b23bb4b-4ac7-4a24-ac02-aa10cabd842c)`, {
			quantity: 12.0
		});

		const changes = await adminService.run(SELECT.from(ChangeView));

		expect(changes.length).toEqual(1);
		const change = changes[0];
		expect(change.attribute).toEqual('quantity');
		expect(change.modification).toEqual('Update');
		expect(change.valueChangedFrom).toEqual('10');
		expect(change.valueChangedTo).toEqual('12');
		expect(change.parentKey).toEqual('3b23bb4b-4ac7-4a24-ac02-aa10cabd842c');
		expect(change.keys).toEqual('ID=2b23bb4b-4ac7-4a24-ac02-aa10cabd842c');
	});

	it('4.1 Annotate multiple native and attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)', async () => {
		cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'customer.city' }, { '=': 'order.status' }, { '=': 'price' }, { '=': 'quantity' }];
		await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
			quantity: 14
		});

		let changes = await adminService.run(SELECT.from(ChangeView));
		expect(changes.length).toEqual(1);
		const change = changes[0];
		const IDsegments = change.objectID.split(', ');
		expect(IDsegments[0]).toEqual('Ōsaka');
		expect(IDsegments[1]).toEqual('Post');
		expect(Number(IDsegments[2])).toEqual(5);
		expect(Number(IDsegments[3])).toEqual(14);

		delete cds.services.AdminService.entities.OrderItem['@changelog'];
	});

	it('4.2 Annotate multiple native attributes as the object ID (ERP4SMEPREPWORKAPPPLAT-913)', async () => {
		cds.services.AdminService.entities.Authors['@changelog'] = [{ '=': 'placeOfBirth' }, { '=': 'name.firstName' }, { '=': 'name.lastName' }, { '=': 'placeOfDeath' }, { '=': 'dateOfDeath' }, { '=': 'dateOfBirth' }];
		await PATCH(`/odata/v4/admin/Authors(ID=d4d4a1b3-5b83-4814-8a20-f039af6f0387)`, {
			placeOfBirth: 'new placeOfBirth'
		});

		const changes = await adminService.run(SELECT.from(ChangeView));
		expect(changes.length).toEqual(1);

		const change = changes[0];
		expect(change.objectID).toEqual('new placeOfBirth, Emily, Brontë, Haworth, Yorkshire, 1848-12-19, 1818-07-30');

		cds.services.AdminService.entities.Authors['@changelog'] = [{ '=': 'name.firstName' }, { '=': 'name.lastName' }];
	});

	it('4.3 Annotate multiple attributes comming from one or more associated table as the object ID (ERP4SMEPREPWORKAPPPLAT-913)', async () => {
		cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'customer.city' }, { '=': 'order.status' }, { '=': 'customer.country' }, { '=': 'customer.name' }];
		await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
			quantity: 14
		});

		let changes = await adminService.run(SELECT.from(ChangeView));
		expect(changes.length).toEqual(1);
		const change = changes[0];
		expect(change.objectID).toEqual('Ōsaka, Post, Japan, Honda');

		delete cds.services.AdminService.entities.OrderItem['@changelog'];
	});

	it('5.1 value data type records data type of native attributes of the entity or attributes from association table which are annotated as the displayed value(ERP4SMEPREPWORKAPPPLAT-873)', async () => {
		await POST(`/odata/v4/admin/OrderItem`, {
			ID: '9a61178f-bfb3-4c17-8d17-c6b4a63e0422',
			order_ID: '6ac4afbf-deda-45ae-88e6-2883157cc010',
			customer_ID: '47f97f40-4f41-488a-b10b-a5725e762d57',
			quantity: 27
		});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const customerChangesInDb = await SELECT.from(ChangeEntity).where({
			entity: 'sap.capire.bookshop.OrderItem',
			attribute: 'customer',
			modification: 'create'
		});
		expect(customerChangesInDb.length).toEqual(1);

		const customerChangeInDb = customerChangesInDb[0];
		expect(customerChangeInDb.valueChangedFrom).toEqual('');
		expect(customerChangeInDb.valueChangedTo).toEqual('Japan, Honda, Ōsaka');
		expect(customerChangeInDb.valueDataType).toEqual('cds.String, cds.String, cds.String');

		await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
			customer_ID: '5c30d395-db0a-4095-bd7e-d4de3464660a'
		});

		// valueDataType field only appears in db table Changes
		// there are no localization features for table Changes
		const customerUpdateChangesInDb = await SELECT.from(ChangeEntity).where({
			entity: 'sap.capire.bookshop.OrderItem',
			attribute: 'customer',
			modification: 'update'
		});

		expect(customerUpdateChangesInDb.length).toEqual(1);

		const customerUpdateChangeInDb = customerUpdateChangesInDb[0];
		expect(customerUpdateChangeInDb.valueChangedFrom).toEqual('Japan, Honda, Ōsaka');
		expect(customerUpdateChangeInDb.valueChangedTo).toEqual('America, Dylan, Dallas');
		expect(customerUpdateChangeInDb.valueDataType).toEqual('cds.String, cds.String, cds.String');
	});

	it('7.2 Annotate fields from chained associated entities as objectID (ERP4SMEPREPWORKAPPPLAT-993 ERP4SMEPREPWORKAPPPLAT-4542)', async () => {
		cds.services.AdminService.entities.OrderItem['@changelog'] = [{ '=': 'order.report.comment' }, { '=': 'order.status' }, { '=': 'customer.name' }];
		await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
			quantity: 14
		});

		let changes = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.OrderItem',
				attribute: 'quantity'
			})
		);
		expect(changes.length).toEqual(1);
		const change = changes[0];
		expect(change.objectID).toEqual('some comment, Post, Honda');

		cds.services.AdminService.entities.Level3Object['@changelog'] = [{ '=': 'parent.parent.parent.title' }];
		await POST(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child`, {
			ID: 'a670e8e1-ee06-4cad-9cbd-a2354dc25b8c',
			parent_ID: 'a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc',
			title: 'new L3 title'
		});
		const createChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Object',
				attribute: 'title',
				modification: 'create'
			})
		);
		expect(createChanges.length).toEqual(1);
		const createChange = createChanges[0];
		expect(createChange.objectID).toEqual('RootObject title1');

		await PATCH(`/odata/v4/admin/Level3Object(ID=a670e8e1-ee06-4cad-9cbd-a2354dc25b8c)`, {
			title: 'L3 title changed'
		});
		let updateChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Object',
				attribute: 'title',
				modification: 'update'
			})
		);
		expect(updateChanges.length).toEqual(1);
		const updateChange = updateChanges[0];
		expect(updateChange.objectID).toEqual('RootObject title1');

		await DELETE(`/odata/v4/admin/RootObject(ID=0a41a187-a2ff-4df6-bd12-fae8996e7e28)/child(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0802)/child(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/child(ID=a670e8e1-ee06-4cad-9cbd-a2354dc25b8c)`);
		let deleteChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Object',
				attribute: 'title',
				modification: 'delete'
			})
		);
		expect(deleteChanges.length).toEqual(1);
		const deleteChange = deleteChanges[0];
		expect(deleteChange.objectID).toEqual('RootObject title1');

		// Test object id when parent and child nodes are created at the same time
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

		const createChangesMeanwhile = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Object',
				attribute: 'title',
				modification: 'create'
			})
		);
		expect(createChangesMeanwhile.length).toEqual(1);
		const createChangeMeanwhile = createChangesMeanwhile[0];
		expect(createChangeMeanwhile.objectID).toEqual('new RootObject title');

		// Test the object id when the parent node and child node are modified at the same time
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

		const updateChangesMeanwhile = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Object',
				attribute: 'title',
				modification: 'update'
			})
		);
		expect(updateChangesMeanwhile.length).toEqual(1);
		const updateChangeMeanwhile = updateChangesMeanwhile[0];
		expect(updateChangeMeanwhile.objectID).toEqual('RootObject title changed');

		// Tests the object id when the parent node update and child node deletion occur simultaneously
		await PATCH(`/odata/v4/admin/RootObject(ID=a670e8e1-ee06-4cad-9cbd-a2354dc37c9d)`, {
			title: 'RootObject title del',
			child: []
		});

		const deleteChangesMeanwhile = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level2Object',
				attribute: 'title',
				modification: 'delete'
			})
		);

		expect(deleteChangesMeanwhile.length).toEqual(1);
		const deleteChangeMeanwhile = deleteChangesMeanwhile[0];
		expect(deleteChangeMeanwhile.objectID).toEqual('RootObject title del');

		delete cds.services.AdminService.entities.OrderItem['@changelog'];
		delete cds.services.AdminService.entities.Level2Object['@changelog'];
		delete cds.services.AdminService.entities.Level3Object['@changelog'];

		cds.db.entities.Order['@changelog'] = [{ '=': 'title' }, { '=': 'type.title' }];
		await POST(`/odata/v4/admin/Order`, {
			ID: '0a41a187-a2ff-4df6-bd12-fae8996e7c44',
			title: 'test Order title'
		});

		const createOrderChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'title',
				modification: 'create'
			})
		);

		expect(createOrderChanges.length).toEqual(1);
		const createOrderChange = createOrderChanges[0];
		expect(createOrderChange.objectID).toEqual('test Order title');

		await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e7c44)`, {
			title: 'Order title changed'
		});

		const updateOrderChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Order',
				attribute: 'title',
				modification: 'update'
			})
		);
		expect(updateOrderChanges.length).toEqual(1);
		const updateOrderChange = updateOrderChanges[0];
		expect(updateOrderChange.objectID).toEqual('Order title changed');

		delete cds.db.entities.Order['@changelog'];
	});

	it('8.2 Annotate fields from chained associated entities as displayed value (ERP4SMEPREPWORKAPPPLAT-1094 ERP4SMEPREPWORKAPPPLAT-4542)', async () => {
		await PATCH(`/odata/v4/admin/OrderItem(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)`, {
			order_ID: '6ac4afbf-deda-45ae-88e6-2883157cc010'
		});

		let changes = await adminService.run(SELECT.from(ChangeView));
		expect(changes.length).toEqual(1);
		const change = changes[0];
		expect(change.valueChangedTo).toEqual('some report comment, Post');

		await PATCH(`/odata/v4/admin/Level3Object(ID=a40a9fd8-573d-4f41-1111-fb8ea0d8c5cc)`, {
			parent_ID: '55bb60e4-ed86-46e6-9378-346153eba8d4'
		});
		let updateChanges = await adminService.run(
			SELECT.from(ChangeView).where({
				entity: 'sap.capire.bookshop.Level3Object',
				attribute: 'parent',
				modification: 'update'
			})
		);
		expect(updateChanges.length).toEqual(1);
		const updateChange = updateChanges[0];
		expect(updateChange.valueChangedTo).toEqual('RootObject title2');
	});

	it('10.1 Composition of one creatition by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		await POST(`/odata/v4/admin/Order`, {
			ID: '11234567-89ab-cdef-0123-456789abcdef',
			header: {
				status: 'Ordered'
			}
		});
		const changes = await adminService.run(SELECT.from(ChangeView));
		const headerChanges = changes.filter((change) => {
			return change.entity === 'sap.capire.bookshop.OrderHeader';
		});
		expect(headerChanges.length).toEqual(1);
		const headerChange = headerChanges[0];
		expect(headerChange.attribute).toEqual('status');
		expect(headerChange.modification).toEqual('Create');
		expect(headerChange.valueChangedFrom).toEqual('');
		expect(headerChange.valueChangedTo).toEqual('Ordered');
		expect(headerChange.parentKey).toEqual('11234567-89ab-cdef-0123-456789abcdef');
		expect(headerChange.parentObjectID).toEqual('sap.capire.bookshop.Order');
	});

	it('10.2 Composition of one update by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];
		await PATCH(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)`, {
			header: {
				ID: '8567d0de-d44f-11ed-afa1-0242ac120002',
				status: 'Ordered'
			}
		});

		const changes = await adminService.run(SELECT.from(ChangeView));
		const headerChanges = changes.filter((change) => {
			return change.entity === 'sap.capire.bookshop.OrderHeader';
		});
		expect(headerChanges.length).toEqual(1);
		const headerChange = headerChanges[0];
		expect(headerChange.attribute).toEqual('status');
		expect(headerChange.modification).toEqual('Update');
		expect(headerChange.valueChangedFrom).toEqual('Shipped');
		expect(headerChange.valueChangedTo).toEqual('Ordered');
		expect(headerChange.parentKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(headerChange.parentObjectID).toEqual('Post');
		delete cds.services.AdminService.entities.Order['@changelog'];
	});

	it('10.3 Composition of one delete by odata request on draft disabled entity - should log changes for root entity (ERP4SMEPREPWORKAPPPLAT-2913 ERP4SMEPREPWORKAPPPLAT-3063)', async () => {
		// Check if the object ID obtaining failed due to lacking parentKey would lead to dump
		cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];
		await DELETE(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/header`);

		const changes = await adminService.run(SELECT.from(ChangeView));
		const headerChanges = changes.filter((change) => {
			return change.entity === 'sap.capire.bookshop.OrderHeader';
		});
		expect(headerChanges.length).toEqual(1);
		const headerChange = headerChanges[0];
		expect(headerChange.attribute).toEqual('status');
		expect(headerChange.modification).toEqual('Delete');
		expect(headerChange.valueChangedFrom).toEqual('Shipped');
		expect(headerChange.valueChangedTo).toEqual('');
		expect(headerChange.parentKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(headerChange.parentObjectID).toEqual('Post');
		delete cds.services.AdminService.entities.Order['@changelog'];
	});

	it('11.2 The change log should be captured when a child entity in draft-disabled mode triggers a custom action (ERP4SMEPREPWORKAPPPLAT-6211)', async () => {
		await POST(`/odata/v4/admin/Order(ID=0a41a187-a2ff-4df6-bd12-fae8996e6e31)/orderItems(ID=9a61178f-bfb3-4c17-8d17-c6b4a63e0097)/notes(ID=a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc)/AdminService.activate`);
		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.OrderItemNote',
			attribute: 'ActivationStatus'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual('');
		expect(changes[0].valueChangedTo).toEqual('VALID');
		expect(changes[0].entityKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(changes[0].parentKey).toEqual('9a61178f-bfb3-4c17-8d17-c6b4a63e0097');

		// Check the changeLog to make sure the entity information is root
		let changeLogs = await SELECT.from(ChangeLog).where({
			entity: 'sap.capire.bookshop.Order',
			entityKey: '0a41a187-a2ff-4df6-bd12-fae8996e6e31',
			serviceEntity: 'AdminService.Order'
		});

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.Order');
		expect(changeLogs[0].entityKey).toEqual('0a41a187-a2ff-4df6-bd12-fae8996e6e31');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.Order');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level2Object',
			attribute: 'title'
		});
		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual('Level2Object title2');
		expect(changes[0].valueChangedTo).toEqual('Game Science');
		expect(changes[0].entityKey).toEqual('6ac4afbf-deda-45ae-88e6-2883157cd576');
		expect(changes[0].parentKey).toEqual('ae0d8b10-84cf-4777-a489-a198d1717c75');

		// Check the changeLog to make sure the entity information is root
		changeLogs = await SELECT.from(ChangeLog).where({
			entity: 'sap.capire.bookshop.RootObject',
			entityKey: '6ac4afbf-deda-45ae-88e6-2883157cd576',
			serviceEntity: 'AdminService.RootObject'
		});

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.RootObject');
		expect(changeLogs[0].entityKey).toEqual('6ac4afbf-deda-45ae-88e6-2883157cd576');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.RootObject');
	});

	it('Special Character Handling in draft-disabled - issue#187', async () => {
		await POST(`/odata/v4/admin/RootSample(ID='${encodeURIComponent('/one')}')/child(ID='${encodeURIComponent('/level1one')}')/child(ID='${encodeURIComponent('/level2one')}')/AdminService.activate`);

		let changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.Level2Sample',
			attribute: 'title'
		});

		expect(changes.length).toEqual(1);
		expect(changes[0].valueChangedFrom).toEqual('Level2Sample title1');
		expect(changes[0].valueChangedTo).toEqual('special title');
		expect(changes[0].entityKey).toEqual('/one');
		expect(changes[0].parentKey).toEqual('/level1one');
		expect(changes[0].objectID).toEqual('/level2one, special title, /one');

		// Check the changeLog to make sure the entity information is root
		let changeLogs = await SELECT.from(ChangeLog).where({
			entity: 'sap.capire.bookshop.RootSample',
			entityKey: '/one',
			serviceEntity: 'AdminService.RootSample'
		});

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.RootSample');
		expect(changeLogs[0].entityKey).toEqual('/one');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.RootSample');

		changes = await SELECT.from(ChangeView).where({
			entity: 'sap.capire.bookshop.RootSample',
			attribute: 'title'
		});

		expect(changes[0].valueChangedFrom).toEqual('RootSample title2');
		expect(changes[0].valueChangedTo).toEqual('Black Myth Zhong Kui');
		expect(changes[0].entityKey).toEqual('/two');
		expect(changes[0].parentKey).toEqual('');
		expect(changes[0].objectID).toEqual('/two, Black Myth Zhong Kui');

		// Check the changeLog to make sure the entity information is root
		changeLogs = await SELECT.from(ChangeLog).where({
			entity: 'sap.capire.bookshop.RootSample',
			entityKey: '/two',
			serviceEntity: 'AdminService.RootSample'
		});

		expect(changeLogs.length).toEqual(1);
		expect(changeLogs[0].entity).toEqual('sap.capire.bookshop.RootSample');
		expect(changeLogs[0].entityKey).toEqual('/two');
		expect(changeLogs[0].serviceEntity).toEqual('AdminService.RootSample');
	});
});
