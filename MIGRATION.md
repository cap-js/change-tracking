# Migration Guide: Change Tracking v1.x to v2.x (Trigger-Based)

This document provides a comprehensive guide for migrating from the event-handler-based change tracking (v1.x / `main` branch) to the new trigger-based change tracking (v2.x / `feat/hana-trigger` branch).

## Table of Contents

1. [Overview](#1-overview)
2. [Breaking Changes Summary](#2-breaking-changes-summary)
3. [Pre-Migration Checklist](#3-pre-migration-checklist)
4. [Database Schema Migration](#4-database-schema-migration)
5. [Configuration Changes](#5-configuration-changes)
6. [Build & Deployment](#6-build--deployment)
7. [Post-Migration Verification](#7-post-migration-verification)
8. [Rollback Strategy](#8-rollback-strategy)

---

## 1. Overview

### What Changed

The change tracking plugin has undergone a fundamental architectural change:

| Aspect | v1.x (Main Branch) | v2.x (Trigger-Based) |
|--------|-------------------|----------------------|
| **Change Capture Mechanism** | Node.js `BEFORE` event handlers on `cds.db` | Native database triggers |
| **Schema Structure** | Two entities: `ChangeLog` (parent) + `Changes` (child) | Single flat `Changes` entity |
| **Internationalization** | Runtime localization via `_afterReadChangeView` handler | `i18nKeys` table with database-level `COALESCE` lookups |
| **Composition Handling** | `parentEntityID` / `parentKey` fields | `rootEntity` / `rootEntityKey` / `rootObjectID` fields |
| **Association Pattern** | `changes.entityKey = ID` | `changes.entityKey = ID AND changes.entity = 'ENTITY' OR changes.rootEntityKey = ID AND changes.rootEntity = 'ROOTENTITY'` |

### Benefits of the New Architecture

1. **Reliability**: Changes are captured at the database level, ensuring no changes are missed even during application failures
2. **Consistency**: All changes go through the same trigger logic regardless of the client (Node.js, Java, direct SQL)
3. **Performance**: Reduced application-level overhead; bulk operations are handled efficiently by the database
4. **Multi-Runtime Support**: Works with both CAP Node.js and CAP Java applications
5. **Database-Native i18n**: Localization happens at query time via SQL `COALESCE`, reducing runtime processing

### Supported Databases

- **SQLite** (in-memory triggers for development)
- **PostgreSQL** (PL/pgSQL functions and triggers)
- **SAP HANA / HDI** (`.hdbtrigger` artifacts)
- **H2** (Java TriggerAdapter for CAP Java)

---

## 2. Breaking Changes Summary

### 2.1 Schema Changes

#### Removed Entities

| Entity | Reason |
|--------|--------|
| `sap.changelog.ChangeLog` | Flattened into `Changes` entity; parent-child relationship eliminated |

#### New Entities

| Entity | Purpose |
|--------|---------|
| `sap.changelog.i18nKeys` | Stores localized labels for attributes, entities, and modifications |
| `sap.changelog.CHANGE_TRACKING_DUMMY` | Helper entity for HANA trigger execution |

#### Modified Entity: `sap.changelog.Changes`

**Removed Columns:**

| Column | Replacement |
|--------|-------------|
| `keys` | No longer needed |
| `entityID` | Renamed to `objectID` |
| `serviceEntity` | No longer needed (trigger model doesn't track service layer) |
| `parentEntityID` | Renamed to `rootObjectID` |
| `parentKey` | Renamed to `rootEntityKey` |
| `serviceEntityPath` | No longer needed |
| `changeLog` (FK) | Parent entity eliminated |

**New Columns:**

| Column | Type | Purpose |
|--------|------|---------|
| `valueChangedFromLabel` | String(5000) | Localized label for old value |
| `valueChangedToLabel` | String(5000) | Localized label for new value |
| `entityKey` | String(5000) | Primary key of the changed entity (moved from ChangeLog) |
| `rootEntity` | String(5000) | Root entity name in composition hierarchy |
| `rootEntityKey` | String(5000) | Primary key of the root entity |
| `objectID` | String(5000) | Business-meaningful object identifier |
| `rootObjectID` | String(5000) | Business-meaningful root object identifier |
| `createdAt` | Timestamp | When the change was recorded (moved from ChangeLog) |
| `createdBy` | String | Who made the change (moved from ChangeLog) |
| `transactionID` | Int64 | Groups changes within the same transaction |

### 2.2 ChangeView Column Changes

The `ChangeView` now exposes localized label columns:

| Old Column | New Column | Notes |
|------------|------------|-------|
| `entity` | `entityLabel` | Localized via `i18nKeys` lookup |
| `attribute` | `attributeLabel` | Localized via `i18nKeys` lookup |
| `modification` | `modificationLabel` | Localized via `i18nKeys` lookup |
| `objectID` | `objectID` | Now localized via `i18nKeys` lookup |
| `parentObjectID` | `rootObjectID` | Renamed and localized |
| `valueChangedFrom` | `valueChangedFromLabel` | Falls back to raw value if no label |
| `valueChangedTo` | `valueChangedToLabel` | Falls back to raw value if no label |

### 2.3 API Changes

#### Removed Runtime Handlers

The following handlers are no longer registered (replaced by database triggers):

```javascript
// v1.x - These are REMOVED in v2.x
cds.db.before('CREATE', entity, track_changes);
cds.db.before('UPDATE', entity, track_changes);
cds.db.before('DELETE', entity, track_changes);
```

#### New Session Variable Control

Runtime skip control is now available via session variables:

```javascript
// Skip all change tracking for current transaction
req._tx.set({ 'ct.skip': 'true' });

// Skip specific entity
req._tx.set({ 'ct.skip_entity.my_namespace_MyEntity': 'true' });

// Skip specific element
req._tx.set({ 'ct.skip_element.my_namespace_MyEntity.fieldName': 'true' });
```

### 2.4 Annotation Changes

No changes to the `@changelog` annotation syntax. All existing annotations remain compatible:

```cds
// These continue to work as before
@changelog: [title, author.name]
entity Books {
  @changelog title  : String;
  @changelog author : Association to Authors;
}
```

**New annotation behavior:**

- `@changelog: false` on a service entity now sets a session variable to skip tracking for that entity
- `@changelog: false` on an element skips tracking for that specific field

---

## 3. Pre-Migration Checklist

Before starting the migration, ensure you have:

- [ ] **Backed up your database** - The migration involves dropping tables
- [ ] **Documented any custom queries** against `ChangeLog` or `Changes` tables
- [ ] **Identified any custom UI components** that reference `ChangeView` columns
- [ ] **Tested the new version** in a development environment first
- [ ] **Reviewed the column mapping** to understand data transformation
- [ ] **Scheduled a maintenance window** if migrating a production system

---

## 4. Database Schema Migration

### 4.1 Column Mapping Reference

Use this mapping to understand how data is transformed during migration:

| Source (v1.x) | Target (v2.x) | Transformation |
|---------------|---------------|----------------|
| `ChangeLog.ID` | *(dropped)* | Parent entity eliminated |
| `ChangeLog.entityKey` | `Changes.entityKey` | Direct copy |
| `ChangeLog.createdAt` | `Changes.createdAt` | Direct copy |
| `ChangeLog.createdBy` | `Changes.createdBy` | Direct copy |
| `ChangeLog.entity` | `Changes.entity` | Direct copy (fallback) |
| `ChangeLog.serviceEntity` | *(dropped)* | Not needed in trigger model |
| `Changes.ID` | `Changes.ID` | Direct copy |
| `Changes.attribute` | `Changes.attribute` | Direct copy |
| `Changes.valueChangedFrom` | `Changes.valueChangedFrom` | Direct copy |
| `Changes.valueChangedTo` | `Changes.valueChangedTo` | Direct copy |
| `Changes.entityID` | `Changes.objectID` | Renamed |
| `Changes.entity` | `Changes.entity` | Direct copy |
| `Changes.parentEntityID` | `Changes.rootObjectID` | Renamed |
| `Changes.parentKey` | `Changes.rootEntityKey` | Renamed |
| `Changes.modification` | `Changes.modification` | Direct copy |
| `Changes.valueDataType` | `Changes.valueDataType` | Direct copy |
| *(new)* | `Changes.valueChangedFromLabel` | Set to `NULL` |
| *(new)* | `Changes.valueChangedToLabel` | Set to `NULL` |
| *(new)* | `Changes.rootEntity` | Derived from `ChangeLog.entity` if parent exists |
| *(new)* | `Changes.transactionID` | Set to `NULL` |

### 4.2 SQLite Migration

> **Note:** SQLite is typically used for development with in-memory databases. If you're using persistent SQLite, apply these migrations.

```sql
-- ============================================
-- SQLite Migration: v1.x to v2.x
-- ============================================

-- Step 1: Create new tables
-- -----------------------------------------

CREATE TABLE IF NOT EXISTS "sap_changelog_i18nKeys" (
  "ID" NVARCHAR(5000) NOT NULL,
  "locale" NVARCHAR(100) NOT NULL,
  "text" NVARCHAR(5000),
  PRIMARY KEY ("ID", "locale")
);

CREATE TABLE IF NOT EXISTS "sap_changelog_CHANGE_TRACKING_DUMMY" (
  "X" NVARCHAR(5) NOT NULL,
  PRIMARY KEY ("X")
);

-- Step 2: Create new Changes table with updated schema
-- -----------------------------------------

CREATE TABLE "sap_changelog_Changes_new" (
  "ID" NVARCHAR(36) NOT NULL,
  "attribute" NVARCHAR(5000),
  "valueChangedFrom" NVARCHAR(5000),
  "valueChangedTo" NVARCHAR(5000),
  "valueChangedFromLabel" NVARCHAR(5000),
  "valueChangedToLabel" NVARCHAR(5000),
  "entity" NVARCHAR(5000),
  "entityKey" NVARCHAR(5000),
  "rootEntity" NVARCHAR(5000),
  "rootEntityKey" NVARCHAR(5000),
  "objectID" NVARCHAR(5000),
  "rootObjectID" NVARCHAR(5000),
  "modification" NVARCHAR(5000),
  "valueDataType" NVARCHAR(5000),
  "createdAt" TIMESTAMP_TEXT,
  "createdBy" NVARCHAR(255),
  "transactionID" INTEGER,
  PRIMARY KEY ("ID")
);

-- Step 3: Migrate existing data
-- -----------------------------------------

INSERT INTO "sap_changelog_Changes_new" (
  "ID",
  "attribute",
  "valueChangedFrom",
  "valueChangedTo",
  "valueChangedFromLabel",
  "valueChangedToLabel",
  "entity",
  "entityKey",
  "rootEntity",
  "rootEntityKey",
  "objectID",
  "rootObjectID",
  "modification",
  "valueDataType",
  "createdAt",
  "createdBy",
  "transactionID"
)
SELECT
  c."ID",
  c."attribute",
  c."valueChangedFrom",
  c."valueChangedTo",
  NULL,  -- valueChangedFromLabel (new, populated by triggers)
  NULL,  -- valueChangedToLabel (new, populated by triggers)
  COALESCE(c."entity", cl."entity"),
  cl."entityKey",
  CASE 
    WHEN c."parentKey" IS NOT NULL THEN cl."entity"
    ELSE NULL
  END,  -- rootEntity
  c."parentKey",  -- rootEntityKey
  c."entityID",   -- objectID (renamed)
  c."parentEntityID",  -- rootObjectID (renamed)
  c."modification",
  c."valueDataType",
  cl."createdAt",
  cl."createdBy",
  NULL   -- transactionID (new, populated by triggers)
FROM "sap_changelog_Changes" c
LEFT JOIN "sap_changelog_ChangeLog" cl ON c."changeLog_ID" = cl."ID";

-- Step 4: Replace old table with new table
-- -----------------------------------------

DROP TABLE IF EXISTS "sap_changelog_Changes";
ALTER TABLE "sap_changelog_Changes_new" RENAME TO "sap_changelog_Changes";

-- Step 5: Drop obsolete ChangeLog table
-- -----------------------------------------

DROP TABLE IF EXISTS "sap_changelog_ChangeLog";

-- Step 6: Verify migration
-- -----------------------------------------

SELECT COUNT(*) as migrated_records FROM "sap_changelog_Changes";
```

### 4.3 PostgreSQL Migration

```sql
-- ============================================
-- PostgreSQL Migration: v1.x to v2.x
-- ============================================

BEGIN;

-- Step 1: Create new tables
-- -----------------------------------------

CREATE TABLE IF NOT EXISTS "sap_changelog_i18nKeys" (
  "ID" VARCHAR(5000) NOT NULL,
  "locale" VARCHAR(100) NOT NULL,
  "text" VARCHAR(5000),
  PRIMARY KEY ("ID", "locale")
);

CREATE TABLE IF NOT EXISTS "sap_changelog_CHANGE_TRACKING_DUMMY" (
  "X" VARCHAR(5) NOT NULL,
  PRIMARY KEY ("X")
);

-- Step 2: Create new Changes table with updated schema
-- -----------------------------------------

CREATE TABLE "sap_changelog_Changes_new" (
  "ID" UUID NOT NULL,
  "attribute" VARCHAR(5000),
  "valueChangedFrom" VARCHAR(5000),
  "valueChangedTo" VARCHAR(5000),
  "valueChangedFromLabel" VARCHAR(5000),
  "valueChangedToLabel" VARCHAR(5000),
  "entity" VARCHAR(5000),
  "entityKey" VARCHAR(5000),
  "rootEntity" VARCHAR(5000),
  "rootEntityKey" VARCHAR(5000),
  "objectID" VARCHAR(5000),
  "rootObjectID" VARCHAR(5000),
  "modification" VARCHAR(5000),
  "valueDataType" VARCHAR(5000),
  "createdAt" TIMESTAMP,
  "createdBy" VARCHAR(255),
  "transactionID" BIGINT,
  PRIMARY KEY ("ID")
);

-- Step 3: Migrate existing data
-- -----------------------------------------

INSERT INTO "sap_changelog_Changes_new" (
  "ID",
  "attribute",
  "valueChangedFrom",
  "valueChangedTo",
  "valueChangedFromLabel",
  "valueChangedToLabel",
  "entity",
  "entityKey",
  "rootEntity",
  "rootEntityKey",
  "objectID",
  "rootObjectID",
  "modification",
  "valueDataType",
  "createdAt",
  "createdBy",
  "transactionID"
)
SELECT
  c."ID",
  c."attribute",
  c."valueChangedFrom",
  c."valueChangedTo",
  NULL,  -- valueChangedFromLabel
  NULL,  -- valueChangedToLabel
  COALESCE(c."entity", cl."entity"),
  cl."entityKey",
  CASE 
    WHEN c."parentKey" IS NOT NULL THEN cl."entity"
    ELSE NULL
  END,  -- rootEntity
  c."parentKey",  -- rootEntityKey
  c."entityID",   -- objectID (renamed)
  c."parentEntityID",  -- rootObjectID (renamed)
  c."modification",
  c."valueDataType",
  cl."createdAt",
  cl."createdBy",
  NULL   -- transactionID
FROM "sap_changelog_Changes" c
LEFT JOIN "sap_changelog_ChangeLog" cl ON c."changeLog_ID" = cl."ID";

-- Step 4: Drop old tables and rename new table
-- -----------------------------------------

DROP TABLE IF EXISTS "sap_changelog_Changes" CASCADE;
ALTER TABLE "sap_changelog_Changes_new" RENAME TO "sap_changelog_Changes";

DROP TABLE IF EXISTS "sap_changelog_ChangeLog" CASCADE;

-- Step 5: Create indexes for performance
-- -----------------------------------------

CREATE INDEX IF NOT EXISTS "idx_changes_entityKey" ON "sap_changelog_Changes" ("entityKey");
CREATE INDEX IF NOT EXISTS "idx_changes_rootEntityKey" ON "sap_changelog_Changes" ("rootEntityKey");
CREATE INDEX IF NOT EXISTS "idx_changes_entity" ON "sap_changelog_Changes" ("entity");
CREATE INDEX IF NOT EXISTS "idx_changes_createdAt" ON "sap_changelog_Changes" ("createdAt" DESC);

-- Step 6: Verify migration
-- -----------------------------------------

SELECT COUNT(*) as migrated_records FROM "sap_changelog_Changes";

COMMIT;
```

### 4.4 SAP HANA / HDI Migration

For HANA deployments using HDI containers, create a migration procedure:

```sql
-- ============================================
-- SAP HANA Migration: v1.x to v2.x
-- ============================================
-- Save as: db/src/migrations/V2_CHANGE_TRACKING_MIGRATION.hdbtabledata or execute via SQL console

-- Step 1: Create new tables (handled by CDS deployment)
-- The following tables will be created automatically by `cds deploy`:
--   - SAP_CHANGELOG_I18NKEYS
--   - SAP_CHANGELOG_CHANGE_TRACKING_DUMMY
--   - SAP_CHANGELOG_CHANGES (new schema)

-- Step 2: Backup existing data (run manually before migration)
-- -----------------------------------------

CREATE TABLE "SAP_CHANGELOG_CHANGELOG_BACKUP" AS (
  SELECT * FROM "SAP_CHANGELOG_CHANGELOG"
);

CREATE TABLE "SAP_CHANGELOG_CHANGES_BACKUP" AS (
  SELECT * FROM "SAP_CHANGELOG_CHANGES"
);

-- Step 3: Migration procedure
-- -----------------------------------------

DO BEGIN
  DECLARE v_count INTEGER;
  
  -- Check if old table exists
  SELECT COUNT(*) INTO v_count 
  FROM TABLES 
  WHERE SCHEMA_NAME = CURRENT_SCHEMA 
    AND TABLE_NAME = 'SAP_CHANGELOG_CHANGELOG';
  
  IF v_count > 0 THEN
    -- Migrate data from old schema to new schema
    INSERT INTO "SAP_CHANGELOG_CHANGES" (
      "ID",
      "ATTRIBUTE",
      "VALUECHANGEDFROM",
      "VALUECHANGEDTO",
      "VALUECHANGEDFROMLABEL",
      "VALUECHANGEDTOLABEL",
      "ENTITY",
      "ENTITYKEY",
      "ROOTENTITY",
      "ROOTENTITYKEY",
      "OBJECTID",
      "ROOTOBJECTID",
      "MODIFICATION",
      "VALUEDATATYPE",
      "CREATEDAT",
      "CREATEDBY",
      "TRANSACTIONID"
    )
    SELECT
      c."ID",
      c."ATTRIBUTE",
      c."VALUECHANGEDFROM",
      c."VALUECHANGEDTO",
      NULL,  -- VALUECHANGEDFROMLABEL
      NULL,  -- VALUECHANGEDTOLABEL
      COALESCE(c."ENTITY", cl."ENTITY"),
      cl."ENTITYKEY",
      CASE 
        WHEN c."PARENTKEY" IS NOT NULL THEN cl."ENTITY"
        ELSE NULL
      END,  -- ROOTENTITY
      c."PARENTKEY",  -- ROOTENTITYKEY
      c."ENTITYID",   -- OBJECTID (renamed)
      c."PARENTENTITYID",  -- ROOTOBJECTID (renamed)
      c."MODIFICATION",
      c."VALUEDATATYPE",
      cl."CREATEDAT",
      cl."CREATEDBY",
      NULL   -- TRANSACTIONID
    FROM "SAP_CHANGELOG_CHANGES_BACKUP" c
    LEFT JOIN "SAP_CHANGELOG_CHANGELOG_BACKUP" cl ON c."CHANGELOG_ID" = cl."ID";
    
    -- Log migration result
    SELECT COUNT(*) INTO v_count FROM "SAP_CHANGELOG_CHANGES";
    
  END IF;
END;

-- Step 4: Cleanup (run after verification)
-- -----------------------------------------

-- Only run these after confirming migration success:
-- DROP TABLE "SAP_CHANGELOG_CHANGELOG_BACKUP";
-- DROP TABLE "SAP_CHANGELOG_CHANGES_BACKUP";
-- DROP TABLE "SAP_CHANGELOG_CHANGELOG";
```

#### HDI Migration File Structure

For HDI deployments, you may need to handle the migration via deployment artifacts:

```
db/
├── src/
│   ├── migrations/
│   │   └── V2_CHANGE_TRACKING_MIGRATION.hdbprocedure
│   └── .hdiconfig
└── undeploy.json  # Add old tables to undeploy list
```

**undeploy.json:**
```json
[
  "src/gen/SAP_CHANGELOG_CHANGELOG.hdbtable"
]
```

---

## 5. Configuration Changes

### 5.1 Session Variables (New Feature)

The new version introduces session variables for runtime control of change tracking:

| Variable | Purpose | Example |
|----------|---------|---------|
| `ct.skip` | Skip all change tracking for current transaction | `req._tx.set({ 'ct.skip': 'true' })` |
| `ct.skip_entity.<entity>` | Skip tracking for specific entity | `req._tx.set({ 'ct.skip_entity.my_Entity': 'true' })` |
| `ct.skip_element.<entity>.<element>` | Skip tracking for specific field | `req._tx.set({ 'ct.skip_element.my_Entity.field': 'true' })` |

**Usage in custom handlers:**

```javascript
// Skip change tracking for a bulk import operation
srv.before('CREATE', 'BulkImport', async (req) => {
  req._tx.set({ 'ct.skip': 'true' });
});

srv.after('CREATE', 'BulkImport', async (_, req) => {
  req._tx.set({ 'ct.skip': 'false' });
});
```

### 5.2 Package.json Updates

The following npm scripts have been updated/added:

```json
{
  "scripts": {
    "test": "npx jest --silent",
    "test:sqlite": "CDS_ENV=sqlite npx jest --silent",
    "test:postgres": "CDS_ENV=pg npx jest --silent",
    "test:hana": "npm run start:hana && cds bind --exec -- npx jest --silent",
    "test:all": "npm run test:sqlite && npm run test:postgres && npm run test:hana",
    "start:pg": "cd tests/bookshop/ && docker compose -f pg.yml up -d && npm run deploy:postgres && cd ../..",
    "deploy:postgres": "cds build --production && cds deploy --profile pg",
    "start:hana": "cd tests/bookshop/ && cds deploy -2 hana && cd ../.."
  }
}
```

### 5.3 CDS Configuration

No changes required to existing `cds.requires` configuration:

```json
{
  "cds": {
    "requires": {
      "change-tracking": {
        "model": "@cap-js/change-tracking",
        "considerLocalizedValues": false,
        "preserveDeletes": false
      }
    }
  }
}
```

---

## 6. Build & Deployment

### 6.1 i18nKeys CSV Auto-Generation

The `i18nKeys` table stores localized labels for:
- Entity names (e.g., `sap.capire.bookshop.Books` → "Book")
- Attribute names (e.g., `title` → "Title")  
- Modification types (`create`, `update`, `delete`)
- Object IDs (business-meaningful identifiers)

**How it works:**

1. During `cds build`, the plugin analyzes all `@changelog`-annotated entities
2. It extracts `@title` and `@Common.Label` annotations
3. It generates translations for all configured locales from `_i18n/` folder
4. The CSV file is written to `db/data/sap.changelog-i18nKeys.csv`

**The CSV is auto-generated** during the build process for:
- **HANA/HDI**: Generated during `cds build` or `cds deploy -2 hana`
- **H2 (Java)**: Generated during `cds build` with `--to h2` option
- **SQLite**: Generated at runtime and inserted into the database
- **PostgreSQL**: Generated during `cds build --production`

**CSV Format:**
```csv
ID;locale;text
sap.capire.bookshop.Books;en;Book
sap.capire.bookshop.Books;de;Buch
title;en;Title
title;de;Titel
create;en;Create
create;de;Erstellen
```

### 6.2 Trigger Deployment

Triggers are automatically deployed based on the database type:

#### SQLite (Development)

Triggers are created **at runtime** when the application starts:

```javascript
// Automatically executed by cds-plugin.js on 'served' event
cds.once('served', async () => {
  // Triggers are generated and executed
  // i18nKeys are populated
});
```

No manual steps required.

#### PostgreSQL

Triggers are generated during **`cds build`** and deployed with the schema:

```bash
# Build and deploy
cds build --production
cds deploy --profile pg

# Or using the npm script
npm run deploy:postgres
```

The generated SQL includes:
- PL/pgSQL functions for each tracked entity
- `AFTER INSERT`, `AFTER UPDATE`, `AFTER DELETE` triggers

#### SAP HANA / HDI

Triggers are generated as `.hdbtrigger` artifacts during **`cds build`**:

```bash
# Deploy to HANA
cds deploy -2 hana

# Or build first
cds build --production
# Then deploy via cf push or HDI deployer
```

Generated artifacts in `db/src/gen/`:
- `<ENTITY>_CT_INSERT.hdbtrigger`
- `<ENTITY>_CT_UPDATE.hdbtrigger`  
- `<ENTITY>_CT_DELETE.hdbtrigger`

#### H2 (CAP Java)

Triggers are generated as SQL statements during **`cds build`** with the `--to h2` option:

```bash
cds build --to h2
```

The triggers use H2's `CREATE TRIGGER` syntax with Java TriggerAdapter classes.

### 6.3 Full Deployment Workflow

```bash
# 1. Update dependencies
npm install @cap-js/change-tracking@latest

# 2. Run database migration (see Section 4)
# Execute the appropriate SQL script for your database

# 3. Build the application
cds build --production

# 4. Deploy to target environment
# For Cloud Foundry with HANA:
cf push

# For PostgreSQL:
cds deploy --profile pg

# For local development (SQLite):
cds watch  # Triggers created automatically
```

---

## 7. Post-Migration Verification

### 7.1 Verify Schema Migration

```sql
-- Check new Changes table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sap_changelog_Changes'
ORDER BY ordinal_position;

-- Verify record count matches
SELECT COUNT(*) FROM "sap_changelog_Changes";

-- Check for NULL values in migrated columns
SELECT 
  COUNT(*) as total,
  COUNT("entityKey") as with_entityKey,
  COUNT("createdAt") as with_createdAt,
  COUNT("createdBy") as with_createdBy
FROM "sap_changelog_Changes";
```

### 7.2 Verify i18nKeys Population

```sql
-- Check i18nKeys table has data
SELECT COUNT(*) FROM "sap_changelog_i18nKeys";

-- Sample localized entries
SELECT * FROM "sap_changelog_i18nKeys" 
WHERE locale = 'en' 
LIMIT 10;
```

### 7.3 Verify Triggers Are Active

#### SQLite
```sql
SELECT name, sql FROM sqlite_master 
WHERE type = 'trigger' 
AND name LIKE '%_CT_%';
```

#### PostgreSQL
```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_name LIKE '%_ct_%';
```

#### HANA
```sql
SELECT TRIGGER_NAME, TABLE_NAME, TRIGGER_TYPE
FROM TRIGGERS
WHERE TRIGGER_NAME LIKE '%_CT_%';
```

### 7.4 Functional Testing

1. **Create a new record** and verify a change entry is created
2. **Update an existing record** and verify the old/new values are captured
3. **Delete a record** and verify the deletion is logged
4. **Check the UI** - Navigate to an entity's Change History facet and verify:
   - Localized column headers appear correctly
   - `attributeLabel`, `entityLabel`, `modificationLabel` show translated values
   - `objectID` and `rootObjectID` display business-meaningful identifiers

---

## 8. Rollback Strategy

If you need to rollback to v1.x:

### 8.1 Restore from Backup

```sql
-- PostgreSQL / HANA
-- Restore backup tables (if created during migration)
DROP TABLE IF EXISTS "sap_changelog_Changes";
ALTER TABLE "sap_changelog_Changes_backup" RENAME TO "sap_changelog_Changes";

DROP TABLE IF EXISTS "sap_changelog_ChangeLog"; 
ALTER TABLE "sap_changelog_ChangeLog_backup" RENAME TO "sap_changelog_ChangeLog";

-- Drop new tables
DROP TABLE IF EXISTS "sap_changelog_i18nKeys";
DROP TABLE IF EXISTS "sap_changelog_CHANGE_TRACKING_DUMMY";
```

### 8.2 Revert Package Version

```bash
npm install @cap-js/change-tracking@1.x
```

### 8.3 Remove Generated Triggers

#### PostgreSQL
```sql
-- Drop all change tracking triggers and functions
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT trigger_name, event_object_table 
           FROM information_schema.triggers 
           WHERE trigger_name LIKE '%_ct_%'
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || r.trigger_name || ' ON ' || r.event_object_table;
  END LOOP;
END $$;
```

#### HANA/HDI
Remove the `.hdbtrigger` files from `db/src/gen/` and redeploy.

---

## Appendix: Quick Reference

### File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `index.cds` | Modified | New schema with flat `Changes` entity |
| `cds-plugin.js` | Modified | Trigger generation instead of event handlers |
| `lib/trigger/sqlite.js` | New | SQLite trigger generation |
| `lib/trigger/postgres.js` | New | PostgreSQL trigger generation |
| `lib/trigger/hdi.js` | New | HANA HDI trigger generation |
| `lib/trigger/h2.js` | New | H2 trigger generation (CAP Java) |
| `lib/utils/change-tracking.js` | New | Shared utilities for trigger generation |
| `lib/utils/session-variables.js` | New | Session variable management |
| `lib/utils/entity-collector.js` | New | Entity discovery and annotation merging |
| `lib/legacy/*.js` | Moved | Legacy code preserved for reference |

### Support

For issues or questions regarding this migration:

1. Check the [GitHub Issues](https://github.com/cap-js/change-tracking/issues)
2. Review the [CHANGELOG.md](./CHANGELOG.md) for detailed version history
3. Consult the [CAP Documentation](https://cap.cloud.sap/docs/)

---

*Migration Guide Version: 2.0.0*
*Last Updated: 2026-02-27*
