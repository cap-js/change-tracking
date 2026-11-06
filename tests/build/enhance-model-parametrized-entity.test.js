const cds = require('@sap/cds');
const path = require('path');
const { enhanceModel } = require('../../lib/csn-enhancements');

void cds.test;

describe('enhanceModel', () => {
  it('supports a service containing a projection on an entity with parameters (regression: #387)', async () => {
    const csn = await cds.load(path.join(__dirname, 'fixtures/parametrized-entity.cds'), { silent: true });

    expect(() => enhanceModel(csn)).not.toThrow();
    expect(csn.definitions['my.MyService.ChangeView']).toBeDefined();
    expect(csn.definitions['my.MyService.Books'].elements.changes).toMatchObject({
      target: 'my.MyService.ChangeView'
    });
  });
});
