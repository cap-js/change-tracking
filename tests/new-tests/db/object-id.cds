namespace test.objectid;

using { cuid, sap.common.CodeList } from '@sap/cds/common';

// Single field objectID
@changelog: [name]
entity Stores : cuid {
    name     : String @changelog;
    location : String @changelog;
}

// Multiple fields objectID (including association path)
@changelog: [title, author.name.firstName, author.name.lastName]
entity Books : cuid {
    title  : String @changelog;
    author : Association to Authors;
    stock  : Integer @changelog;
}

// Struct field objectID
@changelog: [name.firstName, name.lastName]
entity Authors : cuid {
    name : {
        firstName : String;
        lastName  : String;
    };
    placeOfBirth : String @changelog;
}

// Code list for objectID resolution
entity Status : CodeList {
    key code : String(2);
}

// Entity with code list as objectID
@changelog: [status.name]
entity Projects : cuid {
    title  : String @changelog;
    status : Association to Status;
}

// Chained association objectID (1 level)
@changelog: [parent.status.name]
entity Level1Items : cuid {
    title  : String @changelog;
    parent : Association to Projects;
}

// Deep chained association objectID (3 levels)
@changelog: [parent.parent.parent.status.name]
entity Level3Items : cuid {
    title  : String @changelog;
    parent : Association to Level2Items;
}

entity Level2Items : cuid {
    title  : String @changelog;
    parent : Association to Level1Items;
}

// Parent/Child for parentObjectID tests
@changelog: [name]
entity Parents : cuid {
    name     : String @changelog;
    children : Composition of many Children on children.parent = $self
               @changelog: [children.title];
}

@changelog: [title]
entity Children : cuid {
    title  : String @changelog;
    value  : Integer @changelog;
    parent : Association to Parents;
}
