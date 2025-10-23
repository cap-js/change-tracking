# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 1.1.2 - TBD

### Added

### Fixed

- Support single keys which are not named ID

### Changed


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

