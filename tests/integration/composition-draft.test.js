const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, GET, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('composition tracking (draft)', () => {
  describe('Composition of one', () => {
    it('logs changes on the single child entity during creation', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const orderID = cds.utils.uuid();
      const { data: order } = await POST(`/odata/v4/admin/Order`, {
        ID: orderID,
        header: {
          status: 'Ordered'
        }
      });
      const headerID = order.header_ID;

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[orderID, headerID]}`;
      expect(changes.length).toEqual(2);

      // Order.header composition entry (parent)
      const orderChange = changes.find((c) => c.entityKey === orderID);
      expect(orderChange).toMatchObject({
        entity: 'sap.capire.bookshop.Order',
        attribute: 'header',
        modification: 'create',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      // OrderHeader change linked to parent
      const headerChange = changes.find((c) => c.entityKey === headerID);
      expect(headerChange).toMatchObject({
        entity: 'sap.capire.bookshop.OrderHeader',
        attribute: 'status',
        modification: 'create',
        parent_ID: orderChange.ID,
        valueChangedFrom: null,
        valueChangedTo: 'Ordered'
      });
    });

    it('logs changes on the single child entity during deletion', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const orderID = cds.utils.uuid();
      // Check if the object ID obtaining failed due to lacking rootEntityKey would lead to dump
      cds.services.AdminService.entities.Order['@changelog'] = [{ '=': 'status' }];

      const { data: order } = await POST(`/odata/v4/admin/Order`, {
        ID: orderID,
        header: {
          status: 'Shipped'
        }
      });
      const headerID = order.header_ID;

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[orderID, headerID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      await DELETE(`/odata/v4/admin/Order(ID=${orderID})/header`);

      const changes = await SELECT.from(ChangeView).where({ entityKey: { in: [orderID, headerID] }, transactionID: { '!=': transactionID } });
      expect(changes.length).toEqual(2);

      // Order.header composition entry (parent)
      const orderChange = changes.find((c) => c.entityKey === orderID);
      expect(orderChange).toMatchObject({
        entity: 'sap.capire.bookshop.Order',
        attribute: 'header',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      // OrderHeader change linked to parent
      const headerChange = changes.find((c) => c.entityKey === headerID);
      expect(headerChange).toMatchObject({
        entity: 'sap.capire.bookshop.OrderHeader',
        attribute: 'status',
        modification: 'delete',
        parent_ID: orderChange.ID,
        valueChangedFrom: 'Shipped',
        valueChangedTo: null
      });

      delete cds.services.AdminService.entities.Order['@changelog'];
    });

    // REVISIT: Localization of date values not supported yet
    it('logs changes on child entity during deep create with draft', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const registryID = cds.utils.uuid();

      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'test bookstore name',
        registry: {
          ID: registryID,
          code: 'San Francisco-2',
          validOn: '2022-01-01'
        }
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;

      // BookStores.registry composition entry (parent)
      const registryChange = changes.find((c) => c.attribute === 'registry');
      expect(registryChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStores',
        attribute: 'registry',
        modification: 'create',
        parent_ID: null,
        valueDataType: 'cds.Composition',
        objectID: 'test bookstore name'
      });

      // Registry change linked to parent
      const validOnChange = changes.find((c) => c.attribute === 'validOn');
      expect(validOnChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStoreRegistry',
        attribute: 'validOn',
        modification: 'create',
        parent_ID: registryChange.ID,
        objectID: 'San Francisco-2',
        valueChangedFrom: null,
        // valueChangedTo: 'Jan 1, 2022'
        valueChangedTo: '2022-01-01'
      });
    });

    // REVISIT: Localization of date values not supported yet
    it('logs changes when updating child via deep update on parent entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const registryID = cds.utils.uuid();
      const draftUUID = cds.utils.uuid();

      // Create bookstore with registry using POST to properly support draft
      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'Test Bookstore',
        registry: {
          ID: registryID,
          code: 'TEST-REG',
          validOn: '2022-10-15'
        }
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
      await PATCH(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)`, {
        registry: {
          ID: registryID,
          validOn: '2022-01-01',
          DraftAdministrativeData: {
            DraftUUID: draftUUID
          }
        }
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

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
        objectID: 'TEST-REG'
      });

      // Registry change linked to parent
      const registryChange = changes.find((c) => c.entityKey === registryID);
      expect(registryChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStoreRegistry',
        attribute: 'validOn',
        attributeLabel: 'Valid On',
        modification: 'update',
        parent_ID: bookStoreChange.ID,
        // valueChangedFrom: 'Oct 15, 2022',
        // valueChangedTo: 'Jan 1, 2022'
        valueChangedFrom: '2022-10-15',
        valueChangedTo: '2022-01-01'
      });
    });

    it('logs changes when updating child directly via its own endpoint', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const registryID = cds.utils.uuid();

      // Create bookstore with registry using POST to properly support draft
      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'Test Bookstore',
        registry: {
          ID: registryID,
          code: 'TEST-REG',
          validOn: '2018-09-01'
        }
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, registryID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
      await PATCH(`/odata/v4/admin/BookStoreRegistry(ID=${registryID},IsActiveEntity=false)`, {
        validOn: '2022-01-01'
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

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
        objectID: 'TEST-REG'
      });

      // Registry change linked to parent
      const registryChange = changes.find((c) => c.entityKey === registryID);
      expect(registryChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStoreRegistry',
        attribute: 'validOn',
        attributeLabel: 'Valid On',
        modification: 'update',
        parent_ID: bookStoreChange.ID,
        // intended - localization not supported yet
        // expect(registryChange.valueChangedFrom).toEqual('Sep 1, 2018');
        // expect(registryChange.valueChangedTo).toEqual('Jan 1, 2022');
        valueChangedFrom: '2018-09-01',
        valueChangedTo: '2022-01-01'
      });
    });
  });

  describe('Composition of many', () => {
    it('logs each created child as a separate change on the root entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const book1ID = cds.utils.uuid();
      const book2ID = cds.utils.uuid();

      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'Shakespeare and Company',
        books: [
          { ID: book1ID, title: 'Test Book 1' },
          { ID: book2ID, title: 'Test Book 2' }
        ]
      });

      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      // Composition of many logs on the parent entity (BookStores) since 'books' is an attribute of BookStores
      const changes = await SELECT.from(ChangeView).where({
        entity: 'sap.capire.bookshop.BookStores',
        entityKey: bookStoreID,
        attribute: 'books',
        modification: 'update'
      });

      expect(changes.length).toEqual(1);
      expect(changes[0].entity).toEqual('sap.capire.bookshop.BookStores');
      expect(changes[0].valueChangedFrom).toEqual(null);
      expect(changes[0].valueChangedTo).toEqual(null);
      // Composition-of-many: uses parent's @changelog: [name] as objectID
      expect(changes[0].objectID).toEqual('Shakespeare and Company');

      const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: changes[0].ID });
      expect(relatedChanges.length).toEqual(2);
      const change1 = relatedChanges.find((change) => change.valueChangedTo === 'Test Book 1');
      const change2 = relatedChanges.find((change) => change.valueChangedTo === 'Test Book 2');

      // entity is now the parent (BookStores), not the child (Books)
      expect(change1.entity).toEqual('sap.capire.bookshop.Books');
      expect(change1.entityKey).toEqual(book1ID);
      expect(change1.attribute).toEqual('title');
      expect(change1.valueChangedFrom).toEqual(null);
      expect(change1.valueChangedTo).toEqual('Test Book 1');

      expect(change2.entity).toEqual('sap.capire.bookshop.Books');
      expect(change2.entityKey).toEqual(book2ID);
      expect(change2.attribute).toEqual('title');
      expect(change2.valueChangedFrom).toEqual(null);
      expect(change2.valueChangedTo).toEqual('Test Book 2');
    });

    it('links child entity changes to the root entity when updating nested data', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const bookID = cds.utils.uuid();

      // Create BookStore with a book
      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'Shakespeare and Company',
        books: [{ ID: bookID, title: 'Original Title' }]
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      // Edit draft and update the book title
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
      await PATCH(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`, {
        title: 'Updated Title'
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      // Composition of many logs on the parent entity (BookStores)
      const changes = await SELECT.from(ChangeView).where({
        entity: 'sap.capire.bookshop.BookStores',
        entityKey: bookStoreID,
        attribute: 'books',
        modification: 'update'
      });

      expect(changes.length).toEqual(2);
      const updateChange = changes.find((c) => c.attribute === 'books');
      expect(updateChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStores',
        entityKey: bookStoreID,
        attribute: 'books',
        modification: 'update',
        valueChangedFrom: null,
        valueChangedTo: null,
        objectID: 'Shakespeare and Company'
      });

      // check related changes — the title change should be linked to one of the composition entries
      const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: changes.map((c) => c.ID) });
      const titleChange = relatedChanges.find((c) => c.attribute === 'title' && c.valueChangedFrom === 'Original Title');
      expect(titleChange).toMatchObject({
        entity: 'sap.capire.bookshop.Books',
        entityKey: bookID,
        attribute: 'title',
        valueChangedFrom: 'Original Title',
        valueChangedTo: 'Updated Title'
      });
    });

    it('logs deleted child values as changes on the root entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const bookID = cds.utils.uuid();

      // Create BookStore with a book
      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'Shakespeare and Company',
        books: [{ ID: bookID, title: 'Book to Delete' }]
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      // Edit draft and delete the book
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=true)/AdminService.draftEdit`, {});
      await DELETE(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=false)`);
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[bookStoreID, bookID]}`;

      const bookDeleteChange = changes.find((c) => c.entityKey === bookID && c.modification === 'delete');
      expect(bookDeleteChange).toMatchObject({
        entity: 'sap.capire.bookshop.Books',
        attribute: 'title',
        modification: 'delete',
        valueChangedFrom: 'Book to Delete',
        valueChangedTo: null
      });

      const bookStoreChange = changes.find((c) => c.ID === bookDeleteChange.parent_ID);
      expect(bookStoreChange).toMatchObject({
        entity: 'sap.capire.bookshop.BookStores',
        attribute: 'books',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition',
        // Composition-of-many: uses parent's @changelog: [name] as objectID
        objectID: 'Shakespeare and Company'
      });
    });
  });

  describe('Composition of one (aspect)', () => {
    it('logs changes on aspect child during creation via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectOne: {
          ID: childID,
          aspect: 'Aspect Value One'
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]}`;

      // Parent composition entry
      const parentChange = changes.find((c) => c.entityKey === parentID && c.attribute === 'childrenAspectOne');
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenAspectOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      // Aspect child change linked to parent
      const childChange = changes.find((c) => c.entityKey === compositeKey);
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
        attribute: 'aspect',
        modification: 'create',
        parent_ID: parentChange.ID,
        valueChangedFrom: null,
        valueChangedTo: 'Aspect Value One'
      });
    });

    it('logs changes on aspect child during update via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      // Create with initial value
      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectOne: {
          ID: childID,
          aspect: 'Original Aspect'
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and update aspect child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await PATCH(`/odata/v4/variant-testing/TrackingComposition_childrenAspectOne(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`, {
        aspect: 'Updated Aspect'
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

      // Parent composition entry
      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenAspectOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      // Aspect child change linked to parent
      const childChange = changes.find((c) => c.entityKey === compositeKey);
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
        attribute: 'aspect',
        modification: 'update',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Original Aspect',
        valueChangedTo: 'Updated Aspect'
      });
    });

    it('logs changes on aspect child during deletion via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      // Create with initial value
      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectOne: {
          ID: childID,
          aspect: 'Aspect To Delete'
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and delete the aspect child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await DELETE(`/odata/v4/variant-testing/TrackingComposition_childrenAspectOne(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`);
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenAspectOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === compositeKey && c.modification === 'delete');
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectOne',
        attribute: 'aspect',
        modification: 'delete',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Aspect To Delete',
        valueChangedTo: null
      });
    });
  });

  describe('Composition of many (aspect)', () => {
    it('logs each created aspect child as a separate change on the root entity', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const child1ID = cds.utils.uuid();
      const child2ID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectMany: [
          { ID: child1ID, aspect: 'Aspect Child 1' },
          { ID: child2ID, aspect: 'Aspect Child 2' }
        ]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey1 = `${String(parentID).length},${parentID};${String(child1ID).length},${child1ID}`;
      const compositeKey2 = `${String(parentID).length},${parentID};${String(child2ID).length},${child2ID}`;

      const parentChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.TrackingComposition',
        entityKey: parentID,
        attribute: 'childrenAspectMany',
        modification: 'update'
      });
      expect(parentChanges.length).toEqual(1);
      expect(parentChanges[0].parent_ID).toEqual(null);

      // Child changes linked to parent
      const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: parentChanges[0].ID });
      expect(relatedChanges.length).toEqual(2);

      const change1 = relatedChanges.find((c) => c.valueChangedTo === 'Aspect Child 1');
      expect(change1).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
        entityKey: compositeKey1,
        attribute: 'aspect',
        modification: 'create',
        valueChangedFrom: null,
        valueChangedTo: 'Aspect Child 1'
      });

      const change2 = relatedChanges.find((c) => c.valueChangedTo === 'Aspect Child 2');
      expect(change2).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
        entityKey: compositeKey2,
        attribute: 'aspect',
        modification: 'create',
        valueChangedFrom: null,
        valueChangedTo: 'Aspect Child 2'
      });
    });

    it('links aspect child changes to the root entity when updating nested data', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectMany: [{ ID: childID, aspect: 'Original Aspect' }]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and update the aspect child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await PATCH(`/odata/v4/variant-testing/TrackingComposition_childrenAspectMany(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`, {
        aspect: 'Updated Aspect'
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenAspectMany',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === compositeKey);
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
        attribute: 'aspect',
        modification: 'update',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Original Aspect',
        valueChangedTo: 'Updated Aspect'
      });
    });

    it('logs deleted aspect child values as changes on the root entity', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenAspectMany: [{ ID: childID, aspect: 'Aspect To Delete' }]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and delete the aspect child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await DELETE(`/odata/v4/variant-testing/TrackingComposition_childrenAspectMany(up__ID=${parentID},ID=${childID},IsActiveEntity=false)`);
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositeKey = `${String(parentID).length},${parentID};${String(childID).length},${childID}`;
      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, compositeKey]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenAspectMany',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === compositeKey && c.modification === 'delete');
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition.childrenAspectMany',
        attribute: 'aspect',
        modification: 'delete',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Aspect To Delete',
        valueChangedTo: null
      });
    });
  });

  describe('Composition of one (explicit foreign key)', () => {
    it('logs changes on explicit FK child during creation via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenExplicitOne: {
          ID: childID,
          title: 'Explicit One Title',
          price: 9.99
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]}`;

      // Parent composition entry
      const parentChange = changes.find((c) => c.entityKey === parentID && c.attribute === 'childrenExplicitOne');
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenExplicitOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      // Explicit FK child changes linked to parent
      const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title');
      expect(titleChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionOne',
        attribute: 'title',
        modification: 'create',
        parent_ID: parentChange.ID,
        valueChangedFrom: null,
        valueChangedTo: 'Explicit One Title'
      });

      const priceChange = changes.find((c) => c.entityKey === childID && c.attribute === 'price');
      expect(priceChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionOne',
        attribute: 'price',
        modification: 'create',
        parent_ID: parentChange.ID,
        valueChangedFrom: null,
        valueChangedTo: '9.99'
      });
    });

    it('logs changes on explicit FK child during update via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenExplicitOne: {
          ID: childID,
          title: 'Original Title',
          price: 5.0
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and update explicit FK child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await PATCH(`/odata/v4/variant-testing/ExplicitCompositionOne(ID=${childID},IsActiveEntity=false)`, {
        title: 'Updated Title'
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenExplicitOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === childID);
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionOne',
        attribute: 'title',
        modification: 'update',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Original Title',
        valueChangedTo: 'Updated Title'
      });
    });

    it('logs changes on explicit FK child during deletion via draft', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        childrenExplicitOne: {
          ID: childID,
          title: 'Title To Delete',
          price: 12.5
        }
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and delete the explicit FK child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await DELETE(`/odata/v4/variant-testing/ExplicitCompositionOne(ID=${childID},IsActiveEntity=false)`);
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenExplicitOne',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title' && c.modification === 'delete');
      expect(titleChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionOne',
        attribute: 'title',
        modification: 'delete',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Title To Delete',
        valueChangedTo: null
      });
    });
  });

  describe('Composition of many (explicit foreign key)', () => {
    it('logs each created explicit FK child as a separate change on the root entity', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const child1ID = cds.utils.uuid();
      const child2ID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        name: 'Test Parent',
        childrenExplicitMany: [
          { ID: child1ID, title: 'Explicit Child 1', price: 10.0 },
          { ID: child2ID, title: 'Explicit Child 2', price: 20.0 }
        ]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      // Composition entry on the parent
      const parentChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.TrackingComposition',
        entityKey: parentID,
        attribute: 'childrenExplicitMany',
        modification: 'update'
      });
      expect(parentChanges.length).toEqual(1);
      expect(parentChanges[0].parent_ID).toEqual(null);
      // Composition-of-many: uses expression @changelog: ('Explicit items from ' || name)
      expect(parentChanges[0].objectID).toEqual('Explicit items from Test Parent');

      // Child changes linked to parent
      const relatedChanges = await SELECT.from(ChangeView).where({ parent_ID: parentChanges[0].ID });
      expect(relatedChanges.length).toEqual(4); // 2 children x 2 fields (title + price)

      const title1 = relatedChanges.find((c) => c.entityKey === child1ID && c.attribute === 'title');
      expect(title1).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionMany',
        modification: 'create',
        valueChangedFrom: null,
        valueChangedTo: 'Explicit Child 1'
      });

      const title2 = relatedChanges.find((c) => c.entityKey === child2ID && c.attribute === 'title');
      expect(title2).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionMany',
        modification: 'create',
        valueChangedFrom: null,
        valueChangedTo: 'Explicit Child 2'
      });
    });

    it('links explicit FK child changes to the root entity when updating nested data', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        name: 'Test Parent',
        childrenExplicitMany: [{ ID: childID, title: 'Original Title', price: 5.0 }]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and update explicit FK child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await PATCH(`/odata/v4/variant-testing/ExplicitCompositionMany(ID=${childID},IsActiveEntity=false)`, {
        title: 'Updated Title'
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenExplicitMany',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition',
        // Composition-of-many: uses expression @changelog: ('Explicit items from ' || name)
        objectID: 'Explicit items from Test Parent'
      });

      const childChange = changes.find((c) => c.entityKey === childID);
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionMany',
        attribute: 'title',
        modification: 'update',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Original Title',
        valueChangedTo: 'Updated Title'
      });
    });

    it('logs deleted explicit FK child values as changes on the root entity', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        name: 'Test Parent',
        childrenExplicitMany: [{ ID: childID, title: 'Title To Delete', price: 15.0 }]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changesBefore = await SELECT.from(ChangeView).where({ entityKey: parentID });
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Edit draft and delete explicit FK child
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=true)/VariantTesting.draftEdit`, {});
      await DELETE(`/odata/v4/variant-testing/ExplicitCompositionMany(ID=${childID},IsActiveEntity=false)`);
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentID, childID]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentID);
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.TrackingComposition',
        attribute: 'childrenExplicitMany',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition',
        // Composition-of-many: uses expression @changelog: ('Explicit items from ' || name)
        objectID: 'Explicit items from Test Parent'
      });

      const titleChange = changes.find((c) => c.entityKey === childID && c.attribute === 'title' && c.modification === 'delete');
      expect(titleChange).toMatchObject({
        entity: 'sap.change_tracking.ExplicitCompositionMany',
        attribute: 'title',
        modification: 'delete',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Title To Delete',
        valueChangedTo: null
      });
    });
  });

  describe('Composition of aspect with composite-key parent', () => {
    it('tracks create on inline composition child when parent has composite keys', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const year = Math.floor(Math.random() * 9000) + 1000;
      const code = cds.utils.uuid().slice(0, 8);
      const itemID = cds.utils.uuid();

      await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
        year,
        code,
        title: 'Composite Parent',
        items: [{ ID: itemID, value: 'Item One' }]
      });

      const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
      // Child key: up__year, up__code, ID — 3 composite key parts
      const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;

      const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent',
        attribute: 'items',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value');
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent.items',
        attribute: 'value',
        modification: 'create',
        parent_ID: parentChange.ID,
        valueChangedFrom: null,
        valueChangedTo: 'Item One'
      });
    });

    it('tracks update on inline composition child when parent has composite keys', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const year = Math.floor(Math.random() * 9000) + 1000;
      const code = cds.utils.uuid().slice(0, 8);
      const itemID = cds.utils.uuid();

      // Create initial data
      await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
        year,
        code,
        title: 'Composite Parent',
        items: [{ ID: itemID, value: 'Original' }]
      });

      const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
      const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;
      const transactionID = changesBefore[0]?.transactionID;

      await PATCH(`/odata/v4/variant-testing/CompositeKeyParent(year=${year},code='${code}')`, {
        items: [{ ID: itemID, value: 'Updated' }]
      });

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent',
        attribute: 'items',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value');
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent.items',
        attribute: 'value',
        modification: 'update',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'Original',
        valueChangedTo: 'Updated'
      });
    });

    it('tracks delete on inline composition child when parent has composite keys', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const year = Math.floor(Math.random() * 9000) + 1000;
      const code = cds.utils.uuid().slice(0, 8);
      const itemID = cds.utils.uuid();

      // Create initial data
      await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
        year,
        code,
        title: 'Composite Parent',
        items: [{ ID: itemID, value: 'To Delete' }]
      });

      const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
      const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]}`;
      const transactionID = changesBefore[0]?.transactionID;

      await PATCH(`/odata/v4/variant-testing/CompositeKeyParent(year=${year},code='${code}')`, {
        items: []
      });

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[parentKey, childKey]} and transactionID != ${transactionID}`;

      const parentChange = changes.find((c) => c.entityKey === parentKey && c.attribute === 'items');
      expect(parentChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent',
        attribute: 'items',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const childChange = changes.find((c) => c.entityKey === childKey && c.attribute === 'value' && c.modification === 'delete');
      expect(childChange).toMatchObject({
        entity: 'sap.change_tracking.CompositeKeyParent.items',
        attribute: 'value',
        modification: 'delete',
        parent_ID: parentChange.ID,
        valueChangedFrom: 'To Delete',
        valueChangedTo: null
      });
    });
  });
});
