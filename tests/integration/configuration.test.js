const cds = require('@sap/cds');
const path = require('path');
const { regenerateTriggers } = require('../test-utils.js');

const bookshop = path.resolve(__dirname, './../bookshop');
const { POST, PATCH, DELETE, defaults } = cds.test(bookshop);
defaults.auth = { username: 'alice', password: '' };

const isHana = cds.env.requires?.db?.kind === 'hana';
const isJava = cds.env.env === 'java';
const skipRegen = isHana || isJava;

describe.skipIf(skipRegen)('Configuration Options', () => {
  // Entities used in the VariantTesting service tests
  const variantEntities = ['sap.change_tracking.RootSample', 'sap.change_tracking.Level1Sample', 'sap.change_tracking.Level2Sample'];

  it('retains all change logs and logs deletion when preserveDeletes is enabled', async () => {
    cds.env.requires['change-tracking'].preserveDeletes = true;
    await regenerateTriggers(variantEntities);
    const variantSrv = await cds.connect.to('VariantTesting');

    const { data: newRoot } = await POST(`/odata/v4/variant-testing/RootSample`, {
      ID: cds.utils.uuid(),
      title: 'new RootSample title',
      children: [
        {
          ID: cds.utils.uuid(),
          title: 'new Level1Sample title',
          children: [
            {
              ID: cds.utils.uuid(),
              title: 'new Level2Sample title'
            }
          ]
        }
      ]
    });

    const beforeChanges = await SELECT.from({ ref: [{ id: variantSrv.entities.RootSample.name, where: [{ ref: ['ID'] }, '=', { val: newRoot.ID }] }, 'changes'] });
    expect(beforeChanges.length > 0).toBeTruthy();

    // Test when the root and child entity deletion occur simultaneously
    await DELETE(`/odata/v4/variant-testing/RootSample(ID=${newRoot.ID})`);

    const afterChanges = await SELECT.from(variantSrv.entities.ChangeView).where(`entityKey IN ('${newRoot.ID}', '${newRoot.children[0].ID}', '${newRoot.children[0].children[0].ID}')`);
    expect(afterChanges.length).toEqual(10);

    const changelogCreated = afterChanges.filter((ele) => ele.modification === 'create');
    const changelogDeleted = afterChanges.filter((ele) => ele.modification === 'delete');

    const compareAttributes = ['keys', 'attribute', 'entity', 'serviceEntity', 'serviceEntityPath', 'valueDataType', 'objectID', 'entityKey'];

    let commonItems = changelogCreated.filter((beforeItem) => {
      return changelogDeleted.some((afterItem) => {
        return compareAttributes.every((attr) => beforeItem[attr] === afterItem[attr]) && beforeItem['valueChangedFrom'] === afterItem['valueChangedTo'] && beforeItem['valueChangedTo'] === afterItem['valueChangedFrom'];
      });
    });

    expect(commonItems.length > 0).toBeTruthy();

    cds.env.requires['change-tracking'].preserveDeletes = false;
    await regenerateTriggers(variantEntities);
  });

  it('skips update logging when disableUpdateTracking is enabled', async () => {
    cds.env.requires['change-tracking'].disableUpdateTracking = true;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    const testingSRV = await cds.connect.to('VariantTesting');
    const ID = cds.utils.uuid();
    await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

    await UPDATE.entity(testingSRV.entities.Level2Sample).where({ ID: ID }).with({ title: 'New name' });

    let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: ID,
      attribute: 'title',
      modification: 'update'
    });
    expect(changes.length).toEqual(0);

    cds.env.requires['change-tracking'].disableUpdateTracking = false;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    await UPDATE(testingSRV.entities.Level2Sample).where({ ID }).with({ title: 'Another name' });

    changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: ID,
      attribute: 'title',
      modification: 'update'
    });
    expect(changes.length).toEqual(1);
  });

  it('skips create logging when disableCreateTracking is enabled', async () => {
    cds.env.requires['change-tracking'].disableCreateTracking = true;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    const testingSRV = await cds.connect.to('VariantTesting');
    let ID = cds.utils.uuid();
    await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

    let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: ID,
      attribute: 'title',
      modification: 'create'
    });
    expect(changes.length).toEqual(0);

    cds.env.requires['change-tracking'].disableCreateTracking = false;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    ID = cds.utils.uuid();
    await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });

    changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: ID,
      attribute: 'title',
      modification: 'create'
    });
    expect(changes.length).toEqual(1);
  });

  it('skips create logging for composition children during deep insert when disableCreateTracking is enabled', async () => {
    cds.env.requires['change-tracking'].disableCreateTracking = true;
    await regenerateTriggers(variantEntities);
    const variantSrv = await cds.connect.to('VariantTesting');
    const { ChangeView } = variantSrv.entities;

    const rootID = cds.utils.uuid();
    const level1ID = cds.utils.uuid();
    const level2ID = cds.utils.uuid();

    await POST(`/odata/v4/variant-testing/RootSample`, {
      ID: rootID,
      title: 'Root for disable-create test',
      children: [
        {
          ID: level1ID,
          title: 'Level1 for disable-create test',
          children: [
            {
              ID: level2ID,
              title: 'Level2 for disable-create test'
            }
          ]
        }
      ]
    });

    // No create changes should exist for root entity
    const rootChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.RootSample',
      entityKey: rootID,
      modification: 'create'
    });
    expect(rootChanges.length).toEqual(0);

    // No create changes should exist for level1 child entity
    const level1Changes = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level1Sample',
      entityKey: level1ID,
      modification: 'create'
    });
    expect(level1Changes.length).toEqual(0);

    // No create changes should exist for level2 grandchild entity
    const level2Changes = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: level2ID,
      modification: 'create'
    });
    expect(level2Changes.length).toEqual(0);

    cds.env.requires['change-tracking'].disableCreateTracking = false;
    await regenerateTriggers(variantEntities);
  });

  it('skips delete logging when disableDeleteTracking is enabled', async () => {
    cds.env.requires['change-tracking'].disableDeleteTracking = true;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    const testingSRV = await cds.connect.to('VariantTesting');
    const ID = cds.utils.uuid();
    await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });
    await cds.delete(testingSRV.entities.Level2Sample).where({ ID });

    let changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      attribute: 'title',
      entityKey: ID,
      modification: 'delete'
    });
    expect(changes.length).toEqual(0);

    cds.env.requires['change-tracking'].disableDeleteTracking = false;
    await regenerateTriggers('sap.change_tracking.Level2Sample');
    await INSERT.into(testingSRV.entities.Level2Sample).entries({ ID, title: 'ABC' });
    await cds.delete(testingSRV.entities.Level2Sample).where({ ID });

    changes = await SELECT.from(testingSRV.entities.ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      attribute: 'title',
      entityKey: ID,
      modification: 'delete'
    });
    expect(changes.length).toEqual(1);
  });

  it('maxDisplayHierarchyDepth controls auto-discovery of composition targets', async () => {
    const originalDepth = cds.env.requires['change-tracking'].maxDisplayHierarchyDepth;

    cds.env.requires['change-tracking'].maxDisplayHierarchyDepth = 1;
    await regenerateTriggers(variantEntities);

    const variantSrv = await cds.connect.to('VariantTesting');
    const { ChangeView } = variantSrv.entities;

    const rootID = cds.utils.uuid();
    const level1ID = cds.utils.uuid();
    const level2ID = cds.utils.uuid();

    // Deep insert not possible because of limitation
    await POST(`/odata/v4/variant-testing/RootSample`, {
      ID: rootID,
      title: 'Root for depth test',
      children: [
        {
          ID: level1ID,
          title: 'Level1 for depth test'
        }
      ]
    });

    await PATCH(`/odata/v4/variant-testing/Level1Sample(ID=${level1ID})`, {
      children: [
        {
          ID: level2ID,
          title: 'Level2 for depth test'
        }
      ]
    });

    const rootChanges = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.RootSample',
      entityKey: rootID,
      attribute: 'title'
    });

    cds.env.requires['change-tracking'].maxDisplayHierarchyDepth = originalDepth;
    await regenerateTriggers(variantEntities);

    expect(rootChanges.length).toEqual(1);
    expect(rootChanges[0]).toMatchObject({
      modification: 'create',
      valueChangedTo: 'Root for depth test'
    });

    const level1Changes = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level1Sample',
      entityKey: level1ID,
      attribute: 'title'
    });
    expect(level1Changes.length).toEqual(1);
    expect(level1Changes[0]).toMatchObject({
      modification: 'create',
      valueChangedTo: 'Level1 for depth test',
      parent_entity: 'sap.change_tracking.RootSample',
      parent_entityKey: rootID
    });

    const level2Changes = await SELECT.from(ChangeView).where({
      entity: 'sap.change_tracking.Level2Sample',
      entityKey: level2ID,
      attribute: 'title'
    });
    expect(level2Changes.length).toEqual(1);
    expect(level2Changes[0]).toMatchObject({
      modification: 'create',
      valueChangedTo: 'Level2 for depth test',
      parent_entity: 'sap.change_tracking.Level1Sample',
      parent_entityKey: level1ID,
      parent_parent_entity: null, // should not have parent_parent_entity since maxDisplayHierarchyDepth is 1
      parent_parent_entityKey: null
    });
  });
});
