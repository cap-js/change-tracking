# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 2.0.0-beta.10 - 27.04.26

### Changed
- HANA triggers reverted from statement-level back to row-level execution for improved compatibility
- Restored `CHANGE_TRACKING_DUMMY` entity required for row-level HANA triggers

### Added
- Database indexes on `sap.changelog.Changes` table for faster parent composition lookups and deduplication queries (SQLite, HANA, Postgres)

### Fixed
- Server crash when running raw inserts due to missing guards in service handler for setting session variables.
- Deployment crash during trigger and procedure generation for entities that use SQL reserved keywords as columns names (e.g. `order`) due to missing escaping
- Only cast entity keys to type string in the ON condition of changes when they are not type of `cds.String` or `cds.UUID`
- ObjectID correctly falls back to entity key when all @changelog fields are NULL instead of showing "<empty>, <empty>,..., <empty>"

## Version 2.0.0-beta.9 - 15.04.26

### Added
- Customizable objectID for composition changelog entries on parent entities:
  - **Composition of one**: objectID is derived from the child entity's `@changelog` annotation, falling back to the parent entity's `@changelog`
  - **Composition of many**: objectID falls back to the parent entity's `@changelog` annotation, but can be customized on the composition field using `@changelog` with a path or expression referencing parent

### Changed
- Only skip change tracking for `@PersonalData.IsPotentiallySensitive` and `@PersonalData.IsPotentiallyPersonal` and not `@PersonalData.FieldSemantics`

## Version 2.0.0-beta.8 - 09.04.26

### Fixed
- Do not add @UI.Hidden: ($draft.IsActiveEntity) to the UI changes section when the entity is not draft enabled.

## Version 2.0.0-beta.7 - 08.04.26

### Added
- Support CDS expression language (CXL) in `@changelog` annotations to enable broader customization of objectIDs and changelog labels

### Fixed
- Existing Facets for displaying the Changes UI are correctly detected avoiding redundant Changes sections.
- Format tracked decimal values with correct precision (e.g., Decimal(11,4) stores 0 as '0.0000')

### Changed
- HANA triggers changed from row-level to statement-level execution
- Removed `CHANGE_TRACKING_DUMMY` entity
- Change History section is now hidden in draft mode

## Version 2.0.0-beta.6 - 26.03.26

### Added
- Provide detailed plan for v1 to v2 HANA migration
- Generation of `.hdbmigrationtable` and updating `undeploy.json` via `cds add change-tracking-migration`
- HANA procedure `SAP_CHANGELOG_RESTORE_BACKLINKS` to restore parent-child hierarchy for composition changes

### Fixed
- Explicit type casts for Date, DateTime, Time, Timestamp and Decimal fields in `ChangeView` to avoid conversion errors
- Lazy load database adapters to prevent crashes when optional dependencies are not installed
- Skip changelogs referencing association targets annotated with `@cds.persistence.skip`
- Cast single entity keys to `cds.String` to prevent type conversion errors
- Dynamic localization now verifies `.texts` entity existence before attempting localized lookup


## Version 2.0.0-beta.5 - 17.03.26

### Added
- Support dynamic localized label lookup, meaning if for example a property is change tracked and its change tracking label (@changelog : [<association>.<localized_prop>]) points to one localized property from its code list entity, the label is dynamically fetched when the change is read based on the users locale.

### Fixed
- Postgres considers `disable*Tracking` for children changes
- Human-readable `@changelog` annotation supports combination of direct entity elements and association elements

## Version 2.0.0-beta.4 - 16.03.26

### Added

- Tracked Date, DateTime, Time and Timestamp properties are now correctly formatted again.
- If a tracked property is annotated with `@Common.Timezone` the changelog now considers the Timezone as well.

## Version 2.0.0-beta.3 - 13.03.26

### Fixed
- CSV data for `i18nKeys` and `CHANGE_TRACKING_DUMMY` is now correctly generated during the HANA build

### Changed
- Changes from child entities are shown on the parent ChangeView by default
- Depth of displayed child changes can be configured via `maxDisplayHierarchyDepth`
- Improved search capabilities for changes

## Version 2.0.0-beta.2 - 11.03.26

### Fixed
- Fixed a server crash when resolving table names
- Support entity level `@changelog` annotation where no explicit elements for the object ID are defined
- Trigger generation works again for MTX scenarios

### Changed
- Improved performance when quering changes


## Version 2.0.0-beta.1 - 06.03.26

### Added
- Trigger generation for SQLite, HANA, Postgres and H2 to perform change tracking on a database level
- Allow grouping of changes via new `transactionID` column
- Added `valueChangedFromLabel` and `valueChangedToLabel` to `sap.changelog.Changes` for localized labels
- Allow change tracking skip via session variables for entire transactions, entities, elements (`ct.skip`)

### Fixed
- Performance issues when working with entities that include a large number of fields and children
- Creation of changelogs at bulk operations
- Fixed search and sort functionality on the `ChangeView`
- `LargeString` are truncated and don't lead to failing insert
- Supports change tracking with every kind of update operation 

### Changed
- Switch from event handler registration to native database triggers for change capture mechanism
- Removed table entity `sap.changelog.ChangeLog` and flattened into `sap.changelog.Changes`
- Display changes with a Tree Table
- Modifications on `sap.changelog.Changes`
    - Removed `serviceEntityPath`, `keys` and foreign key `changeLog`
    - Renamed `entityID` to `objectID`
    - Renamed `parentEntityID` to `rootObjectID` and `parentKey` to `rootEntityKey`
    - Added `entityKey`, `createdAt` and `createdBy` from deleted entity `sap.changelog.ChangeLog`
    - Added `rootEntity` field 
- Localization is performed on database level and therefore the table `sap.changelog.i18nKeys` that stores localized labels was added
- Expose localized label fields on `sap.changelog.ChangeView`

### Removed
- Removed configuration option `considerLocalizedValues`

## Version 1.1.4 - 03.12.25

### Fixed
- Server no longer crashes when after a DB migration the service name or attribute name change
- Fix crash when applications uses feature toogles or extensibility


## Version 1.1.3 - 27.10.25

### Changed
- Correctly handle changes on foreign keys when sending them via the document notation on an API level.


## Version 1.1.2 - 23.10.25

### Fixed

- Support single keys which are not named `ID`


## Version 1.1.1 - 17.10.25

### Added

- Allow tracking of localized values with `considerLocalizedValues`
- Added more translations for the UI labels for more languages

### Changed

- Correct localisation for `cds.Date`, `cds.Time`, `cds.DateTime` and `cds.Timestamp` properties


## Version 1.1.0 - 13.10.25

### Added

- License entry
- Added translations for the UI labels for more languages

### Fixed

- Handling of multiple records in one request
- Handle cases where the key contains '/'
- Instantiate the changes association correctly so it does not impact other `@cap-js` plugins

### Changed

- Prepare for CDS9 in tests

## Version 1.0.8 - 28.03.25

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


## Version 1.0.7 - 20.08.24

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


## Version 1.0.6 - 29.04.24

### Fixed

 -  Storage of wrong ObjectID in some special scenarios
 -  Missing localization of managed fields
 -  Views without keys won't get the association and UI facet pushed anymore

### Added

 - A method to disable automatic generation of the UI Facet

### Changed

 - Improved documentation of the @changelog Annotation

## Version 1.0.5 - 15.01.24

### Fixed

- Error on HANA when logging Boolean or Numeric Data

## Version 1.0.4 - 08.01.24

### Added

- Side effect annotation now allows automatic refresh after a custom action caused changes

### Changed

- Added a check to disable change tracking for views with a UNION

### Fixed

- Handling of associations within change tracked entities
- Handling of change log when custom actions on child entities are called

## Version 1.0.3 - 10.11.23

### Added

- Added note about using `SAPUI5 v1.120.0` or later for proper lazy loading of the *Change History* table.
- In README, add warning about tracking personal data.

### Changed

- Support cases where parent/child entries are created simultaneously.
- Allow for lazy loading of change history table (with SAP UI5 release 1.120.0).

## Version 1.0.2 - 31.10.23

### Changed

- In README, use view of the full change-tracking table instead of the customized one for the main image.

## Version 1.0.1 - 26.10.23

### Changed

- Flattened README structure.

### Fixed

- Labels are looked up from the service entity (not the db entity only).

## Version 1.0.0 - 18.10.23

### Added

- Initial release

