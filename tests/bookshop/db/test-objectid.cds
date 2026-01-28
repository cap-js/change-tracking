namespace sap.capire.bookshop.test.objectid;

using { cuid, sap.common.CodeList } from '@sap/cds/common';

// Entity with single field as objectID
@changelog: [name]
entity Stores : cuid {
    name     : String(100) @changelog;
    location : String(100) @changelog;
}

// Entity for testing multiple fields as objectID
@changelog: [title, author.name.firstName, author.name.lastName]
entity Books : cuid {
    title  : String(200) @changelog;
    author : Association to Authors @changelog: [author.name.firstName, author.name.lastName];
    stock  : Integer @changelog;
}

// Entity with struct field (name { firstName, lastName }) for objectID
@changelog: [name.firstName, name.lastName]
entity Authors : cuid {
    @changelog
    name : {
        firstName : String(100);
        lastName  : String(100);
    };
    placeOfBirth : String(100) @changelog;
}

// Root entity with lifecycleStatus code list for display
@changelog: [lifecycleStatus.name]
entity RootEntity : cuid {
    title           : String(100) @changelog;
    lifecycleStatus : Association to LifecycleStatus @changelog: [lifecycleStatus.name];
    child           : Composition of many Level1Entity on child.parent = $self @changelog: [child.title];
}

// One-level chained association as objectID
@changelog: [parent.lifecycleStatus.name]
entity Level1Entity : cuid {
    title  : String(100) @changelog;
    parent : Association to RootEntity;
    child  : Composition of many Level2Entity on child.parent = $self @changelog: [child.title];
}

// Deep chained association as objectID
@changelog: [parent.parent.lifecycleStatus.name]
entity Level2Entity : cuid {
    title  : String(100) @changelog;
    parent : Association to Level1Entity;
    child  : Composition of many Level3Entity on child.parent = $self @changelog: [child.title];
}

// Deep chained association 3 levels
@changelog: [parent.parent.parent.lifecycleStatus.name]
entity Level3Entity : cuid {
    title  : String(100) @changelog;
    parent : Association to Level2Entity;
}

// Code list for lifecycle status
entity LifecycleStatus : CodeList {
    key code : String(2);
}

// Parent entity with child composition for parentObjectID testing
@changelog: [name]
entity ParentEntity : cuid {
    name     : String(100) @changelog;
    location : String(100) @changelog;
    children : Composition of many ChildEntity on children.parent = $self @changelog: [children.title];
}

// Child entity for parentObjectID testing
@changelog: [title]
entity ChildEntity : cuid {
    title  : String(100) @changelog;
    value  : Integer @changelog;
    parent : Association to ParentEntity;
}
