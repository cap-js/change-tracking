const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, GET, defaults } = cds.test(bookshop);
defaults.auth = { username: 'alice', password: 'admin' };

describe('Expression-based @changelog annotations', () => {
  it('uses expression for objectID when entity has @changelog : [(firstName || lastName)]', async () => {
    const {
      data: { ID }
    } = await POST(`/odata/v4/localization/ExpressionScenarios`, {
      firstName: 'John',
      lastName: 'Doe',
      status_code: 'N'
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=true)/changes`);

    // All create entries should have the expression-based objectID
    const firstNameChange = changes.find((c) => c.attribute === 'firstName' && c.modification === 'create');
    expect(firstNameChange).toBeTruthy();
    expect(firstNameChange.objectID).toEqual('John Doe');
  });

  it('uses expression for label when element has @changelog : (status.code || status.descr)', async () => {
    const {
      data: { ID }
    } = await POST(`/odata/v4/localization/ExpressionScenarios`, {
      firstName: 'Jane',
      lastName: 'Smith',
      status_code: 'N'
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    // Update status to trigger a change
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=true)/LocalizationService.draftEdit`, {});
    await PATCH(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)`, {
      status_code: 'R'
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=true)/changes`);

    const statusChange = changes.find((c) => c.attribute === 'status' && c.modification === 'update');
    expect(statusChange).toBeTruthy();
    // The expression (status.code || ': ' || status.descr) should produce "N: New" and "R: Resolved"
    expect(statusChange.valueChangedFrom).toEqual('N');
    expect(statusChange.valueChangedTo).toEqual('R');
    expect(statusChange.valueChangedFromLabel).toEqual('N: New');
    expect(statusChange.valueChangedToLabel).toEqual('R: Resolved');
    expect(statusChange.objectID).toEqual('Jane Smith');
  });

  it('resolves expression-based objectID using customer name on Incidents', async () => {
    // Incidents entity uses @changelog: [(customer.firstName || ' ' || customer.lastName)]
    const res = await POST(`/odata/v4/processor/Incidents`, {
      customer_ID: '1004161',
      title: 'Network outage in building 7',
      urgency_code: 'M',
      status_code: 'N'
    });
    await POST(`/odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

    await POST(`/odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=true)/ProcessorService.draftEdit`, {});
    await PATCH(`/odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=false)`, {
      status_code: 'A'
    });
    await POST(`/odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/processor/Incidents(ID=${res.data.ID},IsActiveEntity=true)/changes`);

    const statusUpdate = changes.find((c) => c.attribute === 'status' && c.modification === 'update');
    expect(statusUpdate).toBeTruthy();
    // objectID should be the customer's full name from the expression
    expect(statusUpdate.objectID).toBeTruthy();
    expect(statusUpdate.objectID).not.toEqual(res.data.ID);
  });

  it('uses arithmetic expression as label for non-association elements (decimalProp * 2)', async () => {
    // decimalProp uses @changelog: (decimalProp * 2)
    const res = await POST(`/odata/v4/localization/ExpressionScenarios`, {
      firstName: 'Bob',
      lastName: 'Builder',
      status_code: 'N',
      decimalProp: 50
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${res.data.ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${res.data.ID},IsActiveEntity=true)/LocalizationService.draftEdit`, {});
    await PATCH(`/odata/v4/localization/ExpressionScenarios(ID=${res.data.ID},IsActiveEntity=false)`, {
      decimalProp: 250
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${res.data.ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/localization/ExpressionScenarios(ID=${res.data.ID},IsActiveEntity=true)/changes`);

    const decimalChange = changes.find((c) => c.attribute === 'decimalProp' && c.modification === 'update');
    expect(decimalChange).toBeTruthy();
    expect(decimalChange.valueChangedFrom).toEqual('50.0000');
    expect(decimalChange.valueChangedTo).toEqual('250.0000');
    // (decimalProp * 2): old=50 -> '100', new=250 -> '500'
    expect(decimalChange.valueChangedFromLabel).toEqual('100.0000');
    expect(decimalChange.valueChangedToLabel).toEqual('500.0000');
  });

  it('classifies price values using ternary expression label on ExpressionScenarios', async () => {
    // price uses @changelog: [(price < 100 ? 'Budget' : 'Premium')]
    const {
      data: { ID }
    } = await POST(`/odata/v4/localization/ExpressionScenarios`, {
      firstName: 'Alice',
      lastName: 'Johnson',
      status_code: 'N',
      price: 49.99
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=true)/LocalizationService.draftEdit`, {});
    await PATCH(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)`, {
      price: 149.99
    });
    await POST(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=false)/LocalizationService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/localization/ExpressionScenarios(ID=${ID},IsActiveEntity=true)/changes`);

    const priceChange = changes.find((c) => c.attribute === 'price' && c.modification === 'update');
    expect(priceChange).toBeTruthy();
    // (price < 100 ? 'Budget' : 'Premium'): old=49.99 -> 'Budget', new=149.99 -> 'Premium'
    expect(priceChange.valueChangedFromLabel).toEqual('Budget');
    expect(priceChange.valueChangedToLabel).toEqual('Premium');
    expect(priceChange.objectID).toEqual('Alice Johnson');
  });

  describe('reserved keyword element names', () => {
    it("tracks create, update, and delete of elements with reserved SQL keyword name 'order'", async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const rootID = cds.utils.uuid();
      const level1ID = cds.utils.uuid();
      const level2ID = cds.utils.uuid();

      // Create hierarchy with Level2Sample.order = 42 ('order' is a SQL reserved keyword)
      await POST('/odata/v4/variant-testing/RootSample', {
        ID: rootID,
        title: 'Root',
        children: [
          {
            ID: level1ID,
            title: 'Level1',
            children: [{ ID: level2ID, title: 'Level2', order: 42 }]
          }
        ]
      });

      // Verify create change for 'order' attribute
      const createChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.Level2Sample',
        entityKey: level2ID,
        attribute: 'order',
        modification: 'create'
      });
      expect(createChanges.length).toEqual(1);
      expect(createChanges[0].valueChangedFrom).toBeNull();
      expect(createChanges[0].valueChangedTo).toEqual('42');
      expect(createChanges[0].objectID).toEqual(`${level2ID}, Level2, 42`);

      // Update order value
      await PATCH(`/odata/v4/variant-testing/Level2Sample(ID='${level2ID}')`, { order: 99 });

      // Verify update change
      const updateChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.Level2Sample',
        entityKey: level2ID,
        attribute: 'order',
        modification: 'update'
      });
      expect(updateChanges.length).toEqual(1);
      expect(updateChanges[0].valueChangedFrom).toEqual('42');
      expect(updateChanges[0].valueChangedTo).toEqual('99');
      expect(updateChanges[0].objectID).toEqual(`${level2ID}, Level2, 99, ${rootID}`);

      // Delete the Level2Sample entry
      await DELETE(`/odata/v4/variant-testing/Level2Sample(ID='${level2ID}')`);

      // Verify delete change
      const deleteChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.Level2Sample',
        entityKey: level2ID,
        attribute: 'order',
        modification: 'delete'
      });
      expect(deleteChanges.length).toEqual(1);
      expect(deleteChanges[0].valueChangedFrom).toEqual('99');
      expect(deleteChanges[0].valueChangedTo).toBeNull();
      expect(deleteChanges[0].objectID).toEqual(`${level2ID}, Level2, 99`);
    });
  });

  describe('objectID fallback behavior', () => {
    it('builds objectID from all @changelog fields when all are present', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
        ID: parentID,
        title: 'Parent Title',
        children: [{ ID: childID, fieldA: 'Alpha', fieldB: 'Beta', name: 'Child' }]
      });

      const childChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.ObjectIdFallbackChild',
        entityKey: childID,
        attribute: 'fieldA',
        modification: 'create'
      });
      expect(childChanges.length).toEqual(1);
      expect(childChanges[0].objectID).toEqual('Alpha, Beta');
    });

    it('shows <empty> in objectID for NULL @changelog fields when some are present', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
        ID: parentID,
        title: 'Parent Title',
        children: [{ ID: childID, fieldA: 'Alpha', name: 'Child' }]
      });

      const childChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.ObjectIdFallbackChild',
        entityKey: childID,
        attribute: 'fieldA',
        modification: 'create'
      });
      expect(childChanges.length).toEqual(1);
      expect(childChanges[0].objectID).toEqual('Alpha, <empty>');
    });

    it('falls back to entityKey for objectID when all @changelog fields are NULL', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
        ID: parentID,
        title: 'Parent Title',
        children: [{ ID: childID, name: 'Child' }]
      });

      const childChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.ObjectIdFallbackChild',
        entityKey: childID,
        attribute: 'name',
        modification: 'create'
      });
      expect(childChanges.length).toEqual(1);
      expect(childChanges[0].objectID).toEqual(childID);
    });

    it('falls back to entityKey for parent objectID when @changelog field is NULL', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
        ID: parentID,
        children: [{ ID: childID, fieldA: 'Alpha', name: 'Child' }]
      });

      const compositionChanges = await SELECT.from(ChangeView).where({
        entity: 'sap.change_tracking.ObjectIdFallbackParent',
        entityKey: parentID,
        attribute: 'children',
        valueDataType: 'cds.Composition'
      });
      expect(compositionChanges.length).toEqual(1);
      expect(compositionChanges[0].objectID).toEqual(parentID);
    });

    it('composition of one: objectID from child entity @changelog', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const bookStoreID = cds.utils.uuid();
      const registryID = cds.utils.uuid();

      // objectID of BookStores: name, objectID of BookStoreRegistry: code
      await POST(`/odata/v4/admin/BookStores`, {
        ID: bookStoreID,
        name: 'My Bookstore',
        registry: {
          ID: registryID,
          code: 'REG-42',
          validOn: '2024-01-01'
        }
      });
      await POST(`/odata/v4/admin/BookStores(ID=${bookStoreID},IsActiveEntity=false)/AdminService.draftActivate`, {});

      const compositionChange = await SELECT.one.from(ChangeView).where({
        entity: 'sap.capire.bookshop.BookStores',
        entityKey: bookStoreID,
        attribute: 'registry',
        valueDataType: 'cds.Composition'
      });
      expect(compositionChange).toBeTruthy();
      expect(compositionChange.objectID).toEqual('My Bookstore');

      // The child's own change entry should use its own @changelog: [code] as objectID
      const childChange = await SELECT.one.from(ChangeView).where({
        entity: 'sap.capire.bookshop.BookStoreRegistry',
        entityKey: registryID,
        attribute: 'validOn'
      });
      expect(childChange).toBeTruthy();
      expect(childChange.objectID).toEqual('REG-42');
    });

    it('composition of many: objectID from parent entity @changelog', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
        ID: parentID,
        title: 'My Parent',
        children: [{ ID: childID, fieldA: 'Alpha', name: 'Child' }]
      });

      // The composition entry on the parent should use parent's @changelog: [title] as objectID
      const compositionChange = await SELECT.one.from(ChangeView).where({
        entity: 'sap.change_tracking.ObjectIdFallbackParent',
        entityKey: parentID,
        attribute: 'children',
        valueDataType: 'cds.Composition'
      });
      expect(compositionChange).toBeTruthy();
      expect(compositionChange.objectID).toEqual('My Parent');
    });

    it('composition of many: custom objectID via expression on composition field', async () => {
      const variantTesting = await cds.connect.to('VariantTesting');
      const { ChangeView } = variantTesting.entities;

      const parentID = cds.utils.uuid();
      const childID = cds.utils.uuid();

      // TrackingComposition.childrenExplicitMany has @changelog: ('Explicit items from ' || name)
      await POST(`/odata/v4/variant-testing/TrackingComposition`, {
        ID: parentID,
        name: 'Test Parent',
        childrenExplicitMany: [{ ID: childID, title: 'Child Title', price: 10 }]
      });
      await POST(`/odata/v4/variant-testing/TrackingComposition(ID=${parentID},IsActiveEntity=false)/VariantTesting.draftActivate`, {});

      const compositionChange = await SELECT.one.from(ChangeView).where({
        entity: 'sap.change_tracking.TrackingComposition',
        entityKey: parentID,
        attribute: 'childrenExplicitMany',
        valueDataType: 'cds.Composition'
      });
      expect(compositionChange).toBeTruthy();
      expect(compositionChange.objectID).toEqual('Explicit items from Test Parent');
    });
  });
});

describe('ChangeView access restrictions', () => {
  it('rejects direct read of ChangeView from service root with 405', async () => {
    try {
      await GET(`/odata/v4/admin/ChangeView`);
      expect('request').toBe('should have failed');
    } catch (error) {
      expect(error.response.status).toBe(405);
    }
  });

  it('allows direct read of ChangeView when explicitly exposed in the service', async () => {
    const response = await GET(`/odata/v4/processor/ChangeView`);
    expect(response.status).toBe(200);
  });

  it('allows reading changes via entity navigation', async () => {
    const { data: bookStore } = await POST(`/odata/v4/admin/BookStores`, {
      name: 'Access Test Store'
    });
    await POST(`/odata/v4/admin/BookStores(ID=${bookStore.ID},IsActiveEntity=false)/AdminService.draftActivate`, {});

    const response = await GET(`/odata/v4/admin/BookStores(ID=${bookStore.ID},IsActiveEntity=true)/changes`);
    expect(response.status).toBe(200);
    expect(response.data.value.length).toBeGreaterThan(0);
  });
});
