# Requirements

## Test Structure
1. Core CRUD Operations (Tracking for Create, Update, Delete)
2. Configurations Options (preserveDeletes, disableTracking)
3. ObjectID - Human-readable IDs via @changelog entity annotation
4. Display Values (Human-readable values via @changelog element annotation)
5. Composition Tracking (composition of many, composition of one, deep operations)
6. Edge Cases (special characters, personal data, localization, association to many)

## Consider while writing tests
- use `cds.env.requires` to change env variables (for config options)
- use destructoring at the beginning of a test to access entites: `const {Authors} = adminService.entities;`
- use `cds.utils.uuid()` for generating random UUIDs (do not define them in a global variable, if not necessary)
- use humand-readable test names
- test should be atomar and actually test the behaviour rather than implementation details