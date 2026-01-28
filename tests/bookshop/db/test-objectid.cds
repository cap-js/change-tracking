namespace sap.capire.bookshop.test.objectid;

using { cuid, sap.common.CodeList } from '@sap/cds/common';

// Entity with single field as objectID
entity Stores : cuid {
    name     : String(100);
    location : String(100);
}

// Entity for testing multiple fields as objectID
entity Books : cuid {
    title    : String(200);
    author   : Association to Authors;
    stock    : Integer;
}

// Entity with struct field (name { firstName, lastName }) for objectID
entity Authors : cuid {
    name         : {
        firstName : String(100);
        lastName  : String(100);
    };
    placeOfBirth : String(100);
}

// Root entity for composition hierarchy and chained association objectID testing
entity RootEntity : cuid {
    title           : String(100);
    lifecycleStatus : Association to LifecycleStatus;
    child           : Composition of many Level1Entity on child.parent = $self;
}

entity Level1Entity : cuid {
    title  : String(100);
    parent : Association to RootEntity;
    child  : Composition of many Level2Entity on child.parent = $self;
}

entity Level2Entity : cuid {
    title  : String(100);
    parent : Association to Level1Entity;
    child  : Composition of many Level3Entity on child.parent = $self;
}

entity Level3Entity : cuid {
    title  : String(100);
    parent : Association to Level2Entity;
}

// Code list for lifecycle status
entity LifecycleStatus : CodeList {
    key code : String(2);
}

// Parent entity with child composition for parentObjectID testing
entity ParentEntity : cuid {
    name     : String(100);
    location : String(100);
    children : Composition of many ChildEntity on children.parent = $self;
}

entity ChildEntity : cuid {
    title  : String(100);
    value  : Integer;
    parent : Association to ParentEntity;
}
