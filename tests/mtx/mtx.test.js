process.env.CDS_ENV = 'with-mtx';

const cds = require('@sap/cds');
const path = require('path');
const { APP_DIR, ensureSidecarPlugin, cleanDbFiles, startSidecar, subscribeTenant, upgradeTenant, stopSidecar } = require('./setup');

jest.setTimeout(60_000);

const isSqlite = cds.env.requires?.db?.kind === 'sqlite' || cds.env.requires?.db?.kind === 'better-sqlite';

const describeIfSqlite = isSqlite ? describe : describe.skip;

let sidecar;

if (isSqlite) {
  beforeAll(async () => {
    ensureSidecarPlugin();
    cleanDbFiles();
    sidecar = await startSidecar();
    const status = await subscribeTenant('t1', sidecar.port);
    expect(status).toBeLessThan(300);
  });

  afterAll(async () => {
    await stopSidecar(sidecar?.proc);
  });

  const { axios } = cds.test(APP_DIR);
  axios.defaults.auth = { username: 'alice' };
}

describeIfSqlite('Change-Tracking MTX', () => {

  describe('Tenant subscription deploys change-tracking artifacts', () => {
    it('deploys triggers', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
      expect(triggers.length).toBeGreaterThan(0);
      db.close();
    });

    it('deploys indexes', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%changelog%'").all();
      expect(indexes.some((i) => i.name === 'sap_changelog_Changes_ct_index')).toBe(true);
      expect(indexes.some((i) => i.name === 'sap_changelog_Changes_parent_index')).toBe(true);
      db.close();
    });

    it('deploys service-level ChangeViews', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const views = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ChangeView%'").all();
      expect(views.some((v) => v.name === 'AdminService_ChangeView')).toBe(true);
      db.close();
    });

    it('deploys i18n labels', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM sap_changelog_i18nKeys').get();
      expect(cnt).toBeGreaterThan(0);
      db.close();
    });
  });

  describe('Tenant upgrade re-deploys artifacts', () => {
    it('upgrade succeeds', async () => {
      const status = await upgradeTenant('t1', sidecar.port);
      expect(status).toBeLessThan(300);
    });

    it('triggers still exist after upgrade', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
      expect(triggers.length).toBeGreaterThan(0);
      db.close();
    });

    it('ChangeViews still exist after upgrade', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const views = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ChangeView%'").all();
      expect(views.some((v) => v.name === 'AdminService_ChangeView')).toBe(true);
      db.close();
    });

    it('labels still exist after upgrade', () => {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(APP_DIR, 'db-t1.sqlite'), { readonly: true });
      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM sap_changelog_i18nKeys').get();
      expect(cnt).toBeGreaterThan(0);
      db.close();
    });
  });

  describe('Model enhancement via compile.for.runtime', () => {
    it('enhances tenant CSN with AdminService.ChangeView', () => {
      // Verify enhanceModel is applied when compiling for runtime
      // Load the app model (which goes through compile.for.runtime)
      const csn = cds.model;
      expect(csn.definitions['AdminService.ChangeView']).toBeDefined();
    });

    it('adds changes association to tracked entities', () => {
      const csn = cds.model;
      expect(csn.definitions['AdminService.BookStores'].elements.changes).toBeDefined();
      expect(csn.definitions['AdminService.BookStores'].elements.changes.target).toBe('AdminService.ChangeView');
    });
  });
});
