const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, axios } = cds.test(bookshop);
axios.defaults.auth = { username: 'alice', password: 'admin' };

describe('change log generation', () => {
  describe('4-level composition hierarchy (GrandRootSample -> RootSample -> Level1Sample -> Level2Sample)', () => {
    it('links changes through all 4 levels when creating the deepest entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const grandRootID = cds.utils.uuid();
      const rootID = cds.utils.uuid();
      const lvl1ID = cds.utils.uuid();

      // Create 3-level hierarchy first
      await POST(`/odata/v4/variant-testing/GrandRootSample`, {
        ID: grandRootID,
        title: 'GrandRoot title',
        children: [
          {
            ID: rootID,
            title: 'Root title',
            children: [
              {
                ID: lvl1ID,
                title: 'Level1 title'
              }
            ]
          }
        ]
      });

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Now create a Level2Sample on the existing Level1Sample
      const lvl2ID = cds.utils.uuid();
      await POST(`/odata/v4/variant-testing/Level1Sample(ID='${lvl1ID}')/children`, {
        ID: lvl2ID,
        title: 'New Level2 title'
      });

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID, lvl2ID]} and transactionID != ${transactionID}`;

      // Expect 4 changelog entries forming a full chain
      expect(changes.length).toEqual(4);

      const grandRootChange = changes.find((c) => c.entityKey === grandRootID);
      expect(grandRootChange).toMatchObject({
        entity: 'sap.change_tracking.GrandRootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const rootChange = changes.find((c) => c.entityKey === rootID);
      expect(rootChange).toMatchObject({
        entity: 'sap.change_tracking.RootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: grandRootChange.ID,
        valueDataType: 'cds.Composition'
      });

      const lvl1Change = changes.find((c) => c.entityKey === lvl1ID);
      expect(lvl1Change).toMatchObject({
        entity: 'sap.change_tracking.Level1Sample',
        attribute: 'children',
        modification: 'update',
        parent_ID: rootChange.ID,
        valueDataType: 'cds.Composition'
      });

      const lvl2Change = changes.find((c) => c.entityKey === lvl2ID);
      expect(lvl2Change).toMatchObject({
        entity: 'sap.change_tracking.Level2Sample',
        attribute: 'title',
        modification: 'create',
        parent_ID: lvl1Change.ID,
        valueChangedFrom: null,
        valueChangedTo: 'New Level2 title'
      });
    });

    it('links changes through all 4 levels when updating the deepest entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const grandRootID = cds.utils.uuid();
      const rootID = cds.utils.uuid();
      const lvl1ID = cds.utils.uuid();
      const lvl2ID = cds.utils.uuid();

      // Create full 4-level hierarchy
      await POST(`/odata/v4/variant-testing/GrandRootSample`, {
        ID: grandRootID,
        title: 'GrandRoot title',
        children: [
          {
            ID: rootID,
            title: 'Root title',
            children: [
              {
                ID: lvl1ID,
                title: 'Level1 title',
                children: [
                  {
                    ID: lvl2ID,
                    title: 'Level2 title'
                  }
                ]
              }
            ]
          }
        ]
      });

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID, lvl2ID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Update the deepest entity (Level2Sample)
      await PATCH(`/odata/v4/variant-testing/Level2Sample(ID='${lvl2ID}')`, {
        title: 'Level2 title updated'
      });

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID, lvl2ID]} and transactionID != ${transactionID}`;

      // Expect 4 changelog entries forming a full chain:
      // GrandRootSample.children (great-grandparent) -> RootSample.children (grandparent) -> Level1Sample.children (parent) -> Level2Sample.title (leaf)
      expect(changes.length).toEqual(4);

      // Level 1: GrandRootSample.children composition entry
      const grandRootChange = changes.find((c) => c.entityKey === grandRootID);
      expect(grandRootChange).toMatchObject({
        entity: 'sap.change_tracking.GrandRootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition',
        // Root objectID : [ID, title]
        objectID: `${rootID}, Root title`
      });

      // Level 2: RootSample.children composition entry
      const rootChange = changes.find((c) => c.entityKey === rootID);
      expect(rootChange).toMatchObject({
        entity: 'sap.change_tracking.RootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: grandRootChange.ID,
        valueDataType: 'cds.Composition',
        // Level1Sample objectID : [ID, title, parent.ID]
        objectID: `${lvl1ID}, Level1 title, ${rootID}`
      });

      // Level 3: Level1Sample.children composition entry (parent, links to grandparent)
      const lvl1Change = changes.find((c) => c.entityKey === lvl1ID);
      expect(lvl1Change).toMatchObject({
        entity: 'sap.change_tracking.Level1Sample',
        attribute: 'children',
        modification: 'update',
        parent_ID: rootChange.ID,
        valueDataType: 'cds.Composition'
      });

      // Level 4: Level2Sample.title field change (leaf, links to parent)
      const lvl2Change = changes.find((c) => c.entityKey === lvl2ID);
      expect(lvl2Change).toMatchObject({
        entity: 'sap.change_tracking.Level2Sample',
        attribute: 'title',
        modification: 'update',
        parent_ID: lvl1Change.ID,
        valueChangedFrom: 'Level2 title',
        valueChangedTo: 'Level2 title updated'
      });
    });

    it('links changes through all 4 levels when deleting the deepest entity', async () => {
      const adminService = await cds.connect.to('AdminService');
      const { ChangeView } = adminService.entities;

      const grandRootID = cds.utils.uuid();
      const rootID = cds.utils.uuid();
      const lvl1ID = cds.utils.uuid();
      const lvl2ID = cds.utils.uuid();

      // Create full 4-level hierarchy
      await POST(`/odata/v4/variant-testing/GrandRootSample`, {
        ID: grandRootID,
        title: 'GrandRoot title',
        children: [
          {
            ID: rootID,
            title: 'Root title',
            children: [
              {
                ID: lvl1ID,
                title: 'Level1 title',
                children: [
                  {
                    ID: lvl2ID,
                    title: 'Level2 to delete'
                  }
                ]
              }
            ]
          }
        ]
      });

      const changesBefore = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID, lvl2ID]}`;
      expect(changesBefore.length).toBeGreaterThan(0);
      const transactionID = changesBefore[0].transactionID;

      // Delete the deepest entity
      await DELETE(`/odata/v4/variant-testing/Level2Sample(ID='${lvl2ID}')`);

      const changes = await SELECT.from(ChangeView).where`entityKey in ${[grandRootID, rootID, lvl1ID, lvl2ID]} and transactionID != ${transactionID}`;

      // Expect 4 changelog entries forming a full chain
      expect(changes.length).toEqual(4);

      const grandRootChange = changes.find((c) => c.entityKey === grandRootID);
      expect(grandRootChange).toMatchObject({
        entity: 'sap.change_tracking.GrandRootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: null,
        valueDataType: 'cds.Composition'
      });

      const rootChange = changes.find((c) => c.entityKey === rootID);
      expect(rootChange).toMatchObject({
        entity: 'sap.change_tracking.RootSample',
        attribute: 'children',
        modification: 'update',
        parent_ID: grandRootChange.ID,
        valueDataType: 'cds.Composition'
      });

      const lvl1Change = changes.find((c) => c.entityKey === lvl1ID);
      expect(lvl1Change).toMatchObject({
        entity: 'sap.change_tracking.Level1Sample',
        attribute: 'children',
        modification: 'update',
        parent_ID: rootChange.ID,
        valueDataType: 'cds.Composition'
      });

      const lvl2Change = changes.find((c) => c.entityKey === lvl2ID);
      expect(lvl2Change).toMatchObject({
        entity: 'sap.change_tracking.Level2Sample',
        attribute: 'title',
        modification: 'delete',
        parent_ID: lvl1Change.ID,
        valueChangedFrom: 'Level2 to delete',
        valueChangedTo: null
      });
    });
  });

  it('tracks changes when custom actions modify entities in the composition hierarchy', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const rootID = cds.utils.uuid();
    const lvl1ID = cds.utils.uuid();
    const lvl2ID = cds.utils.uuid();

    await POST(`/odata/v4/variant-testing/RootSample`, {
      ID: rootID,
      title: 'RootSample title',
      children: [
        {
          ID: lvl1ID,
          title: 'Level1Sample title',
          children: [
            {
              ID: lvl2ID,
              title: 'Level2Sample title'
            }
          ]
        }
      ]
    });
    const orderID = cds.utils.uuid();
    const orderItemID = cds.utils.uuid();
    const noteID = cds.utils.uuid();

    await POST(`/odata/v4/admin/Order`, { ID: orderID, orderItems: [{ ID: orderItemID, notes: [{ ID: noteID }] }] });
    await POST(`/odata/v4/admin/Order(ID=${orderID})/orderItems(ID=${orderItemID})/notes(ID=${noteID})/AdminService.activate`, { ID: lvl2ID });

    let changes = await SELECT.from(ChangeView).where({
      entity: 'sap.capire.bookshop.OrderItemNote',
      entityKey: noteID,
      attribute: 'ActivationStatus'
    });
    expect(changes.length).toEqual(1);
    expect(changes[0].valueChangedFrom).toEqual(null);
    expect(changes[0].valueChangedTo).toEqual('VALID');
    expect(changes[0].parent_ID).not.toBeNull();
    expect(changes[0].parent_entityKey).toEqual(orderItemID);
    expect(changes[0].parent_entity).toEqual('sap.capire.bookshop.OrderItem');

    changes = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      modification: 'update',
      entityKey: lvl2ID,
      attribute: 'title'
    });
    expect(changes.length).toEqual(1);
    expect(changes[0].valueChangedFrom).toEqual('Level2Sample title');
    expect(changes[0].valueChangedTo).toEqual('Game Science');
    expect(changes[0].parent_ID).not.toBeNull();
    expect(changes[0].parent_entityKey).toEqual(lvl1ID);
    expect(changes[0].parent_entity).toEqual('sap.change_tracking.Level1Sample');
  });
});
