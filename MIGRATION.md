# Migration Guide: Change Tracking Plugin v1 to v2

This guide explains how to migrate existing data from `@cap-js/change-tracking` v1 to v2.

## Overview

In version 1, change tracking data was split across two tables and tracked on the application layer:

- **`sap_changelog_ChangeLog`** — one row per change event (who changed what, when)
- **`sap_changelog_Changes`** — one row per changed attribute (the actual field-level diffs)

In v2, the `ChangeLog` table is removed and the schema of `Changes` is adjusted to store all data directly within it.

## Step-by-Step Guide

### Step 1: Use the latest v1 version of the plugin

Make sure you are using version `1.2.0` of the `@cap-js/change-tracking` plugin and that this version is deployed to your database. You can check the version with:

```bash
npm ls @cap-js/change-tracking
```

This step is necessary because version `1.2.0` includes two new columns in `Changes` which are required for the migration.

### Step 2: Copy data from the Changelog table to the Changes table

Run the following SQL command to copy `createdAt` and `createdBy` from `sap.changelog.ChangeLog` to `sap.changelog.Changes` for existing data:

```sql
MERGE INTO SAP_CHANGELOG_CHANGES AS c
  USING SAP_CHANGELOG_CHANGELOG AS cl
	ON c.changeLog_ID = cl.ID
	WHEN MATCHED THEN UPDATE SET
	    c.createdAt = cl.createdAt,
	    c.createdBy = cl.createdBy;
```

### Step 3: Update to version 2

Update the `@cap-js/change-tracking` dependency to version 2.

```bash
npm i @cap-js/change-tracking@2
```

### Step 4: Enable the migration table

Enable the `addMigrationTable` configuration to automatically generate the `sap.changelog.Changes.hdbmigrationtable` artifact under `gen/src/` during the build.

```json
"cds": {
  "requires": {
    "change-tracking": {
      "addMigrationTable": true
    }
  }
}
```

### Step 5: Add undeploy.json configuration

Add both old tables `Changes` and `ChangeLog` to your `undeploy.json`:

```json
[
  ...,
  "src/gen/**/sap.changelog.Changes.hdbtable",
  "src/gen/**/sap.changelog.ChangeLog.hdbtable"
]
```

REVISIT: We nned to annotate Changes with either `@cds.persistence.journal` or add migration table to `undeploy.json`

### Step 6: Deploy your application with version 2

Use `cds deploy -2 hana` or `cds up` to deploy the new schema.

### Step 7: Cleanup

After successfully deploying and migrating, remove the `addMigrationTable` configuration from your `package.json`:

```json
"cds": {
  "requires": {
    "change-tracking": {
      "addMigrationTable": true  // <-- remove this line
    }
  }
}
```

Also, Remove the `.hdbtable` entries in the `db/undeploy.json` and replace them with the migration table entry:

```json
[
  ...,
  "src/gen/sap.changelog.Changes.hdbmigrationtable"
]
```

> [!IMPORTANT]
> You must remove the `.hdbtable` entries from `undeploy.json`. If they remain, the table will be undeployed and all your data will be lost.

### Step 8: Generate missing hierarchy information

The new version of `@cap-js/change-tracking` tracks composition children changes in a different way. Previously the change on a child would be assigned to the parent. With version 2 the change is assigned to the child, the actual entity on which the change was made, and another change record is created in the parent that the child had a change. Furthermore hierarchy information via a `parent` association is present in changes, to expand the change record in the parent and see the actual changes on the child.

Call the `SAP_CHANGELOG_RESTORE_BACKLINKS` procedure to automatically generate missing parent change records for changes assigned to child entities.

```sql
CALL "SAP_CHANGELOG_RESTORE_BACKLINKS"();
```

The procedure is idempotent — it only creates parent change records where they don't already exist and only updates child change records that don't yet have a `parent_ID`. You can safely call it multiple times.

The generation of the procedure can be disabled by setting the `disableRestoreBacklinks` feature flag:

```json
"cds": {
  "requires": {
    "change-tracking": {
      "disableRestoreBacklinks": true
    }
  }
}
```

> **Note:** The procedure is also useful for v2 users who want to regenerate backlinks.
