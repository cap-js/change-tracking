using { sap.capire.bookshop.test.objectid as db } from '../db/test-objectid';

service ObjectIdTestService {
    entity Stores          as projection on db.Stores;
    entity Books           as projection on db.Books;
    entity Authors         as projection on db.Authors;
    entity RootEntity      as projection on db.RootEntity;
    entity Level1Entity    as projection on db.Level1Entity;
    entity Level2Entity    as projection on db.Level2Entity;
    entity Level3Entity    as projection on db.Level3Entity;
    entity ParentEntity    as projection on db.ParentEntity;
    entity ChildEntity     as projection on db.ChildEntity;
    entity LifecycleStatus as projection on db.LifecycleStatus;
}
