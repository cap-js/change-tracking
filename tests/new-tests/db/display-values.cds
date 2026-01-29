namespace test.display;

using { cuid } from '@sap/cds/common';

entity Books : cuid {
    title  : String @changelog;
    author : Association to Authors
             @changelog: [author.firstName, author.lastName];
    stock  : Integer @changelog;
}

entity Authors : cuid {
    firstName : String;
    lastName  : String;
}

// For testing association with single display field
entity Orders : cuid {
    title    : String @changelog;
    customer : Association to Customers
               @changelog: [customer.name];
}

entity Customers : cuid {
    name : String;
    city : String;
}
