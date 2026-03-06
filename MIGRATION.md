# Migration Guide: Switch from v1 to v2

> [!NOTE]
>
> A HANA migration table will be provided with the full release, as well as a procedure to convert existing changes into the hierarchy.

The new version moves the tracking mechanism from event handlers to native database triggers (SQLite, PostgreSQL, HANA, H2). The `ChangeLog` entity was removed, everything lives in a flat `Changes` table now. Localization moved from runtime handlers to an `i18nKeys` lookup table with SQL `COALESCE`.

## Breaking Changes

### Schema

The `sap.changelog.ChangeLog` entity no longer exists. Its fields (`entityKey`, `createdAt`, `createdBy`) moved directly into `Changes`.

**Removed columns on `Changes`:**

| Column              | What happened                                    |
| ------------------- | ------------------------------------------------ |
| `keys`              | Dropped                                          |
| `entityID`          | Renamed to `objectID`                            |
| `serviceEntity`     | Dropped (triggers don't track the service layer) |
| `parentEntityID`    | Dropped (handled by tree table)                        |
| `parentKey`         | Dropped                       |
| `serviceEntityPath` | Dropped                                          |
| `changeLog` (FK)    | Dropped (no more parent entity)                  |

**Moved/renamed columns on `Changes`:**

| Column                    | Was                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `entityKey`               | Moved from `ChangeLog.entityKey`                           |
| `objectID`                | Renamed from `entityID`                                    |
| `createdAt` / `createdBy` | Moved from `ChangeLog`                                     |

**New columns on `Changes`:**

| Column                                          | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `parent` / `children` | Allow tree table      |
| `valueChangedFromLabel` / `valueChangedToLabel` | Localized labels for old/new values      |
| `transactionID`                                 | Groups changes from the same transaction |

**New entities:**

- `sap.changelog.i18nKeys` -- stores localized labels for attributes, entities, and modification types

### ChangeView columns

| Old                | New                                               |
| ------------------ | ------------------------------------------------- |
| `entity`           | `entityLabel` (localized via `i18nKeys`)          |
| `attribute`        | `attributeLabel` (localized via `i18nKeys`)       |
| `valueChangedFrom` | `valueChangedFromLabel` (falls back to raw value) |
| `valueChangedTo`   | `valueChangedToLabel` (falls back to raw value)   |

If you have custom UI components or queries referencing the old column names, update them.


### Annotations

`@changelog` syntax is unchanged. New behavior:

- `@changelog: false` on a service entity sets a session variable to skip that entity
- `@changelog: false` on an element skips that field

The `@changelog` annotation now only supports valid association paths.

## Data migration

### Column mapping

| v1.x                     | v2.x                                                                      | Notes                                                   |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ChangeLog.entityKey`    | `Changes.entityKey`                                                       | Direct copy                                             |
| `ChangeLog.createdAt`    | `Changes.createdAt`                                                       | Direct copy                                             |
| `ChangeLog.createdBy`    | `Changes.createdBy`                                                       | Direct copy                                             |
| `ChangeLog.entity`       | `Changes.entity`                                                          | Fallback via COALESCE                                   |
| `Changes.entityID`       | `Changes.objectID`                                                        | Renamed                                                 |
| New                      | `Changes.rootEntity`                                                      | Derived from `ChangeLog.entity` when `parentKey` is set |
| New                      | `Changes.valueChangedFromLabel` / `valueChangedToLabel` / `transactionID` | NULL for migrated rows                                  |
