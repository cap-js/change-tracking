# Migration Guide: Switch from v1 to v2

The new version moves the tracking mechanism from event handlers to native database triggers (SQLite, PostgreSQL, HANA, H2). The `ChangeLog` entity was removed, everything lives in a flat `Changes` table now. Localization moved from runtime handlers to an `i18nKeys` lookup table with SQL `COALESCE`.

## What broke

### Schema

The `sap.changelog.ChangeLog` entity no longer exists. Its fields (`entityKey`, `createdAt`, `createdBy`) moved directly into `Changes`.

**Removed columns on `Changes`:**

| Column              | What happened                                    |
| ------------------- | ------------------------------------------------ |
| `keys`              | Dropped                                          |
| `entityID`          | Renamed to `objectID`                            |
| `serviceEntity`     | Dropped (triggers don't track the service layer) |
| `parentEntityID`    | Renamed to `rootObjectID`                        |
| `parentKey`         | Renamed to `rootEntityKey`                       |
| `serviceEntityPath` | Dropped                                          |
| `changeLog` (FK)    | Dropped (no more parent entity)                  |

**Moved/renamed columns on `Changes`:**

| Column                    | Was                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `entityKey`               | Moved from `ChangeLog.entityKey`                           |
| `objectID`                | Renamed from `entityID`                                    |
| `rootEntity`              | Derived from `ChangeLog.entity` (for composition children) |
| `rootEntityKey`           | Renamed from `parentKey`                                   |
| `rootObjectID`            | Renamed from `parentEntityID`                              |
| `createdAt` / `createdBy` | Moved from `ChangeLog`                                     |

**New columns on `Changes`:**

| Column                                          | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `valueChangedFromLabel` / `valueChangedToLabel` | Localized labels for old/new values      |
| `transactionID`                                 | Groups changes from the same transaction |

**New entities:**

- `sap.changelog.i18nKeys` -- stores localized labels for attributes, entities, and modification types

### ChangeView columns

| Old                | New                                               |
| ------------------ | ------------------------------------------------- |
| `entity`           | `entityLabel` (localized via `i18nKeys`)          |
| `attribute`        | `attributeLabel` (localized via `i18nKeys`)       |
| `modification`     | `modificationLabel` (localized via `i18nKeys`)    |
| `parentObjectID`   | `rootObjectID`                                    |
| `valueChangedFrom` | `valueChangedFromLabel` (falls back to raw value) |
| `valueChangedTo`   | `valueChangedToLabel` (falls back to raw value)   |

If you have custom UI components or queries referencing the old column names, update them.

### Runtime handlers are gone

These no longer exist:

```javascript
// v1.x -- all removed
cds.db.before('CREATE', entity, track_changes);
cds.db.before('UPDATE', entity, track_changes);
cds.db.before('DELETE', entity, track_changes);
```

The `_afterReadChangeView` handler is also gone -- localization now happens in SQL.

### New: session variables to skip tracking

```javascript
// Skip all tracking for current transaction
req._tx.set({ 'ct.skip': 'true' });

// Skip a specific entity
req._tx.set({ 'ct.skip_entity.my_namespace_MyEntity': 'true' });

// Skip a specific field
req._tx.set({ 'ct.skip_element.my_namespace_MyEntity.fieldName': 'true' });
```

### Annotations

`@changelog` syntax is unchanged. New behavior:

- `@changelog: false` on a service entity sets a session variable to skip that entity
- `@changelog: false` on an element skips that field

## Data migration

The core idea is the same for all databases: create the new `Changes` schema, copy data from old `Changes` + `ChangeLog` into it, then drop the old tables.

### Column mapping

| v1.x                     | v2.x                                                                      | Notes                                                   |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ChangeLog.entityKey`    | `Changes.entityKey`                                                       | Direct copy                                             |
| `ChangeLog.createdAt`    | `Changes.createdAt`                                                       | Direct copy                                             |
| `ChangeLog.createdBy`    | `Changes.createdBy`                                                       | Direct copy                                             |
| `ChangeLog.entity`       | `Changes.entity`                                                          | Fallback via COALESCE                                   |
| `Changes.entityID`       | `Changes.objectID`                                                        | Renamed                                                 |
| `Changes.parentEntityID` | `Changes.rootObjectID`                                                    | Renamed                                                 |
| `Changes.parentKey`      | `Changes.rootEntityKey`                                                   | Renamed                                                 |
| New                      | `Changes.rootEntity`                                                      | Derived from `ChangeLog.entity` when `parentKey` is set |
| New                      | `Changes.valueChangedFromLabel` / `valueChangedToLabel` / `transactionID` | NULL for migrated rows                                  |
