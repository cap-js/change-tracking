using { sap.capire.bookshop.test.objectid as db } from '../db/test-objectid';

service ObjectIdTestService {
    // Single field as objectID (@changelog: [name])
    @changelog: [name]
    entity Stores as projection on db.Stores {
        *,
        @changelog
        name,
        @changelog
        location
    };

    // Multiple fields as objectID (@changelog: [title, author.name.firstName, author.name.lastName])
    @changelog: [title, author.name.firstName, author.name.lastName]
    entity Books as projection on db.Books {
        *,
        @changelog
        title,
        @changelog: [author.name.firstName, author.name.lastName]
        author,
        @changelog
        stock
    };

    // Struct field as objectID (@changelog: [name.firstName, name.lastName])
    @changelog: [name.firstName, name.lastName]
    entity Authors as projection on db.Authors {
        *,
        @changelog
        name,
        @changelog
        placeOfBirth
    };

    // One-level chained association as objectID (@changelog: [parent.lifecycleStatus.name])
    @changelog: [parent.lifecycleStatus.name]
    entity Level1Entity as projection on db.Level1Entity {
        *,
        @changelog
        title,
        @changelog: [child.title]
        child
    };

    // Deep chained association as objectID (@changelog: [parent.parent.lifecycleStatus.name])
    @changelog: [parent.parent.lifecycleStatus.name]
    entity Level2Entity as projection on db.Level2Entity {
        *,
        @changelog
        title,
        @changelog: [child.title]
        child
    };

    // Deep chained association 3 levels (@changelog: [parent.parent.parent.lifecycleStatus.name])
    @changelog: [parent.parent.parent.lifecycleStatus.name]
    entity Level3Entity as projection on db.Level3Entity {
        *,
        @changelog
        title
    };

    // Root entity with lifecycleStatus code list for display
    @changelog: [lifecycleStatus.name]
    entity RootEntity as projection on db.RootEntity {
        *,
        @changelog
        title,
        @changelog: [lifecycleStatus.name]
        lifecycleStatus,
        @changelog: [child.title]
        child
    };

    // Parent entity for parentObjectID testing
    @changelog: [name]
    entity ParentEntity as projection on db.ParentEntity {
        *,
        @changelog
        name,
        @changelog
        location,
        @changelog: [children.title]
        children
    };

    // Child entity for parentObjectID testing
    @changelog: [title]
    entity ChildEntity as projection on db.ChildEntity {
        *,
        @changelog
        title,
        @changelog
        value
    };

    entity LifecycleStatus as projection on db.LifecycleStatus;
}
