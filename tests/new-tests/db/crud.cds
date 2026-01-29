namespace test.crud;

using { cuid } from '@sap/cds/common';

entity Items : cuid {
    name     : String @changelog;
    quantity : Integer @changelog;
    isActive : Boolean @changelog;
    price    : Decimal(10,2) @changelog;
    category : String @changelog;
}

entity Events : cuid {
    name      : String @changelog;
    eventDate : DateTime @changelog;
    timestamp : Timestamp @changelog;
}
