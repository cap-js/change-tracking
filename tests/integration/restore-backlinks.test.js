const cds = require('@sap/cds');
const path = require('path');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, PATCH, defaults } = cds.test(bookshop);
defaults.auth = { username: 'alice', password: '' };

const isHana = cds.env.requires?.db?.kind === 'hana';

(isHana ? describe : describe.skip)('Restore Backlinks HANA Procedure', () => {
  it('restores backlinks for create operations', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { RootSample, ChangeView } = testingSRV.entities;

    const rootID = cds.utils.uuid();
    const lvl1ID = cds.utils.uuid();
    const lvl2ID = cds.utils.uuid();

    const sampleData = {
      ID: rootID,
      title: 'RootSample title3',
      children: [
        {
          ID: lvl1ID,
          title: 'Level1Sample title3',
          children: [
            {
              ID: lvl2ID,
              title: 'Level2Sample title3'
            }
          ]
        }
      ]
    };
    await INSERT.into(RootSample).entries(sampleData);

    // Capture the original state: 5 records (3 title + 2 composition)
    const originalChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
    expect(originalChanges.length).toEqual(5);

    const originalCompositionChanges = originalChanges.filter((c) => c.attribute === 'children');
    const compositionIDs = originalCompositionChanges.map((c) => c.ID);
    expect(originalCompositionChanges.length).toEqual(2);

    // Save original composition records as templates for later comparison
    const originalRootChildren = originalChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children');
    const originalLvl1Children = originalChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children');

    // Break parent_ID links first to prevent cascade delete, then delete composition entries
    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionIDs });
    await cds.delete('sap.changelog.Changes').where({ ID: compositionIDs });

    // Verify only 3 title records remain, all with broken backlinks
    const afterChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
    expect(afterChanges.length).toEqual(3);
    expect(afterChanges.every((c) => c.attribute === 'title')).toBeTruthy();
    expect(afterChanges.every((c) => c.parent_ID === null)).toBeTruthy();

    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // should have 5 records again (2 composition records recreated)
    const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
    expect(restoredChanges.length).toEqual(5);

    const restoredRootChildren = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children');
    expect(restoredRootChildren).toBeTruthy();
    expect(restoredRootChildren).toMatchObject({
      entityKey: originalRootChildren.entityKey,
      valueDataType: originalRootChildren.valueDataType,
      modification: originalRootChildren.modification,
      parent_ID: null
    });

    // Verify restored Level1Sample/children composition record matches original
    const restoredLvl1Children = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children');
    expect(restoredLvl1Children).toBeTruthy();
    expect(restoredLvl1Children).toMatchObject({
      entityKey: originalLvl1Children.entityKey,
      attribute: 'children',
      valueDataType: originalLvl1Children.valueDataType,
      modification: originalLvl1Children.modification,
      parent_ID: restoredRootChildren.ID
    });

    // Verify title records now have parent_ID references restored
    const restoredLvl1Title = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'title');
    expect(restoredLvl1Title.parent_ID).toEqual(restoredRootChildren.ID);

    const restoredLvl2Title = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title');
    expect(restoredLvl2Title.parent_ID).toEqual(restoredLvl1Children.ID);

    // Root title should remain without parent
    const restoredRootTitle = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'title');
    expect(restoredRootTitle.parent_ID).toBeNull();
  });

  it('restores backlinks for update operations', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const rootID = cds.utils.uuid();
    const lvl1ID = cds.utils.uuid();
    const lvl2ID = cds.utils.uuid();

    // Create the hierarchy via HTTP to get a separate transaction
    await POST(`/odata/v4/variant-testing/RootSample`, {
      ID: rootID,
      title: 'Root for update test',
      children: [
        {
          ID: lvl1ID,
          title: 'Level1 for update test',
          children: [{ ID: lvl2ID, title: 'Level2 for update test' }]
        }
      ]
    });

    // Update the Level2Sample title via HTTP to get a new transaction
    await PATCH(`/odata/v4/variant-testing/Level2Sample(ID=${lvl2ID})`, {
      title: 'Level2 updated title'
    });

    // Capture all changes — should have entries across two transactions
    const allChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

    // Verify update entry exists and has proper parent_ID
    const updateLvl2Title = allChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title' && c.modification === 'update');
    expect(updateLvl2Title).toBeTruthy();
    expect(updateLvl2Title.parent_ID).not.toBeNull();

    // Break ALL backlinks: remove all composition entries, null out all parent_IDs
    const allCompositionChanges = allChanges.filter((c) => c.valueDataType === 'cds.Composition');
    const compositionIDs = allCompositionChanges.map((c) => c.ID);
    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionIDs });
    await cds.delete('sap.changelog.Changes').where({ ID: compositionIDs });

    // Verify backlinks are broken — only title entries remain, all orphaned
    const brokenChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
    expect(brokenChanges.every((c) => c.parent_ID === null)).toBeTruthy();
    expect(brokenChanges.every((c) => c.attribute === 'title')).toBeTruthy();

    // Restore backlinks
    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify restored state
    const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

    // The update title entry should have its parent_ID restored
    const restoredUpdateLvl2 = restoredChanges.find((c) => c.ID === updateLvl2Title.ID);
    expect(restoredUpdateLvl2.parent_ID).not.toBeNull();

    // Find the restored Level1Sample.children composition entry for the update transaction
    const updateTxn = updateLvl2Title.transactionID;
    const restoredLvl1Comp = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children' && c.valueDataType === 'cds.Composition' && c.transactionID === updateTxn);
    expect(restoredLvl1Comp).toBeTruthy();
    expect(restoredLvl1Comp.modification).toEqual('update');

    // The Level1Sample.children composition entry should be linked to RootSample.children
    const restoredRootComp = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children' && c.valueDataType === 'cds.Composition' && c.transactionID === updateTxn);
    expect(restoredRootComp).toBeTruthy();
    expect(restoredRootComp.modification).toEqual('update');
    expect(restoredLvl1Comp.parent_ID).toEqual(restoredRootComp.ID);
  });

  it('restores backlinks for delete operations with preserveDeletes', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { RootSample, ChangeView } = testingSRV.entities;

    const rootID = cds.utils.uuid();
    const lvl1ID = cds.utils.uuid();
    const lvl2ID = cds.utils.uuid();

    // Create the hierarchy
    await INSERT.into(RootSample).entries({
      ID: rootID,
      title: 'Root for delete test',
      children: [
        {
          ID: lvl1ID,
          title: 'Level1 for delete test',
          children: [{ ID: lvl2ID, title: 'Level2 for delete test' }]
        }
      ]
    });

    // Capture create state and use the actual transactionID format
    const createChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });
    expect(createChanges.length).toEqual(5);

    // Use a fake but valid integer transactionID for the simulated delete entries
    const deleteTransactionID = 99999999;

    // Simulate preserveDeletes-style delete changelog entries by manually inserting
    // delete modification records without parent_ID (as if preserveDeletes was enabled during deletion)
    await cds.run(
      `INSERT INTO SAP_CHANGELOG_CHANGES (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (?, NULL, 'title', 'sap.change_tracking.Level2Sample', ?, ?, CURRENT_TIMESTAMP, 'alice', 'cds.String', 'delete', ?)`,
      [cds.utils.uuid(), lvl2ID, lvl2ID, deleteTransactionID]
    );
    await cds.run(
      `INSERT INTO SAP_CHANGELOG_CHANGES (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			VALUES (?, NULL, 'title', 'sap.change_tracking.Level1Sample', ?, ?, CURRENT_TIMESTAMP, 'alice', 'cds.String', 'delete', ?)`,
      [cds.utils.uuid(), lvl1ID, lvl1ID, deleteTransactionID]
    );

    // Verify the delete entries have no parent_ID
    const deleteLvl2 = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: lvl2ID,
      modification: 'delete'
    });
    expect(deleteLvl2.length).toEqual(1);
    expect(deleteLvl2[0].parent_ID).toBeNull();

    // Restore backlinks
    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify composition entries were created for the delete transaction
    const restoredChanges = await SELECT.from(ChangeView).where({ entityKey: [rootID, lvl1ID, lvl2ID] });

    // The delete Level2 title should now have a parent_ID
    const restoredDeleteLvl2 = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level2Sample' && c.attribute === 'title' && c.modification === 'delete');
    expect(restoredDeleteLvl2.parent_ID).not.toBeNull();

    // Level1Sample.children composition entry should exist for the delete transaction
    const restoredLvl1Comp = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'children' && c.valueDataType === 'cds.Composition' && c.transactionID === String(deleteTransactionID));
    expect(restoredLvl1Comp).toBeTruthy();
    expect(restoredDeleteLvl2.parent_ID).toEqual(restoredLvl1Comp.ID);

    // Level1Sample.children should link to RootSample.children (grandparent linking)
    const restoredRootComp = restoredChanges.find((c) => c.entity === 'sap.change_tracking.RootSample' && c.attribute === 'children' && c.valueDataType === 'cds.Composition' && c.transactionID === String(deleteTransactionID));
    expect(restoredRootComp).toBeTruthy();
    expect(restoredLvl1Comp.parent_ID).toEqual(restoredRootComp.ID);

    // The delete Level1 title should also have its parent_ID restored
    const restoredDeleteLvl1 = restoredChanges.find((c) => c.entity === 'sap.change_tracking.Level1Sample' && c.attribute === 'title' && c.modification === 'delete');
    expect(restoredDeleteLvl1.parent_ID).toEqual(restoredRootComp.ID);
  });

  it('restores backlinks for composite-key parent with correct objectID', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const year = Math.floor(Math.random() * 9000) + 1000;
    const code = cds.utils.uuid().slice(0, 8);
    const itemID = cds.utils.uuid();
    const parentTitle = 'CompositeKey Parent Title';

    // Create a CompositeKeyParent with an inline composition child
    await POST(`/odata/v4/variant-testing/CompositeKeyParent`, {
      year,
      code,
      title: parentTitle,
      items: [{ ID: itemID, value: 'Item Value' }]
    });

    const parentKey = `${String(year).length},${year};${String(code).length},${code}`;
    const childKey = `${String(year).length},${year};${String(code).length},${code};${String(itemID).length},${itemID}`;

    // Capture original state: should have composition + child entries
    const originalChange = await SELECT.from(ChangeView).where({ entityKey: [parentKey, childKey] });
    expect(originalChange.length).toEqual(3);

    const compositionChange = originalChange.find((c) => c.attribute === 'items');
    expect(compositionChange.entity).toEqual('sap.change_tracking.CompositeKeyParent');
    expect(compositionChange.objectID).toEqual(parentTitle);
    expect(compositionChange.valueDataType).toEqual('cds.Composition');

    // Delete composition change
    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: compositionChange.ID });

    // Restore backlinks
    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify the composition entry was recreated
    const restoredChange = await SELECT.from(ChangeView).where(`entityKey IN ('${parentKey}', '${childKey}')`);
    expect(restoredChange.length).toEqual(3);

    const itemChange = restoredChange.find((c) => c.attribute === 'items');
    expect(itemChange.entity).toEqual('sap.change_tracking.CompositeKeyParent');
    expect(itemChange.objectID).toEqual(parentTitle);
    expect(itemChange.valueDataType).toEqual('cds.Composition');
    expect(itemChange.parent_ID).toBeNull();

    const valueChange = restoredChange.find((c) => c.attribute === 'value');
    expect(valueChange.entity).toEqual('sap.change_tracking.CompositeKeyParent.items');
    expect(valueChange.objectID).toEqual(childKey); // REVISIT: with new logic it should fallback to the objectID of the parent change
    expect(valueChange.valueDataType).toEqual('cds.String');
    expect(valueChange.parent_ID).toEqual(itemChange.ID);
  });

  it("restores backlinks for composition that includes reserved element name 'order'", async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const rootID = cds.utils.uuid();
    const level1ID = cds.utils.uuid();
    const level2ID = cds.utils.uuid();

    // Create hierarchy with Level2Sample.order = 7
    await POST('/odata/v4/variant-testing/RootSample', {
      ID: rootID,
      title: 'Root',
      children: [
        {
          ID: level1ID,
          title: 'Level1',
          children: [{ ID: level2ID, title: 'Level2', order: 7 }]
        }
      ]
    });

    // Find the Level1 -> Level2 composition entry
    const originalChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level1Sample',
      entityKey: level1ID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(originalChanges.length).toEqual(1);
    const compositionChange = originalChanges[0];

    // Delete the composition entry (orphan the child entries)
    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: compositionChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: compositionChange.ID });

    // Restore backlinks
    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify the composition entry was recreated
    const restoredChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level1Sample',
      entityKey: level1ID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(restoredChanges.length).toEqual(1);

    // Verify the child 'order' entry has restored parent_ID
    const orderChange = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: level2ID,
      attribute: 'order'
    });
    expect(orderChange.length).toEqual(1);
    expect(orderChange[0].parent_ID).toEqual(restoredChanges[0].ID);
    expect(orderChange[0].objectID).toEqual(`${level2ID}, Level2, 7`);
  });

  it('restores child objectID with all @changelog fields present', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const parentID = cds.utils.uuid();
    const childID = cds.utils.uuid();

    await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
      ID: parentID,
      title: 'Parent Title',
      children: [{ ID: childID, fieldA: 'Alpha', fieldB: 'Beta', name: 'Child' }]
    });

    const originalChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackParent',
      entityKey: parentID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(originalChange).toBeTruthy();

    // Delete composition entry (orphan the child entries)
    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: originalChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: originalChange.ID });

    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify restored child objectID contains both fields
    const restoredChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackChild',
      entityKey: childID,
      attribute: 'fieldA'
    });
    expect(restoredChange).toBeTruthy();
    expect(restoredChange.objectID).toEqual('Alpha, Beta');
    expect(restoredChange.parent_ID).not.toBeNull();
  });

  it('restores child objectID with <empty> for NULL @changelog fields', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const parentID = cds.utils.uuid();
    const childID = cds.utils.uuid();

    await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
      ID: parentID,
      title: 'Parent Title',
      children: [{ ID: childID, fieldA: 'Alpha', name: 'Child' }]
    });

    const originalChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackParent',
      entityKey: parentID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(originalChange).toBeTruthy();

    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: originalChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: originalChange.ID });

    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    // Verify restored child objectID shows '<empty>' for NULL fieldB
    const restoredChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackChild',
      entityKey: childID,
      attribute: 'fieldA'
    });
    expect(restoredChange).toBeTruthy();
    expect(restoredChange.objectID).toEqual('Alpha, <empty>');
    expect(restoredChange.parent_ID).not.toBeNull();
  });

  it('restores child objectID falling back to entityKey when all @changelog fields are NULL', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const parentID = cds.utils.uuid();
    const childID = cds.utils.uuid();

    // Create child with both objectID fields NULL but name set so the trigger creates a change entry
    await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
      ID: parentID,
      title: 'Parent Title',
      children: [{ ID: childID, name: 'Child' }]
    });

    const originalChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackParent',
      entityKey: parentID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(originalChange).toBeTruthy();

    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: originalChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: originalChange.ID });

    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    const restoredChange = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackChild',
      entityKey: childID,
      attribute: 'name',
      modification: 'create'
    });
    expect(restoredChange.length).toEqual(1);
    expect(restoredChange[0].objectID).toEqual(childID);
    expect(restoredChange[0].parent_ID).not.toBeNull();
  });

  it('restores parent objectID falling back to entityKey when @changelog field is NULL', async () => {
    const testingSRV = await cds.connect.to('VariantTesting');
    const { ChangeView } = testingSRV.entities;

    const parentID = cds.utils.uuid();
    const childID = cds.utils.uuid();

    // Create parent with title=NULL — parent objectID should fall back to entityKey
    await POST('/odata/v4/variant-testing/ObjectIdFallbackParent', {
      ID: parentID,
      children: [{ ID: childID, fieldA: 'Alpha', name: 'Child' }]
    });

    const originalChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackParent',
      entityKey: parentID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(originalChange).toBeTruthy();

    await UPDATE('sap.changelog.Changes').set({ parent_ID: null }).where({ parent_ID: originalChange.ID });
    await cds.delete('sap.changelog.Changes').where({ ID: originalChange.ID });

    await cds.run(`CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();`);

    const restoredChange = await SELECT.one.from(ChangeView).where({
      entity: 'sap.change_tracking.ObjectIdFallbackParent',
      entityKey: parentID,
      attribute: 'children',
      valueDataType: 'cds.Composition'
    });
    expect(restoredChange).toBeTruthy();
    expect(restoredChange.objectID).toEqual(parentID);
  });
});
