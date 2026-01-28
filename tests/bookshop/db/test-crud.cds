// Minimal model for CRUD operation tests
namespace sap.capire.bookshop.test.crud;

using { cuid, managed } from '@sap/cds/common';

// Simple entity with basic tracked fields
entity Items : cuid, managed {
    @changelog name     : String;
    @changelog quantity : Integer;
    @changelog isActive : Boolean;
    @changelog price    : Decimal(10,2);
}

// Entity for testing multiple records and null values
entity Products : cuid {
    @changelog title    : String;
    @changelog stock    : Integer;
    @changelog category : String;
}

// Entity for testing DateTime/Timestamp tracking
entity Events : cuid {
    @changelog name      : String;
    @changelog eventDate : DateTime;
    @changelog timestamp : Timestamp;
}
