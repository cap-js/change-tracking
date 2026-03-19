# Migration Guide: Change Tracking Plugin v1 to v2

This guide explains how to migrate from v1 to v2 of the change tracking plugin. The migration requires **two sequential deployments** because data must be copied between tables in between.

## Overview

In v1, change tracking data was split across two tables:

- **`sap_changelog_ChangeLog`** — one row per change event (who changed what, when)
- **`sap_changelog_Changes`** — one row per changed attribute (the actual field-level diffs)

In v2, the `ChangeLog` table is removed entirely. All data — including `createdAt`, `createdBy`, and `entityKey` — is stored directly on the `Changes` table. Several columns were also renamed, resized, or removed.

Because the migration involves copying data **from `ChangeLog` into `Changes`** (a cross-table operation), it cannot be done with an `.hdbmigrationtable` alone. A stored procedure is required in between two deployments.

## Step-by-Step Guide


## Step 1: Deploy Intermediate Schema

Make sure that you are using the version `1.2.0` of the change-tracking plugin. You can check with: 

```bash

```

After that, you can deploy your database to HANA with either `cds deploy -2 hana` or deploy the entire application with `cds up`.

This step is necessary since two new columns were added to the `Changes` table that are necessary for the migration.

## Step 2: Update the Changes Table

Run the following merge command to copy the values for the columns `createdAt` and `createdBy` from the table `sap.changelog.ChangeLog` to `sap.changelog.Changes`.

```sql
MERGE INTO SAP_CHANGELOG_CHANGES AS c 
  USING SAP_CHANGELOG_CHANGELOG AS cl
	ON c.changeLog_ID = cl.ID
	WHEN MATCHED THEN UPDATE SET
	    c.createdAt = cl.createdAt,
	    c.createdBy = cl.createdBy;
```

## Step 3: Deploy new schema with Migration Table

Update the change-tracking dependency to version 2 in your `package.json`:

```bash
npm i @cap-js/change-tracking@2
```

In addition, add the `sap.changelog.Changes.hdbmigrationtable` under `db/src/`:

```sql
== version=2
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

== migration=2
RENAME COLUMN sap_changelog_Changes.entityID TO objectID;

ALTER TABLE sap_changelog_Changes ADD (parent_ID NVARCHAR(36), valueChangedFromLabel NVARCHAR(5000), valueChangedToLabel NVARCHAR(5000), transactionID BIGINT);

-- Adjust entityKey structure
RENAME COLUMN sap_changelog_Changes.keys TO entityKey;
UPDATE SAP_CHANGELOG_CHANGES
SET entityKey =
    CASE 
        WHEN LOCATE(entityKey, '=') > 0 THEN 
              TRIM(SUBSTRING(entityKey, LOCATE(entityKey, '=') + 1))
        ELSE
            NULL
    END;

-- Copy changelog_ID into transactionID
UPDATE SAP_CHANGELOG_CHANGES SET transactionID = CAST(SECONDS_BETWEEN(createdAt, TO_TIMESTAMP('1970-01-01 00:00:00')) * -1000 AS BIGINT);

-- Column migration for attribute, entity and modification
ALTER TABLE sap_changelog_Changes ADD (attribute_tmp NVARCHAR(127), entity_tmp NVARCHAR(150), modification_tmp NVARCHAR(6));

-- Copy data into temp columns
UPDATE sap_changelog_Changes SET attribute_tmp = attribute;
UPDATE sap_changelog_Changes SET entity_tmp = entity;
UPDATE sap_changelog_Changes SET modification_tmp = modification;

ALTER TABLE sap_changelog_Changes DROP (attribute, entity, modification);

ALTER TABLE sap_changelog_Changes ADD (attribute NVARCHAR(127), entity NVARCHAR(150), modification NVARCHAR(6));

-- Restore data from temp columns
UPDATE sap_changelog_Changes SET attribute = attribute_tmp;
UPDATE sap_changelog_Changes SET entity = entity_tmp;
UPDATE sap_changelog_Changes SET modification = modification_tmp;

ALTER TABLE sap_changelog_Changes DROP (attribute_tmp, entity_tmp, modification_tmp);

--- Drop the columns which are not needed anymore
ALTER TABLE sap_changelog_Changes DROP (serviceEntity, parentEntityID, parentKey, serviceEntityPath, changeLog_ID);
```

Also, add both tables `Changes` and `ChangeLog` to your `undeploy.json`:

```json
[
  "src/gen/**/sap.changelog.Changes.hdbtable",
  "src/gen/**/sap.changelog.ChangeLog.hdbtable"
]
```

Now you are ready to deploy your application again to HANA with either `cds deploy -2 hana` or `cds up`.

## Step 4: Cleanup

After migarting the table, you need to remove the tables `Changes`and `ChangeLog` from the undeploy.json again. In addtion, remove the migration previously added `sap.changelog.Changes.hdbmigrationtable` under `db/src/` and add the migration table to the undeploy.json:

```json
[
  "src/gen/**/sap.changelog.Changes.hdbmigrationtable"
]

// oder "src/sap.changelog.Changes.hdbmigrationtable" ??

This is very important to remove the previosuly added .hdbtable from the undeploy.json because otherwise the table is undeployt again and all your data is gone. 

```

### Create Hierarchy Mapping 

The new version of change-tracking tracks composition children changes on parents. To create the necessary backlink entries for existing change data, generate a HANA stored procedure by running:

```bash
npx changelog-restore-backlinks /path/to/your/project
```

This compiles your CDS model, detects all composition relationships, and writes a `SAP_CHANGELOG_RESTORE_BACKLINKS.hdbprocedure` file into `db/src/` of your project. Deploy it together with your application, then call:

```sql
CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();
```

The procedure is idempotent — it only creates parent entries where they don't already exist and only updates child entries that don't yet have a `parent_ID`. You can safely call it multiple times.

After running the procedure you can remove the `.hdbprocedure` file from `db/src/` again.

> **Note:** The script is also useful for v2 users who want to regenerate backlinks (e.g., after data recovery or if backlinks were lost due to issues).

You can then also add the procedure to the undeloy.json to make sure it is removed again.