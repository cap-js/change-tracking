# Migration Guide: Change Tracking Plugin v1 to v2

This guide explains how to migrate from v1 to v2 of the change tracking plugin. The migration requires **two sequential deployments** because data must be copied between tables in between.

## Overview

In v1, change tracking data was split across two tables:

- **`sap_changelog_ChangeLog`** — one row per change event (who changed what, when)
- **`sap_changelog_Changes`** — one row per changed attribute (the actual field-level diffs)

In v2, the `ChangeLog` table is removed entirely. All data — including `createdAt`, `createdBy`, and `entityKey` — is stored directly on the `Changes` table. Several columns were also renamed, resized, or removed.

Because the migration involves copying data **from `ChangeLog` into `Changes`** (a cross-table operation), it cannot be done with an `.hdbmigrationtable` alone. A stored procedure is required in between two deployments.

## Prerequisites

- Your project is using the `hdbtable` deploy format (default since CDS v7)
- You have access to run SQL against the HDI container (e.g., via SAP HANA Cockpit, `hdbsql`, or a DB explorer)

## Step 1: Deploy the Intermediate Schema

Remove the change-tracking dependecy from you project, if it still exists.

Add the `sap.changelog.Changes.hdbmigrationtable` to `db/src` (maybe over `journal`)

The v1 Changes table as it exists today

```
== version=1
COLUMN TABLE sap_changelog_Changes (
  ID NVARCHAR(36) NOT NULL,
  keys NVARCHAR(5000),
  attribute NVARCHAR(5000),
  valueChangedFrom NVARCHAR(5000),
  valueChangedTo NVARCHAR(5000),
  entityID NVARCHAR(5000),
  entity NVARCHAR(5000),
  serviceEntity NVARCHAR(5000),
  parentEntityID NVARCHAR(5000),
  parentKey NVARCHAR(5000),
  serviceEntityPath NVARCHAR(5000),
  modification NVARCHAR(5000),
  valueDataType NVARCHAR(5000),
  changeLog_ID NVARCHAR(36),
  PRIMARY KEY(ID)
)
```

Add the sap_changelog_Changes.hdbtable to the `db/undeploy.json`

```json
[
	"src/gen/**/*.hdbview",
	"src/gen/**/*.hdbindex",
	"src/gen/**/*.hdbconstraint",
	"src/gen/**/*_drafts.hdbtable",
	"src/gen/**/*.hdbcalculationview",
	"src/gen/**/*.hdbtrigger",
	"src/gen/**/*.csv",
	"src/gen/**/*.hdbtabledata",
	"src/gen/data/*.csv",
	"src/gen/data/*.hdbtabledata",
	"src/gen/**/sap.changelog.Changes.hdbtable" <added>
]
```

The v2 Changes table that adds new columns, shrinks columns via temp trick, keeps changeLog_ID.
```sql
== migration=2
-- Add new v2 columns
ALTER TABLE sap_changelog_Changes ADD (
  parent_ID NVARCHAR(36),
  objectID NVARCHAR(5000),
  entityKey NVARCHAR(5000),
  valueChangedFromLabel NVARCHAR(5000),
  valueChangedToLabel NVARCHAR(5000),
  createdAt TIMESTAMP,
  createdBy NVARCHAR(255),
  transactionID BIGINT
);
-- Shrink attribute: 5000 → 127 (via temp column)
ALTER TABLE sap_changelog_Changes ADD (attribute_tmp NVARCHAR(127));
UPDATE sap_changelog_Changes SET attribute_tmp = SUBSTRING(attribute, 1, 127);
ALTER TABLE sap_changelog_Changes DROP (attribute);
ALTER TABLE sap_changelog_Changes ADD (attribute NVARCHAR(127));
UPDATE sap_changelog_Changes SET attribute = attribute_tmp;
ALTER TABLE sap_changelog_Changes DROP (attribute_tmp);
-- Shrink entity: 5000 → 150 (via temp column)
ALTER TABLE sap_changelog_Changes ADD (entity_tmp NVARCHAR(150));
UPDATE sap_changelog_Changes SET entity_tmp = SUBSTRING(entity, 1, 150);
ALTER TABLE sap_changelog_Changes DROP (entity);
ALTER TABLE sap_changelog_Changes ADD (entity NVARCHAR(150));
UPDATE sap_changelog_Changes SET entity = entity_tmp;
ALTER TABLE sap_changelog_Changes DROP (entity_tmp);
-- Shrink modification: 5000 → 6 (via temp column)
ALTER TABLE sap_changelog_Changes ADD (modification_tmp NVARCHAR(6));
UPDATE sap_changelog_Changes SET modification_tmp = SUBSTRING(modification, 1, 6);
ALTER TABLE sap_changelog_Changes DROP (modification);
ALTER TABLE sap_changelog_Changes ADD (modification NVARCHAR(6));
UPDATE sap_changelog_Changes SET modification = modification_tmp;
ALTER TABLE sap_changelog_Changes DROP (modification_tmp);
== version=2
COLUMN TABLE sap_changelog_Changes (
  ID NVARCHAR(36) NOT NULL,
  keys NVARCHAR(5000),
  attribute NVARCHAR(127),
  valueChangedFrom NVARCHAR(5000),
  valueChangedTo NVARCHAR(5000),
  entityID NVARCHAR(5000),
  entity NVARCHAR(150),
  serviceEntity NVARCHAR(5000),
  parentEntityID NVARCHAR(5000),
  parentKey NVARCHAR(5000),
  serviceEntityPath NVARCHAR(5000),
  modification NVARCHAR(6),
  valueDataType NVARCHAR(5000),
  changeLog_ID NVARCHAR(36),
  parent_ID NVARCHAR(36),
  objectID NVARCHAR(5000),
  entityKey NVARCHAR(5000),
  valueChangedFromLabel NVARCHAR(5000),
  valueChangedToLabel NVARCHAR(5000),
  createdAt TIMESTAMP,
  createdBy NVARCHAR(255),
  transactionID BIGINT,
  PRIMARY KEY(ID)
)
```

Data Migration Procedure (`sap.changelog.Changes_v1_migrate.hdbprocedure`):

```sql
PROCEDURE "sap_changelog_Changes_v1_migrate"()
  LANGUAGE SQLSCRIPT
  SQL SECURITY INVOKER
AS
BEGIN
  -- Copy createdAt, createdBy, entityKey from ChangeLog into Changes
  UPDATE sap_changelog_Changes AS c
    SET c.createdAt = cl.CREATEDAT,
        c.createdBy = cl.CREATEDBY,
        c.entityKey = cl.ENTITYKEY
    FROM sap_changelog_ChangeLog AS cl
    WHERE c.changeLog_ID = cl.ID;
  -- Copy entityID → objectID
  UPDATE sap_changelog_Changes SET objectID = entityID;
END;
```

Run migration procedure via SQL console:

```sql
CALL "sap_changelog_Changes_v1_migrate"();
```

## Cleanup

```sql
== version=3
COLUMN TABLE sap_changelog_Changes (
  ID NVARCHAR(36) NOT NULL,
  parent_ID NVARCHAR(36),
  attribute NVARCHAR(127),
  valueChangedFrom NVARCHAR(5000),
  valueChangedTo NVARCHAR(5000),
  valueChangedFromLabel NVARCHAR(5000),
  valueChangedToLabel NVARCHAR(5000),
  entity NVARCHAR(150),
  entityKey NVARCHAR(5000),
  objectID NVARCHAR(5000),
  modification NVARCHAR(6),
  valueDataType NVARCHAR(5000),
  createdAt TIMESTAMP,
  createdBy NVARCHAR(255),
  transactionID BIGINT,
  PRIMARY KEY(ID)
)

== migration=3
ALTER TABLE sap_changelog_Changes DROP (keys, entityID, serviceEntity, parentEntityID, parentKey, serviceEntityPath, changeLog_ID);
```

In addtion, add the Changelog table, migration procedure and migration table to the `db/undeploy.json` file.

```sql
"src/gen/**/sap.changelog.ChangeLog.hdbtable"
```

The first deployment ships:

1. An `.hdbmigrationtable` artifact for `sap.changelog.Changes` that defines:
   - **version=1**: The v1 table schema (baseline)
   - **version=2**: An intermediate schema that adds all new v2 columns while keeping the old columns that are still needed for data migration (notably `changeLog_ID`, `keys`, and `entityID`)

2. A stored procedure `sap.changelog.Changes_v1_migrate.hdbprocedure` that will be used in Step 2

The `ChangeLog` table remains deployed at this point — it is still needed as a data source.

### What version=2 does (structural changes)

| Action | Details |
|--------|---------|
| Add new columns | `parent_ID`, `objectID`, `entityKey`, `valueChangedFromLabel`, `valueChangedToLabel`, `createdAt`, `createdBy`, `transactionID` |
| Shrink `attribute` | `NVARCHAR(5000)` to `NVARCHAR(127)` (via temp column) |
| Shrink `entity` | `NVARCHAR(5000)` to `NVARCHAR(150)` (via temp column) |
| Shrink `modification` | `NVARCHAR(5000)` to `NVARCHAR(6)` (via temp column) |
| Keep temporarily | `changeLog_ID`, `keys`, `entityID`, `serviceEntity`, `parentEntityID`, `parentKey`, `serviceEntityPath` |

After this deployment, the `Changes` table has both old and new columns. No data has been lost or moved yet.

## Step 2: Run the Data Migration Procedure

After Deployment 1 has completed successfully, execute the migration procedure:

```sql
CALL "sap_changelog_Changes_v1_migrate"();
```

This procedure does the following:

1. **Copies `createdAt`, `createdBy`, and `entityKey`** from the `ChangeLog` table into the `Changes` table, joining on `changeLog_ID`:

   ```sql
   UPDATE sap_changelog_Changes AS c
     SET c.createdAt = cl.CREATEDAT,
         c.createdBy = cl.CREATEDBY,
         c.entityKey = cl.ENTITYKEY
     FROM sap_changelog_ChangeLog AS cl
     WHERE c.changeLog_ID = cl.ID;
   ```

2. **Copies `entityID` into `objectID`** (same table, just a value copy into the renamed column):

   ```sql
   UPDATE sap_changelog_Changes SET objectID = entityID;
   ```

### Why is this necessary?

In v1, `createdAt` and `createdBy` only existed on the `ChangeLog` table and were surfaced via a JOIN in the `ChangeView`. In v2, they live directly on `Changes`. Similarly, `entityKey` in v2 is the raw entity key (e.g., a UUID like `3583f982-d7df-...`), which was stored on `ChangeLog.entityKey` in v1. The v1 `Changes.keys` column had a different format (e.g., `ID=3583f982-d7df-...`) and is not reused.

### Verifying the migration

After running the procedure, you can verify the data was copied correctly:

```sql
-- Check that createdAt, createdBy, and entityKey are populated
SELECT ID, createdAt, createdBy, entityKey, objectID
FROM sap_changelog_Changes
WHERE createdAt IS NOT NULL
LIMIT 10;

-- Check for any rows where the migration did not populate the fields
-- (These would be orphaned rows with no matching ChangeLog entry)
SELECT COUNT(*)
FROM sap_changelog_Changes
WHERE createdAt IS NULL;
```

## Step 3: Deploy the Final Schema

Once you have verified that the data migration was successful, deploy the second update. This deployment ships:

1. An updated `.hdbmigrationtable` with **version=3** — the final v2 schema

2. The `ChangeLog` table artifact and the migration procedure added to the HDI **undeploy allowlist**

### What version=3 does (cleanup)

| Action | Details |
|--------|---------|
| Drop old columns | `keys`, `entityID`, `serviceEntity`, `parentEntityID`, `parentKey`, `serviceEntityPath`, `changeLog_ID` |

After this deployment, the `Changes` table matches the v2 CDS model exactly. The `ChangeLog` table is dropped from the HDI container.

### New columns that will be NULL for migrated data

The following v2 columns did not exist in v1 and will be `NULL` for historically migrated rows. This is expected — they are only populated for new changes going forward:

| Column | Purpose |
|--------|---------|
| `parent_ID` | Links child-entity changes to their parent change row (hierarchy feature in v2) |
| `valueChangedFromLabel` | Display label for the old value (e.g., resolved code list text) |
| `valueChangedToLabel` | Display label for the new value |
| `transactionID` | Groups changes that occurred in the same transaction |

## Summary

```
Deployment 1                     Manual Step                     Deployment 2
─────────────                    ───────────                     ─────────────
version=2 migration:             Run migration procedure:        version=3 migration:
 - Add new columns               CALL "..._v1_migrate"()         - Drop old columns
 - Shrink resized columns        Copies:                         - Final v2 schema
 - Keep changeLog_ID              - createdAt from ChangeLog
 - Keep ChangeLog table           - createdBy from ChangeLog    Undeploy:
 - Deploy procedure               - entityKey from ChangeLog     - ChangeLog table
                                   - entityID → objectID         - Migration procedure
```

## Column Mapping Reference

| v1 Changes column | v2 Changes column | Migration action |
|---|---|---|
| `ID` | `ID` | Unchanged |
| `attribute` | `attribute` | Resized (`5000` to `127`) |
| `valueChangedFrom` | `valueChangedFrom` | Unchanged |
| `valueChangedTo` | `valueChangedTo` | Unchanged |
| `entity` | `entity` | Resized (`5000` to `150`) |
| `modification` | `modification` | Resized (unbounded to `6`) |
| `valueDataType` | `valueDataType` | Unchanged |
| `entityID` | `objectID` | Value copied to new column, old column dropped |
| `keys` | -- | Dropped (replaced by `entityKey` from ChangeLog) |
| `serviceEntity` | -- | Dropped |
| `parentEntityID` | -- | Dropped |
| `parentKey` | -- | Dropped |
| `serviceEntityPath` | -- | Dropped |
| `changeLog_ID` | -- | Dropped (after data migration) |
| -- | `entityKey` | New, populated from `ChangeLog.entityKey` |
| -- | `createdAt` | New, populated from `ChangeLog.createdAt` |
| -- | `createdBy` | New, populated from `ChangeLog.createdBy` |
| -- | `parent_ID` | New, NULL for migrated data |
| -- | `objectID` | New, populated from `Changes.entityID` |
| -- | `valueChangedFromLabel` | New, NULL for migrated data |
| -- | `valueChangedToLabel` | New, NULL for migrated data |
| -- | `transactionID` | New, NULL for migrated data |

| v1 ChangeLog column | Migration action |
|---|---|
| `createdAt` | Copied into `Changes.createdAt` by procedure |
| `createdBy` | Copied into `Changes.createdBy` by procedure |
| `entityKey` | Copied into `Changes.entityKey` by procedure |
| `serviceEntity` | Not migrated (not needed in v2) |
| `entity` | Not migrated (already on Changes) |
| Entire table | Dropped in Deployment 2 |
