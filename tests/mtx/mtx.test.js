const isJavaEnv = /java/i.test(process.env.CDS_ENV || '');

if (isJavaEnv) {
  describe.skip('Change-Tracking MTX (skipped: Java)', () => {
    it('MTX is a Node.js only feature', () => {});
  });
} else {
  process.env.CDS_ENV = process.env.CDS_ENV ? `${process.env.CDS_ENV},with-mtx` : 'with-mtx';

  const cds = require('@sap/cds');
  const path = require('path');
  const { DatabaseSync } = require('node:sqlite');
  const { APP_DIR, ensureSidecarPlugin, cleanDbFiles, startSidecar, subscribeTenant, upgradeTenant, stopSidecar } = require('./setup');

  const { axios, POST, GET } = cds.test(APP_DIR);
  axios.defaults.auth = { username: 'alice' };

  const isSqlite = cds.env.requires?.db?.kind === 'sqlite';
  const describeIfSqlite = isSqlite ? describe : describe.skip;
  let sidecar;

  if (isSqlite) {
    beforeAll(async () => {
      ensureSidecarPlugin();
      cleanDbFiles();
      sidecar = await startSidecar();
      const t1Status = await subscribeTenant('t1', sidecar.port);
      const t2Status = await subscribeTenant('t2', sidecar.port);
      expect(t1Status).toBeLessThan(300);
      expect(t2Status).toBeLessThan(300);
    });

    afterAll(async () => {
      await stopSidecar(sidecar?.proc);
    });
  }

  describeIfSqlite('Change-Tracking MTX', () => {
    describe('Tenant subscription deploys change-tracking artifacts', () => {
      it('deploys triggers', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
        expect(triggers.length).toBeGreaterThan(0);
        db.close();
      });

      it('deploys indexes', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%changelog%'").all();
        expect(indexes.some((i) => i.name === 'sap_changelog_Changes_ct_index')).toBe(true);
        expect(indexes.some((i) => i.name === 'sap_changelog_Changes_parent_index')).toBe(true);
        db.close();
      });

      it('deploys service-level ChangeViews', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const views = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ChangeView%'").all();
        expect(views.some((v) => v.name === 'AdminService_ChangeView')).toBe(true);
        db.close();
      });

      it('deploys i18n labels', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
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
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
        expect(triggers.length).toBeGreaterThan(0);
        db.close();
      });

      it('ChangeViews still exist after upgrade', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const views = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ChangeView%'").all();
        expect(views.some((v) => v.name === 'AdminService_ChangeView')).toBe(true);
        db.close();
      });

      it('labels still exist after upgrade', () => {
        const db = new DatabaseSync(path.join(APP_DIR, 'db-t1.sqlite'), { readOnly: true });
        const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM sap_changelog_i18nKeys').get();
        expect(cnt).toBeGreaterThan(0);
        db.close();
      });
    });

    describe('Model enhancement for tenant-specific models', () => {
      it('tenant runtime CSN has AdminService.ChangeView', async () => {
        const mps = await cds.connect.to('cds.xt.ModelProviderService');
        const csn = await mps.getCsn({ tenant: 't1', toggles: ['*'] });
        const model = cds.compile.for.nodejs(csn);
        expect(model.definitions['AdminService.ChangeView']).toBeDefined();
      });

      it('tenant runtime CSN has changes association on tracked entities', async () => {
        const mps = await cds.connect.to('cds.xt.ModelProviderService');
        const csn = await mps.getCsn({ tenant: 't1', toggles: ['*'] });
        const model = cds.compile.for.nodejs(csn);
        expect(model.definitions['AdminService.BookStores'].elements.changes).toBeDefined();
        expect(model.definitions['AdminService.BookStores'].elements.changes.target).toBe('AdminService.ChangeView');
      });

      it('OData $metadata exposes ChangeView entity type', async () => {
        const { data } = await GET('/odata/v4/admin/$metadata', {
          auth: { username: 'alice' } // -> tenant t1
        });
        expect(data).toContain('ChangeView');
      });

      it('OData $metadata exposes changes navigation property', async () => {
        const { data } = await GET('/odata/v4/admin/$metadata', {
          auth: { username: 'alice' } // -> tenant t1
        });
        expect(data).toContain('NavigationProperty Name="changes"');
      });
    });

    describe('Change-log records via HTTP for Books', () => {
      const createBook = async (bookData, username = 'alice') => {
        const auth = { username };
        const { data: store } = await POST('/odata/v4/admin/BookStores', { name: 'Store-' + cds.utils.uuid().slice(0, 8) }, { auth });
        const bookID = cds.utils.uuid();
        await POST(`/odata/v4/admin/BookStores(ID=${store.ID},IsActiveEntity=false)/books`, { ID: bookID, ...bookData }, { auth });
        await POST(`/odata/v4/admin/BookStores(ID=${store.ID},IsActiveEntity=false)/AdminService.draftActivate`, {}, { auth });
        return bookID;
      };

      it('logs change records when fred creates a Book (tenant t2, isbn feature)', async () => {
        const bookTitle = 'Book-' + cds.utils.uuid().slice(0, 3);
        const bookID = await createBook({ title: bookTitle, descr: 'A test book' }, 'fred');

        const {
          data: { value: changes }
        } = await GET(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=true)/changes`, {
          auth: { username: 'fred' } // -> tenant t2
        });

        expect(changes.length).toBe(2);
        const titleChange = changes.find((c) => c.attribute === 'title');
        expect(titleChange).toMatchObject({
          entity: 'sap.capire.bookshop.Books',
          attribute: 'title',
          modification: 'create',
          modificationLabel: 'Create',
          valueChangedFrom: null,
          valueChangedTo: bookTitle
        });
        const descrChange = changes.find((c) => c.attribute === 'descr');
        expect(descrChange).toMatchObject({
          attribute: 'descr',
          modification: 'create',
          valueChangedTo: 'A test book'
        });
      });

      it('tracks the feature-toggled isbn column when fred creates a Book', async () => {
        // `isbn` exists only because the `isbn` feature toggle is active for fred (tenant t2)
        const isbnValue = '978-0345391803';
        const bookID = await createBook({ title: 'Book-with-isbn', descr: 'A test book with ISBN', isbn: isbnValue }, 'fred');

        const {
          data: { value: changes }
        } = await GET(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=true)/changes`, {
          auth: { username: 'fred' } // -> tenant t2
        });

        expect(changes.length).toBe(3);
        const isbnChange = changes.find((c) => c.attribute === 'isbn');
        expect(isbnChange).toBeTruthy();
        expect(isbnChange).toMatchObject({
          entity: 'sap.capire.bookshop.Books',
          attribute: 'isbn',
          modification: 'create',
          valueChangedFrom: null,
          valueChangedTo: isbnValue
        });
      });

      it('tracks the feature-toggled stock annotation when fred creates a Book', async () => {
        // `stock` exists in the base schema but is only annotated with @changelog when the `isbn` feature toggle is active
        const bookID = await createBook({ title: 'Book-with-stock', stock: 42 }, 'fred');

        const {
          data: { value: changes }
        } = await GET(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=true)/changes`, {
          auth: { username: 'fred' } // -> tenant t2
        });

        expect(changes.length).toBe(2);
        const stockChange = changes.find((c) => c.attribute === 'stock');
        expect(stockChange).toBeTruthy();
        expect(stockChange).toMatchObject({
          entity: 'sap.capire.bookshop.Books',
          attribute: 'stock',
          modification: 'create',
          valueChangedFrom: null,
          valueChangedTo: '42'
        });
      });

      // The tests asserts the intended user-level feature-toggle gating, which is not yet implemented.
      // Triggers are deployed at tenant subscription time and fire regardless of the request user's features.
      // Add request-time gating via session variables that suppress writes for entities/elements whose @changelog only exists due to a feature the current user lacks.
      it.skip('does not track stock when isbn toggle is not set (dave on tenant t1, features:[])', async () => {
        const bookID = await createBook({ title: 'Book-no-features', stock: 99 }, 'dave');

        const {
          data: { value: changes }
        } = await GET(`/odata/v4/admin/Books(ID=${bookID},IsActiveEntity=true)/changes`, {
          auth: { username: 'dave' }
        });

        // Sanity: title IS tracked (annotated in admin-service.cds, base model)
        expect(changes.find((c) => c.attribute === 'title')).toBeTruthy();
        // stock @changelog only applies under the isbn feature toggle -> NOT tracked for dave
        expect(changes.find((c) => c.attribute === 'stock')).toBeFalsy();
        // isbn column doesn't exist for dave -> no change record for it either
        expect(changes.find((c) => c.attribute === 'isbn')).toBeFalsy();
      });
    });
  });
}
