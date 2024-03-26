# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 1.0.6 - TBD

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

