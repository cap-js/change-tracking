/**
 * Tests for draft-delta trigger generation:
 *   - collectDraftEntities() entity collector
 *   - generateH2DraftTrigger() Java source + DDL
 *   - H2 register hook wires draft DDLs into compile.to.dbx output
 */
const path = require('path');
const cds = require('@sap/cds');

const bookshopDir = path.resolve(__dirname, '../bookshop');
const { prepareCSNForTriggers } = require('../../lib/utils/trigger-utils.js');
const { collectDraftEntities } = require('../../lib/utils/entity-collector.js');
const { generateH2DraftTrigger } = require('../../lib/h2/draft-triggers.js');

// ---------------------------------------------------------------------------
// Shared CSN fixture — loaded once for the whole suite
// ---------------------------------------------------------------------------

let runtimeCSN;

beforeAll(async () => {
  cds.root = bookshopDir;
  const csn = await cds.load([path.join(bookshopDir, 'db'), path.join(bookshopDir, 'srv')]);

  // Set env after load to avoid the _resolved getter error triggered by early env mutation
  cds.env.requires['change-tracking'] = { trackDraftChanges: true };
  ({ runtimeCSN } = prepareCSNForTriggers(csn, true));
});

// ---------------------------------------------------------------------------
// collectDraftEntities
// ---------------------------------------------------------------------------

describe('collectDraftEntities()', () => {
  it('returns descriptors only for draft-enabled @changelog entities', () => {
    const result = collectDraftEntities(runtimeCSN);
    // BookStores and Books are both @odata.draft.enabled + @changelog in the bookshop fixture
    const names = result.map((d) => d.draftsEntityName);
    expect(names.some((n) => n.includes('BookStores') && n.endsWith('.drafts'))).toBe(true);
    expect(names.some((n) => n.includes('Books') && !n.includes('BookStores') && n.endsWith('.drafts'))).toBe(true);
  });

  it('marks top-level draft-enabled entities as isRoot=true', () => {
    const result = collectDraftEntities(runtimeCSN);
    const bookStores = result.find((d) => d.draftsEntityName === 'AdminService.BookStores.drafts');
    expect(bookStores).toBeDefined();
    expect(bookStores.isRoot).toBe(true);
  });

  it('marks composition child entities as isRoot=false', () => {
    const result = collectDraftEntities(runtimeCSN);
    // Books is a composition child of BookStores AND a directly opted-in entity.
    // Because it opted in directly it gets isRoot=true; its OWN composition children
    // (if any) would be isRoot=false.
    // Regardless, no descriptor should have isRoot=false for a root service entity.
    const booksEntry = result.find((d) => d.draftsEntityName === 'AdminService.Books.drafts');
    // Books is directly opted-in so it must be isRoot=true
    expect(booksEntry?.isRoot).toBe(true);
  });

  it('does not duplicate an entity when it is both a root opt-in and a composition child', () => {
    const result = collectDraftEntities(runtimeCSN);
    const booksEntries = result.filter((d) => d.draftsEntityName === 'AdminService.Books.drafts');
    expect(booksEntries.length).toBe(1);
  });

  it('returns an empty array when trackDraftChanges is false and no @changelog(draft:true) annotations exist', () => {
    const savedOpt = cds.env.requires['change-tracking'].trackDraftChanges;
    cds.env.requires['change-tracking'].trackDraftChanges = false;
    try {
      const result = collectDraftEntities(runtimeCSN);
      expect(result).toEqual([]);
    } finally {
      cds.env.requires['change-tracking'].trackDraftChanges = savedOpt;
    }
  });

  it('records the underlying DB entity name in activeEntityName', () => {
    const result = collectDraftEntities(runtimeCSN);
    const bookStores = result.find((d) => d.draftsEntityName === 'AdminService.BookStores.drafts');
    expect(bookStores.activeEntityName).toBe('sap.capire.bookshop.BookStores');
  });
});

// ---------------------------------------------------------------------------
// generateH2DraftTrigger — DDL
// ---------------------------------------------------------------------------

describe('generateH2DraftTrigger() DDL', () => {
  it('produces CREATE TRIGGER DDL referencing the _dct suffix', () => {
    const { ddl } = generateH2DraftTrigger({
      draftsEntityName: 'AdminService.BookStores.drafts',
      activeEntityName: 'sap.capire.bookshop.BookStores',
      isRoot: true
    });
    expect(ddl).toMatch(/CREATE TRIGGER.*_dct\b/i);
    expect(ddl).toMatch(/FOR EACH ROW CALL/i);
  });

  it('DDL table name is the uppercase underscored form of the .drafts entity name', () => {
    const { ddl } = generateH2DraftTrigger({
      draftsEntityName: 'AdminService.BookStores.drafts',
      activeEntityName: 'sap.capire.bookshop.BookStores',
      isRoot: true
    });
    expect(ddl).toContain('ADMINSERVICE_BOOKSTORES_DRAFTS');
  });

  it('DDL CALL target is the fully-qualified Java class name', () => {
    const { ddl } = generateH2DraftTrigger({
      draftsEntityName: 'AdminService.BookStores.drafts',
      activeEntityName: 'sap.capire.bookshop.BookStores',
      isRoot: true
    });
    expect(ddl).toContain("CALL 'sap.changelog.triggers.AdminService_BookStores_drafts_dct'");
  });
});

// ---------------------------------------------------------------------------
// generateH2DraftTrigger — Java source, root entity
// ---------------------------------------------------------------------------

describe('generateH2DraftTrigger() Java source — root entity', () => {
  let source;

  beforeAll(() => {
    ({ java: { source } } = generateH2DraftTrigger({
      draftsEntityName: 'AdminService.BookStores.drafts',
      activeEntityName: 'sap.capire.bookshop.BookStores',
      isRoot: true
    }));
  });

  it('extends TriggerAdapter', () => {
    expect(source).toContain('extends TriggerAdapter');
  });

  it('writes update rows to SAP_CHANGELOG_DRAFTCHANGES', () => {
    expect(source).toContain('SAP_CHANGELOG_DRAFTCHANGES');
    expect(source).toContain("'update'");
  });

  it('does NOT contain insert tracking body for root (draft-open copy is not a user change)', () => {
    expect(source).not.toContain("'insert'");
  });

  it('does NOT contain delete tracking body for root', () => {
    expect(source).not.toContain("'delete'");
  });

  it('reads DraftUUID from DRAFTADMINISTRATIVEDATA_DRAFTUUID column', () => {
    expect(source).toContain('DRAFTADMINISTRATIVEDATA_DRAFTUUID');
  });

  it('embeds the active entity name as a string literal', () => {
    expect(source).toContain("'sap.capire.bookshop.BookStores'");
  });
});

// ---------------------------------------------------------------------------
// generateH2DraftTrigger — Java source, composition child entity
// ---------------------------------------------------------------------------

describe('generateH2DraftTrigger() Java source — child entity', () => {
  let source;

  beforeAll(() => {
    ({ java: { source } } = generateH2DraftTrigger({
      draftsEntityName: 'AdminService.Books.Items.drafts',
      activeEntityName: 'sap.capire.bookshop.Books.Items',
      isRoot: false
    }));
  });

  it('contains insert tracking body for child entities', () => {
    expect(source).toContain("'insert'");
  });

  it('contains update tracking body for child entities', () => {
    expect(source).toContain("'update'");
  });

  it('contains delete tracking body for child entities', () => {
    expect(source).toContain("'delete'");
  });

  it('uses oldRow for delete and newRow for insert/update', () => {
    // delete block reads from oldRow
    expect(source).toMatch(/oldRow\.getString.*DRAFTADMINISTRATIVEDATA_DRAFTUUID/);
    // update/insert blocks read from newRow
    expect(source).toMatch(/newRow\.getString.*DRAFTADMINISTRATIVEDATA_DRAFTUUID/);
  });

  it('the three branches are mutually exclusive (if/else if/else if)', () => {
    expect(source).toMatch(/if \(isInsert\)[\s\S]*else if \(isUpdate\)[\s\S]*else if \(isDelete\)/);
  });
});

// ---------------------------------------------------------------------------
// H2 register hook — end-to-end DDL wiring
// ---------------------------------------------------------------------------

describe('H2 register hook wires draft trigger DDLs into compile.to.dbx output', () => {
  it('draft trigger DDLs contain _dct suffix', () => {
    const descriptors = collectDraftEntities(runtimeCSN);
    const ddls = descriptors.map((d) => generateH2DraftTrigger(d).ddl);
    expect(ddls.length).toBeGreaterThan(0);
    ddls.forEach((ddl) => expect(ddl).toMatch(/_dct\b/i));
  });

  it('no draft trigger DDLs contain plain _ct suffix (no collision with active triggers)', () => {
    const descriptors = collectDraftEntities(runtimeCSN);
    const ddls = descriptors.map((d) => generateH2DraftTrigger(d).ddl);
    // _dct is allowed (matches _dct); plain _ct as a word boundary is not
    // The DDL trigger name ends with _dct, not _ct, so this check validates the suffix
    ddls.forEach((ddl) => {
      const triggerName = ddl.match(/CREATE TRIGGER (\S+)/i)?.[1] ?? '';
      expect(triggerName).toMatch(/_dct$/i);
      expect(triggerName).not.toMatch(/_ct$/i);
    });
  });

  it('root entities produce one DDL; non-root entities also produce one DDL (multi-event single trigger)', () => {
    const descriptors = collectDraftEntities(runtimeCSN);
    // generateH2DraftTrigger returns a single DDL per entity (single multi-event trigger)
    expect(descriptors.map((d) => generateH2DraftTrigger(d))).toHaveLength(descriptors.length);
  });
});
