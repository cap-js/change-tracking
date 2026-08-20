const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, PATCH, GET, defaults } = cds.test(bookshop);
defaults.auth = { username: 'alice', password: '' };

describe('Service-specific tracking with @changelog: false', () => {
  it('only tracks changes when @changelog is defined on the specific service entity', async () => {
    // Create via CatalogService (no @changelog) - should NOT be tracked
    const { data: newStore } = await POST(`/odata/v4/browse/BookStores`, {
      name: 'New book store via browse'
    });

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/admin/BookStores(ID=${newStore.ID},IsActiveEntity=true)/changes`);
    expect(changes.length).toEqual(0);

    // Create via AdminService (has @changelog) - SHOULD be tracked
    const { data: newStore2 } = await POST(`/odata/v4/admin/BookStores`, {
      name: 'New book store via admin'
    });
    await POST(`/odata/v4/admin/BookStores(ID=${newStore2.ID},IsActiveEntity=false)/AdminService.draftActivate`, {});
    const {
      data: { value: changes2 }
    } = await GET(`/odata/v4/admin/BookStores(ID=${newStore2.ID},IsActiveEntity=true)/changes`);
    expect(changes2.length).toEqual(2);
    const nameChange = changes2.find((change) => change.attribute === 'name');

    expect(nameChange).toMatchObject({
      entity: 'sap.capire.bookshop.BookStores',
      attribute: 'name',
      valueChangedFrom: null,
      valueChangedTo: 'New book store via admin'
    });
  });

  it('tracks changes via all services when @changelog is defined on the DB entity', async () => {
    const { data: newIncident } = await POST(`/odata/v4/processor/Incidents`, {
      title: 'Test incident for inheritance',
      date: '2025-01-15'
    });
    await POST(`/odata/v4/processor/Incidents(ID=${newIncident.ID},IsActiveEntity=false)/ProcessorService.draftActivate`, {});

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/processor/Incidents(ID=${newIncident.ID},IsActiveEntity=true)/changes`);

    // Should have changelog entries because DB entity has @changelog
    expect(changes.length).toBeGreaterThan(0);

    const dateChange = changes.find((c) => c.attribute === 'status');
    expect(dateChange).toMatchObject({
      entity: 'sap.capire.incidents.Incidents',
      attribute: 'status',
      valueChangedTo: 'N',
      valueChangedToLabel: 'New'
    });
  });

  it('disables all tracking for a service annotated with @changelog: false', async () => {
    // IncidentsAdminService has @changelog: false at service level
    // Even though DB entity has @changelog, changes via this service should NOT be tracked
    const { data: newIncident } = await POST(`/odata/v4/incidents-admin/Incidents`, {
      title: 'Test incident via admin',
      date: '2025-02-20'
    });

    const changes = await SELECT.from('sap.changelog.Changes').where({
      entity: 'sap.capire.incidents.Incidents',
      entityKey: newIncident.ID
    });

    expect(changes.length).toEqual(0);
  });

  it('excludes specific fields annotated with @changelog: false from tracking', async () => {
    // AdminService.Customers.city has @changelog: false
    // city should NOT be tracked, but name, country, and age SHOULD be tracked
    const { data: newCustomer } = await POST(`/odata/v4/admin/Customers`, {
      name: 'Test customer for element skip', // also skipped since @Personal.data
      city: 'Munich',
      country: 'Germany',
      age: 30
    });

    const {
      data: { value: changes }
    } = await GET(`/odata/v4/admin/Customers(ID=${newCustomer.ID})/changes`);

    const ageChange = changes.find((c) => c.attribute === 'age');
    expect(ageChange).toBeTruthy();
    expect(ageChange.valueChangedTo).toBe('30');

    const cityChange = changes.find((c) => c.attribute === 'city');
    expect(cityChange).toBeFalsy();
  });

  it('tracks direct database modifications when DB entity has @changelog', async () => {
    // sap.capire.incidents.Incidents has @changelog at DB level
    // Direct INSERT into DB entity SHOULD be tracked
    const { Incidents } = cds.entities('sap.capire.incidents');
    const incidentID = cds.utils.uuid();

    await INSERT.into(Incidents).entries({
      ID: incidentID,
      title: 'Direct DB incident',
      date: '2025-03-10'
    });

    // Query changes from changelog table
    const changes = await SELECT.from('sap.changelog.Changes').where({
      entity: 'sap.capire.incidents.Incidents',
      entityKey: incidentID
    });

    // Should have changelog entries because DB entity has @changelog
    expect(changes.length).toBeGreaterThan(0);

    const dateChange = changes.find((c) => c.attribute === 'date');
    expect(dateChange).toBeTruthy();
    expect(dateChange.valueChangedTo).toEqual('2025-03-10');
  });

  it('honors @changelog: false on a nested composition-of-many target during a deep write', async () => {
    // SkipRoot -> mids[] (SkipMid) -> leaves[] (SkipLeaf); SkipLeaf is @changelog: false.
    // The leaf sits below a composition-of-many, so its skip must survive nested traversal.
    const rootID = cds.utils.uuid();
    const leafID = cds.utils.uuid();
    await POST('/odata/v4/variant-testing/SkipRoot', {
      ID: rootID,
      title: 'root',
      mids: [{ ID: cds.utils.uuid(), label: 'mid', leaves: [{ ID: leafID, note: 'LEAF-NOTE' }] }]
    });

    const leafChanges = await SELECT.from('sap.changelog.Changes').where({ entity: 'sap.change_tracking.SkipLeaf', entityKey: leafID });
    expect(leafChanges).toEqual([]);
  });

  it('Should not track if entity is annotated @changelog: false', async () => {
    const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
      number: 1,
      bool: true,
      title: 'My test-record'
    });

    await PATCH(`/odata/v4/variant-testing/NotTrackedDifferentFieldTypes(ID=${record.ID})`, {
      number: 2,
      bool: false
    });

    const changes = await SELECT.from('sap.changelog.Changes').where({
      entity: 'sap.change_tracking.DifferentFieldTypes',
      entityKey: record.ID
    });

    const createChanges = changes.filter((c) => c.modification === 'create');
    const updateChanges = changes.filter((c) => c.modification === 'update');
    expect(createChanges.length).toEqual(3);
    expect(updateChanges.length).toEqual(0);
  });
});
