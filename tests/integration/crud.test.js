const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, GET, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('change log generation', () => {
  describe('Basic CRUD operations', () => {
    it('logs field values when creating a new record', async () => {
      const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
        number: 1,
        bool: true,
        title: 'My test-record'
      });

      const {
        data: { value: changes }
      } = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes`);
      const numberLog = changes.find((change) => change.attribute === 'number');
      const boolLog = changes.find((change) => change.attribute === 'bool');

      expect(numberLog).toBeTruthy();
      expect(numberLog).toMatchObject({
        entityKey: record.ID,
        modification: 'create',
        modificationLabel: 'Create',
        objectID: 'My test-record',
        entity: 'sap.change_tracking.DifferentFieldTypes',
        entityLabel: 'Different field types',
        valueChangedFrom: null
      });
      expect(parseFloat(numberLog.valueChangedTo)).toBe(1);

      expect(boolLog).toBeTruthy();
      expect(boolLog).toMatchObject({
        entityKey: record.ID,
        modification: 'create',
        modificationLabel: 'Create',
        objectID: 'My test-record',
        entity: 'sap.change_tracking.DifferentFieldTypes',
        entityLabel: 'Different field types',
        valueChangedFrom: null,
        valueChangedTo: 'true'
      });
    });

    it('logs old and new values when updating a record', async () => {
      const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
        number: 1,
        title: 'My test-record'
      });
      await PATCH(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})`, {
        bool: true
      });

      const {
        data: { value: changes }
      } = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes?$filter=modification eq 'update'`);
      expect(changes.length).toEqual(1);
      expect(changes[0]).toMatchObject({
        attribute: 'bool',
        entityKey: record.ID,
        modification: 'update',
        modificationLabel: 'Update',
        objectID: 'My test-record',
        entity: 'sap.change_tracking.DifferentFieldTypes',
        entityLabel: 'Different field types',
        valueChangedFrom: null,
        valueChangedTo: 'true'
      });
    });

    it('logs field values when deleting a record', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView } = testingSRV.entities;

      const { data: record } = await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
        number: 1,
        bool: true
      });

      const {
        data: { value: beforeChanges }
      } = await GET(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})/changes`);
      expect(beforeChanges.length > 0).toBeTruthy();

      await DELETE(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${record.ID})`);

      const afterChanges = await SELECT.from(ChangeView).where({ entityKey: record.ID, modification: 'delete' });
      expect(afterChanges.length).toEqual(2);
    });

    it('generates separate change logs for each entity when batch inserting multiple records', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView, DifferentFieldTypes } = testingSRV.entities;

      const e1ID = cds.utils.uuid();
      const e2ID = cds.utils.uuid();
      const e3ID = cds.utils.uuid();
      const data = [
        {
          ID: e1ID,
          bool: false,
          number: 0
        },
        {
          ID: e2ID,
          bool: true,
          number: 10
        },
        {
          ID: e3ID,
          bool: false,
          number: 20
        }
      ];
      await INSERT.into(DifferentFieldTypes).entries(data);

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[e1ID, e2ID, e3ID]}`;
      expect(changes.length).toEqual(6);
      expect(changes.some((c) => c.modification !== 'create')).toEqual(false);
      expect(changes.some((c) => c.entity !== 'sap.change_tracking.DifferentFieldTypes')).toEqual(false);

      const changesOrder1 = changes.filter((change) => change.entityKey === e1ID);

      const numberChange1 = changesOrder1.find((change) => change.attribute === 'number');
      expect(numberChange1.valueChangedFrom).toEqual(null);
      expect(Number(numberChange1.valueChangedTo)).toEqual(0);

      const boolChange1 = changesOrder1.find((change) => change.attribute === 'bool');
      expect(boolChange1.valueChangedFrom).toEqual(null);
      expect(boolChange1.valueChangedTo).toEqual('false');

      const changesOrder2 = changes.filter((change) => change.entityKey === e2ID);

      const numberChange2 = changesOrder2.find((change) => change.attribute === 'number');
      expect(numberChange2.valueChangedFrom).toEqual(null);
      expect(Number(numberChange2.valueChangedTo)).toEqual(10);

      const boolChange2 = changesOrder2.find((change) => change.attribute === 'bool');
      expect(boolChange2.valueChangedFrom).toEqual(null);
      expect(boolChange2.valueChangedTo).toEqual('true');

      const changesOrder3 = changes.filter((change) => change.entityKey === e3ID);

      const numberChange3 = changesOrder3.find((change) => change.attribute === 'number');
      expect(numberChange3.valueChangedFrom).toEqual(null);
      expect(Number(numberChange3.valueChangedTo)).toEqual(20);

      const boolChange3 = changesOrder3.find((change) => change.attribute === 'bool');
      expect(boolChange3.valueChangedFrom).toEqual(null);
      expect(boolChange3.valueChangedTo).toEqual('false');
    });
  });

  describe('UPSERT operations', () => {
    it('logs field values when upserting a new record', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView, DifferentFieldTypes } = testingSRV.entities;

      const id = cds.utils.uuid();
      await UPSERT.into(DifferentFieldTypes).entries({ ID: id, number: 42, bool: true, title: 'Upserted record' });

      const changes = await SELECT.from(ChangeView).where({ entityKey: id, modification: 'create' });
      expect(changes.length).toEqual(3);

      const numberLog = changes.find((c) => c.attribute === 'number');
      expect(numberLog).toBeDefined();
      expect(numberLog.valueChangedFrom).toEqual(null);
      expect(Number(numberLog.valueChangedTo)).toEqual(42);

      const boolLog = changes.find((c) => c.attribute === 'bool');
      expect(boolLog).toBeDefined();
      expect(boolLog.valueChangedFrom).toEqual(null);
      expect(boolLog.valueChangedTo).toEqual('true');

      const titleLog = changes.find((c) => c.attribute === 'title');
      expect(titleLog).toBeDefined();
      expect(titleLog.valueChangedFrom).toEqual(null);
      expect(titleLog.valueChangedTo).toEqual('Upserted record');
    });

    it('logs old and new values when upserting an existing record (update path)', async () => {
      const testingSRV = await cds.connect.to('VariantTesting');
      const { ChangeView, DifferentFieldTypes } = testingSRV.entities;

      const id = cds.utils.uuid();
      // First create the record
      await INSERT.into(DifferentFieldTypes).entries({ ID: id, number: 10, bool: false, title: 'Original' });

      // Now upsert the same record with changed values
      await UPSERT.into(DifferentFieldTypes).entries({ ID: id, number: 99, bool: true, title: 'Updated via upsert' });

      const changes = await SELECT.from(ChangeView).where({ entityKey: id, modification: 'update' });
      expect(changes.length).toEqual(3);

      const numberLog = changes.find((c) => c.attribute === 'number');
      expect(numberLog).toBeDefined();
      expect(Number(numberLog.valueChangedFrom)).toEqual(10);
      expect(Number(numberLog.valueChangedTo)).toEqual(99);

      const boolLog = changes.find((c) => c.attribute === 'bool');
      expect(boolLog).toBeDefined();
      expect(boolLog.valueChangedFrom).toEqual('false');
      expect(boolLog.valueChangedTo).toEqual('true');

      const titleLog = changes.find((c) => c.attribute === 'title');
      expect(titleLog).toBeDefined();
      expect(titleLog.valueChangedFrom).toEqual('Original');
      expect(titleLog.valueChangedTo).toEqual('Updated via upsert');
    });
  });

  it('tracks zero values and false booleans correctly during create and delete', async () => {
    const { ChangeView } = (await cds.connect.to('VariantTesting')).entities;
    const orderID = cds.utils.uuid();

    await POST(`/odata/v4/variant-testing/DifferentFieldTypes`, {
      ID: orderID,
      bool: false,
      number: 0
    });

    let changes = await SELECT.from(ChangeView).where({
      entityKey: orderID,
      modification: 'create'
    });

    expect(changes.length).toEqual(2);

    const change1 = changes.find((c) => c.attribute === 'number');

    expect(change1).toHaveProperty('entityKey', orderID);
    expect(change1).toHaveProperty('modification', 'create');
    expect(change1).toHaveProperty('entityLabel', 'Different field types');
    expect(change1.valueChangedFrom).toEqual(null);
    expect(Number(change1.valueChangedTo)).toEqual(0);

    const change2 = changes.find((c) => c.attribute === 'bool');

    expect(change2).toHaveProperty('entityKey', orderID);
    expect(change2).toHaveProperty('modification', 'create');
    expect(change2).toHaveProperty('entityLabel', 'Different field types');
    expect(change2.valueChangedFrom).toEqual(null);
    expect(change2.valueChangedTo).toEqual('false');

    await DELETE(`/odata/v4/variant-testing/DifferentFieldTypes(ID=${orderID})`);

    changes = await SELECT.from(ChangeView).where({
      entityKey: orderID,
      modification: 'delete'
    });

    expect(changes.length).toEqual(2);

    const change3 = changes.find((c) => c.attribute === 'number');

    expect(change3).toHaveProperty('entityKey', orderID);
    expect(change3).toHaveProperty('modification', 'delete');
    expect(change3).toHaveProperty('entityLabel', 'Different field types');
    expect(Number(change3.valueChangedFrom)).toEqual(0);
    expect(change3.valueChangedTo).toEqual(null);

    const change4 = changes.find((c) => c.attribute === 'bool');

    expect(change4).toHaveProperty('entityKey', orderID);
    expect(change4).toHaveProperty('modification', 'delete');
    expect(change4).toHaveProperty('entityLabel', 'Different field types');
    expect(change4.valueChangedFrom).toEqual('false');
    expect(change4.valueChangedTo).toEqual(null);
  });
});
