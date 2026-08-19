const cds = require('@sap/cds');
const path = require('path');
const { enhanceModel } = require('../../lib/csn-enhancements');

const BOOKSHOP_MTX = path.resolve(__dirname, '../bookshop-mtx');
void cds.test;

let loadedCsn;

beforeAll(async () => {
  const pluginIndex = path.resolve(__dirname, '../../index.cds');
  loadedCsn = await cds.load([path.join(BOOKSHOP_MTX, 'db'), path.join(BOOKSHOP_MTX, 'srv'), pluginIndex], { silent: true });
});

const freshCsn = () => structuredClone(loadedCsn);

describe('enhanceModel is idempotent across cds.extend().with() (regression: duplicate parent_entityKey)', () => {
  it('cds.extend().with() drops meta.sap.changelog.enhanced', () => {
    const base = freshCsn();
    enhanceModel(base);
    expect(base.meta?.['sap.changelog.enhanced']).toBe(true);
    const extended = cds.extend(base).with({ definitions: {}, extensions: [] });
    expect(extended.meta?.['sap.changelog.enhanced']).toBeUndefined();
  });

  it('enhanceModel does not duplicate parent_entityKey columns when run twice on an extended CSN', () => {
    const base = freshCsn();
    enhanceModel(base);

    const extended = cds.extend(base).with({ definitions: {}, extensions: [] });

    // Simulate the plugin's srv.after(['getCsn','getExtCsn'], enhanceModel) hook
    enhanceModel(extended);

    const columns = extended.definitions?.['sap.changelog.ChangeView']?.query?.SELECT?.columns ?? [];
    const dupCount = columns.filter((c) => c?.as === 'parent_entityKey').length;
    expect(dupCount).toBe(1);
  });

  it('cds.compile.to.sql succeeds on a twice-enhanced extended CSN', () => {
    const base = freshCsn();
    enhanceModel(base);
    const extended = cds.extend(base).with({ definitions: {}, extensions: [] });
    enhanceModel(extended);

    let caught;
    try {
      cds.compile.to.sql(extended, { dialect: 'sqlite' });
    } catch (err) {
      caught = err;
    }
    // The customer's exact error signature we must never see again:
    //   Error: Duplicate definition of element "parent_entityKey"
    //     (in entity:"sap.changelog.ChangeView"/query:1)
    expect(caught?.message ?? '').not.toMatch(/Duplicate definition of element .*parent_entityKey/);
    expect(caught).toBeUndefined();
  });

  it('does not duplicate the changes column on service entities after double-enhance', () => {
    const base = freshCsn();
    enhanceModel(base);
    const extended = cds.extend(base).with({ definitions: {}, extensions: [] });
    enhanceModel(extended);

    for (const name of Object.keys(extended.definitions)) {
      const def = extended.definitions[name];
      const cqn = def.query?.SELECT ?? def.projection;
      if (!cqn?.columns) continue;
      const changesCount = cqn.columns.filter((c) => c?.as === 'changes').length;
      expect(changesCount, `entity ${name} has ${changesCount} 'changes' columns`).toBeLessThanOrEqual(1);
    }
  });
});
