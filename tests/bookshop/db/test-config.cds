// Minimal model for Configuration option tests
namespace sap.capire.bookshop.test.config;

using { cuid, managed } from '@sap/cds/common';

// Entity for testing preserveDeletes, disable flags
entity Records : cuid, managed {
    name        : String @changelog;
    description : String @changelog;
    status      : String @changelog;
}
