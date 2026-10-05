const cds = require('@sap/cds');
const bookshop = require('path').resolve(__dirname, './../bookshop');
cds.test(bookshop);

// Change tracking on CDS-generated localized text tables
// The `.texts` table is a composition-of-many child of its base entity, linked
// via the base composition's on-condition (`texts.ID = ID`). Change records for
// localized fields therefore surface under the parent entity's change history.
describe('change tracking on localized texts (.texts)', () => {
  const BASE = 'sap.capire.bookshop.Books';
  const TEXTS = 'sap.capire.bookshop.Books.texts';

  async function seedBook() {
    const { Books } = cds.entities('sap.capire.bookshop');
    const ID = cds.utils.uuid();
    await INSERT.into(Books).entries({ ID, stock: 1 });
    return ID;
  }

  it('logs a create on Books.texts and links it to the parent Book', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const bookID = await seedBook();
    const { 'sap.capire.bookshop.Books.texts': BooksTexts } = cds.model.definitions;
    await INSERT.into(BooksTexts).entries({
      ID_texts: cds.utils.uuid(),
      ID: bookID,
      locale: 'de',
      title: 'Sturmhöhe',
      descr: 'Ein Roman von Emily Brontë'
    });

    // The Book's `texts` composition entry (keyed by the Book's ID)
    const parentChange = await SELECT.one.from(ChangeView).where({
      entity: BASE,
      entityKey: bookID,
      attribute: 'texts',
      valueDataType: 'cds.Composition'
    });
    expect(parentChange).toBeTruthy();

    // Text field change entries, linked to the Book's texts composition entry
    const textChanges = await SELECT.from(ChangeView).where({
      entity: TEXTS,
      parent_ID: parentChange.ID,
      modification: 'create'
    });
    const byAttr = Object.fromEntries(textChanges.map((c) => [c.attribute, c]));

    expect(byAttr.locale).toMatchObject({ valueChangedFrom: null, valueChangedTo: 'de' });
    expect(byAttr.title).toMatchObject({ valueChangedFrom: null, valueChangedTo: 'Sturmhöhe' });
    expect(byAttr.descr).toMatchObject({ valueChangedFrom: null, valueChangedTo: 'Ein Roman von Emily Brontë' });
  });

  it('logs old and new values when updating a localized text', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const bookID = await seedBook();
    const { 'sap.capire.bookshop.Books.texts': BooksTexts } = cds.model.definitions;
    const textsID = cds.utils.uuid();
    await INSERT.into(BooksTexts).entries({ ID_texts: textsID, ID: bookID, locale: 'fr', title: 'Origine' });

    await UPDATE(BooksTexts).set({ title: 'Les Hauts de Hurlevent' }).where({ ID_texts: textsID });

    const updateChange = await SELECT.one.from(ChangeView).where({
      entity: TEXTS,
      entityKey: { like: `%${textsID}%` },
      attribute: 'title',
      modification: 'update'
    });
    expect(updateChange).toMatchObject({
      valueChangedFrom: 'Origine',
      valueChangedTo: 'Les Hauts de Hurlevent'
    });
  });

  it('logs a delete on a localized text', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const bookID = await seedBook();
    const { 'sap.capire.bookshop.Books.texts': BooksTexts } = cds.model.definitions;
    const textsID = cds.utils.uuid();
    await INSERT.into(BooksTexts).entries({ ID_texts: textsID, ID: bookID, locale: 'de', title: 'Zu löschen' });

    await DELETE.from(BooksTexts).where({ ID_texts: textsID });

    const titleDelete = await SELECT.one.from(ChangeView).where({
      entity: TEXTS,
      entityKey: { like: `%${textsID}%` },
      attribute: 'title',
      modification: 'delete'
    });
    expect(titleDelete).toBeTruthy();
    expect(titleDelete.valueChangedFrom).toEqual('Zu löschen');
    expect(titleDelete.valueChangedTo).toEqual(null);
  });

  it('captures the locale as the objectID of the localized text change entries', async () => {
    const adminService = await cds.connect.to('AdminService');
    const { ChangeView } = adminService.entities;

    const bookID = await seedBook();
    const { 'sap.capire.bookshop.Books.texts': BooksTexts } = cds.model.definitions;
    const textsID = cds.utils.uuid();
    await INSERT.into(BooksTexts).entries({ ID_texts: textsID, ID: bookID, locale: 'fr', title: 'Titre' });

    // The entity-level `@changelog: [locale]` on Books.texts makes the locale the
    // objectID of the text change entries, so a reader sees which language changed.
    const titleChange = await SELECT.one.from(ChangeView).where({
      entity: TEXTS,
      entityKey: { like: `%${textsID}%` },
      attribute: 'title',
      modification: 'create'
    });
    expect(titleChange).toBeTruthy();
    expect(titleChange.objectID).toEqual('fr');
  });
});
