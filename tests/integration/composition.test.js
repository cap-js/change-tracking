const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('composition tracking', () => {
  it('does not link child entity changes to the root entity when composition field is annotated with @changelog false', async () => {
    const variantService = await cds.connect.to('VariantTesting');
    const { ChangeView } = variantService.entities;

    const parentID = cds.utils.uuid();
    const childID = cds.utils.uuid();
    await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
      ID: parentID,
      title: 'Parent record',
      children: [{ ID: childID, double: 3.14 }]
    });

    const changes = await SELECT.one.from(ChangeView).where({ entityKey: childID, attribute: 'double' });
    expect(changes.entity).toEqual('sap.change_tracking.DifferentFieldTypesChildren');
    expect(changes.attribute).toEqual('double');
    expect(changes.modification).toEqual('create');
    expect(changes.valueChangedFrom).toEqual(null);
    expect(changes.valueChangedTo).toEqual('3.14');
    expect(changes.parent_ID).toEqual(null);
  });

  it('automatically links child entity changes to the root entity for auto-tracked compositions', async () => {
    const processorService = await cds.connect.to('ProcessorService');
    const { ChangeView } = processorService.entities;

    const incidentsID = cds.utils.uuid();
    const taskID = cds.utils.uuid();
    await POST(`/odata/v4/processor/Incidents`, {
      ID: incidentsID,
      tasks: [{ ID: taskID, title: 'Fix bug', description: 'Fix the login bug' }]
    });
    await POST(`/odata/v4/processor/Incidents(ID=${incidentsID}, IsActiveEntity=false)/ProcessorService.draftActivate`, {});

    const parentChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.capire.incidents.Incidents',
      entityKey: incidentsID,
      attribute: 'tasks',
      valueDataType: 'cds.Composition'
    });
    expect(parentChanges.length).toEqual(1);
    expect(parentChanges[0].parent_ID).toEqual(null);

    // Child changes should be linked to the parent composition entry
    const childChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.capire.incidents.IncidentTasks',
      entityKey: taskID,
      parent_ID: parentChanges[0].ID
    });
    expect(childChanges.length).toEqual(2); // title + description

    const titleChange = childChanges.find((c) => c.attribute === 'title');
    expect(titleChange).toMatchObject({
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: 'Fix bug'
    });

    const descChange = childChanges.find((c) => c.attribute === 'description');
    expect(descChange).toMatchObject({
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: 'Fix the login bug'
    });
  });

  // Limitation because deep queries are not run in sequential order
  it.skip('links child entity changes to the root entity when deep creating nested data', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const orderItemNoteID = cds.utils.uuid();
    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      orderItems: [{ ID: orderItemID, notes: [{ ID: orderItemNoteID, content: 'new content' }] }]
    });
    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, orderItemNoteID]}`;
    expect(changes.length).toEqual(4);

    // Find the new Order.orderItems entry (different from the one created during initial POST)
    const orderChange = changes.find((c) => c.entityKey === orderID);
    expect(orderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: null,
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    const orderItemChanges = changes.filter((c) => c.entityKey === orderItemID);
    expect(orderItemChanges.length).toEqual(2);

    const orderItemChangeOrder = orderItemChanges.find((c) => c.attribute === 'order');
    expect(orderItemChangeOrder).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'order',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: orderID,
      parent_ID: orderChange.ID,
      valueDataType: 'cds.Association'
    });

    const orderItemChangeNotes = orderItemChanges.find((c) => c.attribute === 'notes');
    expect(orderItemChangeNotes).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'notes',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: null,
      parent_ID: orderChange.ID,
      valueDataType: 'cds.Composition'
    });

    const orderItemNoteChange = changes.find((c) => c.entityKey === orderItemNoteID);
    expect(orderItemNoteChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItemNote',
      attribute: 'content',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: 'new content',
      parent_ID: orderItemChangeNotes.ID,
      valueDataType: 'cds.String'
    });
  });
  it('links child entity changes to the root entity when creating nested data', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const orderItemNoteID = cds.utils.uuid();
    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      title: 'Test Order', // Provide title to ensure Order has a 'create' changelog entry
      orderItems: [{ ID: orderItemID }]
    });

    // Check changes before creating OrderItemNote
    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID]}`;
    expect(changesBefore.length).toEqual(3); // +1 for Order.title 'create' entry
    const orderChangeBefore = changesBefore.find((c) => c.entityKey === orderID && c.attribute === 'orderItems');
    expect(orderChangeBefore).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'update',
      valueChangedFrom: null,
      valueChangedTo: null,
      parent_ID: null
    });

    const orderItemChangeBefore = changesBefore.find((c) => c.entityKey === orderItemID);
    expect(orderItemChangeBefore).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'order',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: orderID,
      parent_ID: orderChangeBefore.ID
    });

    await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes`, {
      ID: orderItemNoteID,
      content: 'new content'
    });
    // Should create new change for field orderItems on Order with a link to OrderItemNote change (three new changes in total)
    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, orderItemNoteID]}`;
    expect(changes.length).toEqual(6); // +1 for Order.title 'create' entry

    // Find the new Order.orderItems entry (different from the one created during initial POST)
    const newOrderChange = changes.find((c) => c.entityKey === orderID && c.attribute === 'orderItems' && c.ID !== orderChangeBefore.ID);
    expect(newOrderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'update',
      valueChangedFrom: null,
      valueChangedTo: null,
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    // The OrderItem entry should be for the 'notes' composition field, linking to the Order.orderItems entry
    const noteChange = changes.find((c) => c.entityKey === orderItemID && c.ID !== orderItemChangeBefore.ID);
    expect(noteChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'notes',
      modification: 'update',
      valueChangedFrom: null,
      valueChangedTo: null,
      parent_ID: newOrderChange.ID,
      valueDataType: 'cds.Composition'
    });

    const orderItemNoteChange = changes.find((c) => c.entityKey === orderItemNoteID);
    expect(orderItemNoteChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItemNote',
      attribute: 'content',
      modification: 'create',
      valueChangedFrom: null,
      valueChangedTo: 'new content',
      parent_ID: noteChange.ID
    });
  });

  it('logs updated child values as changes on the parent entity', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const noteID = cds.utils.uuid();

    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'original note' }] }]
    });

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]}`;
    expect(changesBefore.length).toBeGreaterThan(0);
    const transactionID = changesBefore[0].transactionID;

    await PATCH(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`, {
      content: 'new content'
    });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]} and transactionID != ${transactionID}`;
    expect(changes.length).toEqual(3);

    const orderChange = changes.find((c) => c.entityKey === orderID);
    expect(orderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    const orderItemChange = changes.find((c) => c.entityKey === orderItemID);
    expect(orderItemChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'notes',
      modification: 'update',
      parent_ID: orderChange.ID,
      valueDataType: 'cds.Composition'
    });

    const orderItemNoteChange = changes.find((c) => c.entityKey === noteID);
    expect(orderItemNoteChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItemNote',
      attribute: 'content',
      modification: 'update',
      parent_ID: orderItemChange.ID,
      valueDataType: 'cds.String'
    });
  });

  it('links child entity changes to the root entity when deleting nested data', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const noteID = cds.utils.uuid();
    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      orderItems: [{ ID: orderItemID, notes: [{ ID: noteID, content: 'note to delete' }] }]
    });

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]}`;
    expect(changesBefore.length).toBeGreaterThan(0);
    const transactionID = changesBefore[0].transactionID;

    await DELETE(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})`);

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, noteID]} and transactionID != ${transactionID}`;
    expect(changes.length).toEqual(3);

    const orderChange = changes.find((c) => c.entityKey === orderID);
    expect(orderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    const orderItemChange = changes.find((c) => c.entityKey === orderItemID);
    expect(orderItemChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      attribute: 'notes',
      modification: 'update',
      parent_ID: orderChange.ID,
      valueDataType: 'cds.Composition'
    });

    const noteChange = changes.find((c) => c.entityKey === noteID);
    expect(noteChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItemNote',
      attribute: 'content',
      modification: 'delete',
      valueChangedFrom: 'note to delete',
      valueChangedTo: null,
      parent_ID: orderItemChange.ID
    });
  });

  it('correctly identifies root entity when URL path contains associated entities', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const reportID = cds.utils.uuid();
    const orderID = cds.utils.uuid();
    // Report has association to many Orders, changes on OrderItem shall be logged on Order
    await POST(`/odata/v4/admin/Report`, {
      ID: reportID
    });
    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      report_ID: reportID,
      title: 'Test Order' // Provide title to ensure Order has a 'create' changelog entry
    });

    const { data: orderItem } = await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems`, {
      order_ID: orderID,
      quantity: 10,
      price: 5
    });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItem.ID]}`;
    expect(changes.length).toEqual(4); // +1 for Order.title 'create' entry

    // Order.orderItems composition entry should exist with parent_ID = null
    const orderChange = changes.find((c) => c.entityKey === orderID && c.attribute === 'orderItems');
    expect(orderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'orderItems',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    // OrderItem entry should link to Order.orderItems entry
    const orderItemChange = changes.filter((c) => c.entityKey === orderItem.ID);
    expect(orderItemChange.length).toEqual(2);
    const quantityChange = orderItemChange.find((c) => c.attribute === 'quantity');
    expect(quantityChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      modification: 'create',
      parent_ID: orderChange.ID
    });

    const orderItemOrderChange = orderItemChange.find((c) => c.attribute === 'order');
    expect(orderItemOrderChange).toMatchObject({
      entity: 'sap.capire.bookshop.OrderItem',
      modification: 'create',
      parent_ID: orderChange.ID
    });
  });

  it('tracks changes on child entities during deep update operations', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView, BookStores } = adminService.entities;

    const bookStoreID = cds.utils.uuid();
    const bookID = cds.utils.uuid();
    await INSERT.into(BookStores).entries({
      ID: bookStoreID,
      name: 'Shakespeare and Company',
      books: [{ ID: bookID, title: 'Old Wuthering Heights Test', author_ID: 'd4d4a1b3-5b83-4814-8a20-f039af6f0387' }]
    });

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]}`;
    expect(changesBefore.length).toBeGreaterThan(0);
    const transactionID = changesBefore[0].transactionID;

    // Update the book title through deep update on existing data
    await UPDATE(BookStores)
      .where({ ID: bookStoreID })
      .with({
        books: [{ ID: bookID, title: 'Wuthering Heights Test' }]
      });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]} and transactionID != ${transactionID}`;
    expect(changes.length).toEqual(2);

    // BookStores.books composition entry
    const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
    expect(bookStoreChange).toMatchObject({
      entity: 'sap.capire.bookshop.BookStores',
      attribute: 'books',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition',
      // Composition-of-many: uses parent's @changelog: [name] as objectID
      objectID: 'Shakespeare and Company'
    });

    // Books.title field change linked to parent
    const bookChange = changes.find((c) => c.entityKey === bookID);
    expect(bookChange).toMatchObject({
      entity: 'sap.capire.bookshop.Books',
      attribute: 'title',
      modification: 'update',
      parent_ID: bookStoreChange.ID,
      objectID: 'Wuthering Heights Test, Emily, Brontë',
      valueChangedFrom: 'Old Wuthering Heights Test',
      valueChangedTo: 'Wuthering Heights Test'
    });
  });

  it('tracks changes on inline composition elements with composite keys', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const compositeKey = `${String(orderID).length},${orderID};${String(orderItemID).length},${orderItemID}`;

    await POST(`/odata/v4/admin/Order`, {
      ID: orderID,
      Items: [
        {
          ID: orderItemID,
          quantity: 10
        }
      ]
    });

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, orderItemID, compositeKey]}`;
    expect(changesBefore.length).toBeGreaterThan(0);
    const transactionID = changesBefore[0].transactionID;

    await PATCH(`/odata/v4/admin/Order(ID=${orderID})/Items(ID=${orderItemID})`, {
      quantity: 12
    });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, compositeKey]} and transactionID != ${transactionID}`;
    expect(changes.length).toEqual(2);

    // Order composition entry (parent)
    const orderChange = changes.find((c) => c.entityKey === orderID);
    expect(orderChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order',
      attribute: 'Items',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition'
    });

    // Inline item change linked to parent
    const itemChange = changes.find((c) => c.entityKey === compositeKey);
    expect(itemChange).toMatchObject({
      entity: 'sap.capire.bookshop.Order.Items',
      attribute: 'quantity',
      modification: 'update',
      parent_ID: orderChange.ID,
      valueChangedFrom: '10',
      valueChangedTo: '12'
    });
  });

  it('tracks deletion of child entities during deep delete operations', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView, BookStores } = adminService.entities;

    const bookStoreID = cds.utils.uuid();
    const registryID = cds.utils.uuid();

    await adminService.run(
      INSERT.into(BookStores).entries({
        ID: bookStoreID,
        name: 'Test Bookstore',
        registry: {
          ID: registryID,
          code: 'TEST-1',
          validOn: '2012-01-01'
        }
      })
    );

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
    expect(changesBefore.length).toBeGreaterThan(0);
    const transactionID = changesBefore[0].transactionID;

    await UPDATE(BookStores).where({ ID: bookStoreID }).with({
      registry: null,
      registry_ID: null
    });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]} and transactionID != ${transactionID}`;
    expect(changes.length).toEqual(2);

    // BookStores.registry composition entry (parent)
    const bookStoreChange = changes.find((c) => c.entityKey === bookStoreID);
    expect(bookStoreChange).toMatchObject({
      entity: 'sap.capire.bookshop.BookStores',
      attribute: 'registry',
      modification: 'update',
      parent_ID: null,
      valueDataType: 'cds.Composition',
      // BookStoreRegistry objectID : [code]
      objectID: 'TEST-1'
    });

    // Registry change linked to parent
    const registryChange = changes.find((c) => c.entityKey === registryID);
    expect(registryChange).toMatchObject({
      entity: 'sap.capire.bookshop.BookStoreRegistry',
      attribute: 'validOn',
      modification: 'delete',
      parent_ID: bookStoreChange.ID,
      objectID: 'TEST-1',
      valueChangedFrom: '2012-01-01',
      valueChangedTo: null
    });
  });

  it('links child field changes to the parent composition entry on create, even when a DB-level select-* view (VersionsForLock) is defined', async () => {
    // DB-level view doing `select * from ParentEntity { * }` inherits composition and overrides the map
    // VersionWithAssignments  { assignments: Composition of many VersionAssignment }
    // VersionsForLock as select from VersionWithAssignments { * }
    const variantService = await cds.connect.to('VariantTesting');
    const { ChangeView } = variantService.entities;

    const versionID = cds.utils.uuid();
    const assignmentID = cds.utils.uuid();

    await POST(`/odata/v4/variant-testing/VersionWithAssignments`, {
      ID: versionID,
      title: 'v1',
      assignments: [{ ID: assignmentID, tag: 'alpha' }]
    });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[versionID, assignmentID]}`;

    // There must be a cds.Composition entry for VersionWithAssignments.assignments
    const compositionEntry = changes.find((c) => c.entity === 'sap.change_tracking.VersionWithAssignments' && c.valueDataType === 'cds.Composition');
    expect(compositionEntry).toBeDefined();
    expect(compositionEntry).toMatchObject({
      entity: 'sap.change_tracking.VersionWithAssignments',
      entityKey: versionID,
      attribute: 'assignments',
      valueDataType: 'cds.Composition',
      parent_ID: null
    });

    // VersionAssignment field changes must be linked to that composition entry
    const assignmentChanges = changes.filter((c) => c.entityKey === assignmentID);
    expect(assignmentChanges.length).toBeGreaterThan(0);
    for (const change of assignmentChanges) {
      expect(change.parent_ID).toEqual(compositionEntry.ID);
    }
  });

  it('links child field changes to the parent composition entry on update, even when a DB-level select-* view (VersionsForLock) is defined', async () => {
    const variantService = await cds.connect.to('VariantTesting');
    const { ChangeView } = variantService.entities;

    const versionID = cds.utils.uuid();
    const assignmentID = cds.utils.uuid();

    await POST(`/odata/v4/variant-testing/VersionWithAssignments`, {
      ID: versionID,
      title: 'v1',
      assignments: [{ ID: assignmentID, tag: 'alpha' }]
    });

    const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[versionID, assignmentID]}`;
    const txBefore = changesBefore[0].transactionID;

    await PATCH(`/odata/v4/variant-testing/VersionAssignment(ID=${assignmentID})`, { tag: 'beta' });

    const changes = await SELECT.from(ChangeView).where`entityKey in ${[versionID, assignmentID]} and transactionID != ${txBefore}`;

    // There must be a cds.Composition entry for the update on VersionWithAssignments.assignments
    const compositionEntry = changes.find((c) => c.entity === 'sap.change_tracking.VersionWithAssignments' && c.valueDataType === 'cds.Composition');
    expect(compositionEntry).toBeDefined();
    expect(compositionEntry).toMatchObject({
      entityKey: versionID,
      attribute: 'assignments',
      modification: 'update',
      parent_ID: null
    });

    // The tag field change must be linked to that composition entry
    const tagChange = changes.find((c) => c.entityKey === assignmentID && c.attribute === 'tag');
    expect(tagChange).toBeDefined();
    expect(tagChange).toMatchObject({
      modification: 'update',
      valueChangedFrom: 'alpha',
      valueChangedTo: 'beta',
      parent_ID: compositionEntry.ID
    });
  });
});
