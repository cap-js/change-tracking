# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 2.0.0 - 2026-06-12

### Added
- Trigger generation for SQLite, HANA, Postgres and H2 to perform change tracking on the database level
- Allow grouping of changes via new `transactionID` column
- `valueChangedFromLabel` and `valueChangedToLabel` columns on `sap.changelog.Changes` for localized labels
- Allow change tracking skip via session variables for entire transactions, entities, elements (`ct.skip`)
- Dynamic localized label lookup: if a `@changelog` label points to a localized property from a code list entity, the label is resolved in the reader's locale at read time
- Support CDS expression language (CXL) in `@changelog` annotations for custom objectIDs and changelog labels
- Customizable objectID for composition changelog entries on parent entities
- Database indexes on `sap.changelog.Changes` for faster parent composition lookups and deduplication queries
- Generation of `.hdbmigrationtable` and updating `undeploy.json` via `cds add change-tracking-migration`
- HANA procedure `SAP_CHANGELOG_RESTORE_BACKLINKS` to restore parent-child hierarchy for composition changes
- `rowLevelTriggers` configuration flag to opt into row-level HANA triggers as a workaround for "invalid RID address" errors
- Support for tracked Date, DateTime, Time and Timestamp properties with correct formatting
- Support for `@Common.Timezone` on change-tracked entities
- Change History section is hidden in draft mode

### Changed
- Switch from event handler registration to native database triggers for change capture mechanism
- HANA triggers use statement-level execution by default for improved bulk DML performance
- Removed table entity `sap.changelog.ChangeLog` and flattened into `sap.changelog.Changes`
- Display changes with a Tree Table
- Changes from child entities are shown on the parent ChangeView by default (configurable via `maxDisplayHierarchyDepth`)
- Composition changelog entries on parents always have `update` as modification type
- Only skip change tracking for `@PersonalData.IsPotentiallySensitive` and `@PersonalData.IsPotentiallyPersonal` (not `@PersonalData.FieldSemantics`)
- Localization is performed on database level via `sap.changelog.i18nKeys` table
- Modifications on `sap.changelog.Changes`:
    - Removed `serviceEntityPath`, `keys` and foreign key `changeLog`
    - Renamed `entityID` to `objectID`
    - Renamed `parentEntityID` to `rootObjectID` and `parentKey` to `rootEntityKey`
    - Added `entityKey`, `createdAt` and `createdBy` from deleted entity `sap.changelog.ChangeLog`
    - Added `rootEntity` field
- ChangeView in services is no longer directly accessible; it can only be accessed via navigation paths

### Fixed
- Performance issues when working with entities that include a large number of fields and children
- Creation of changelogs at bulk operations
- Search and sort functionality on the `ChangeView`
- `LargeString` values are truncated and don't lead to failing inserts
- Explicit type casts for Date, DateTime, Time, Timestamp and Decimal fields in `ChangeView`
- Format tracked decimal values with correct precision (e.g., Decimal(11,4) stores 0 as `0.0000`)
- ObjectID correctly falls back to entity key when all `@changelog` fields are NULL
- Deployment error when an entity key uses a custom type defined as an association

### Removed
- Removed configuration option `considerLocalizedValues`

## Version 1.1.4 - 2025-12-03

### Fixed
- Server no longer crashes when after a DB migration the service name or attribute name change
- Fix crash when applications uses feature toogles or extensibility


## Version 1.1.3 - 2025-10-27

### Changed
- Correctly handle changes on foreign keys when sending them via the document notation on an API level.


## Version 1.1.2 - 2025-10-23

### Fixed

- Support single keys which are not named `ID`


## Version 1.1.1 - 2025-10-17

### Added

- Allow tracking of localized values with `considerLocalizedValues`
- Added more translations for the UI labels for more languages

### Changed

- Correct localisation for `cds.Date`, `cds.Time`, `cds.DateTime` and `cds.Timestamp` properties


## Version 1.1.0 - 2025-10-13

### Added

- License entry
- Added translations for the UI labels for more languages

### Fixed

- Handling of multiple records in one request
- Handle cases where the key contains '/'
- Instantiate the changes association correctly so it does not impact other `@cap-js` plugins

### Changed

- Prepare for CDS9 in tests

## Version 1.0.8 - 2025-03-28

### Added

- Added @UI.MultiLineText to value fields
- Added support for Multi-Tenancy
- Added configuration options to disable tracking of CREATE/UPDATE/DELETE operations on a project level

### Fixed

- Handling of numeric and boolean fields was faulty, when an initial value of `0` for numeric or `false` for boolean was supplied
- Decimal values were handled differently for HANA and SQlite
- Missing UI Label for one attribute (`ChangeLog.ID`) of the Changes UI facet
- Support for @UI.HeaderInfo.TypeName as fallback for the UI Label of the key
- Compilation error when an association is used as a key
- Fixed handling of unmanaged composition of many
- Proper casing of the operation enum type


### Changed

- Added warning and mitigation for multi-tenant deployments with MTX
- Added a disclaimer of upcoming new version having a minimum requirement of CDS 8.6 for multitenancy fix
- Changed the default limit on non-HANA databases from 255 to 5000 characters for all String values
- Updated peer dependency from CDS7 to CDS8


## Version 1.0.7 - 2024-08-20

### Added

 - A global switch to preserve change logs for deleted data
 - For hierarchical entities, a method to determine their structure and a flag to indicate whether it is a root entity was introduced. For child entities, information about the parent is recorded.


### Fixed

- CDS 8 does not support queries for draft-enabled entities on the application service anymore. This was causing: SqliteError: NOT NULL constraint failed: (...).DraftAdministrativeData_DraftUUID
- CDS 8 deprecated cds.transaction, causing change logs of nested documents to be wrong, replaced with req.event
- CDS 8 rejects all direct CRUD requests for auto-exposed Compositions in non-draft cases. This was affecting test cases, since the ChangeView falls into this category
- req._params and req.context are not official APIs and stopped working with CDS 8, replaced with official APIs
- When running test cases in CDS 8, some requests failed with a status code of 404
- ServiceEntity is not captured in the ChangeLog table in some cases
- When modeling an inline entity, a non-existent association and parent ID was recorded
- Fixed handling, when reqData was undefined

### Changed

- Peer dependency to @sap/cds changed to ">=7"
- Data marked as personal data using data privacy annotations won't get change-tracked anymore to satisfy product standards
- Restructured Documentation


## Version 1.0.6 - 2024-04-29

### Fixed

 -  Storage of wrong ObjectID in some special scenarios
 -  Missing localization of managed fields
 -  Views without keys won't get the association and UI facet pushed anymore

### Added

 - A method to disable automatic generation of the UI Facet

### Changed

 - Improved documentation of the @changelog Annotation

## Version 1.0.5 - 2024-01-15

### Fixed

- Error on HANA when logging Boolean or Numeric Data

## Version 1.0.4 - 2024-01-08

### Added

- Side effect annotation now allows automatic refresh after a custom action caused changes

### Changed

- Added a check to disable change tracking for views with a UNION

### Fixed

- Handling of associations within change tracked entities
- Handling of change log when custom actions on child entities are called

## Version 1.0.3 - 2023-11-10

### Added

- Added note about using `SAPUI5 v1.120.0` or later for proper lazy loading of the *Change History* table.
- In README, add warning about tracking personal data.

### Changed

- Support cases where parent/child entries are created simultaneously.
- Allow for lazy loading of change history table (with SAP UI5 release 1.120.0).

## Version 1.0.2 - 2023-10-31

### Changed

- In README, use view of the full change-tracking table instead of the customized one for the main image.

## Version 1.0.1 - 2023-10-26

### Changed

- Flattened README structure.

### Fixed

- Labels are looked up from the service entity (not the db entity only).

## Version 1.0.0 - 2023-10-18

### Added

- Initial release

