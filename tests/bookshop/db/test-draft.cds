namespace sap.capire.bookshop.test.draft;

using { cuid, managed } from '@sap/cds/common';
using { sap.capire.bookshop.Authors } from '../db/schema';
using { sap.capire.common.types.LifecycleStatusCode } from './common/types.cds';

// Entity with price tracking for zero/false value tests
entity BookStoresBasic : managed, cuid {
    name            : String;
    location        : String;
    lifecycleStatus : LifecycleStatusCode;
    books           : Composition of many BooksWithPriceTracking on books.bookStore = $self;
}

// Books entity with price field tracked (for zero/false value tests)
entity BooksWithPriceTracking : managed, cuid {
    title     : String(111);
    bookStore : Association to BookStoresBasic;
    author    : Association to Authors;
    stock     : Integer;
    price     : Decimal(11, 4);
    isUsed    : Boolean;
}

// Entity without objectID annotation for testing missing objectID
entity BookStoresNoObjectId : managed, cuid {
    name     : String;
    location : String;
    books    : Composition of many BooksNoObjectId on books.bookStore = $self;
}

// Books entity without objectID annotation
entity BooksNoObjectId : managed, cuid {
    title     : String(111);
    bookStore : Association to BookStoresNoObjectId;
    author    : Association to Authors;
}

// Entity for composition valueDataType tests
entity BookStoresForValueDataType : managed, cuid {
    name  : String;
    books : Composition of many BooksForCompositionDataType on books.bookStore = $self;
}

// Child entity for composition valueDataType tests
entity BooksForCompositionDataType : managed, cuid {
    title     : String(111);
    bookStore : Association to BookStoresForValueDataType;
    author    : Association to Authors;
    stock     : Integer;
    price     : Decimal(11, 4);
}

// Parent entity for association valueDataType tests
entity BookStoresForAssociationDataType : managed, cuid {
    name  : String;
    books : Composition of many BooksWithAuthorDateOfBirth on books.bookStore = $self;
}

// Books entity with author dateOfBirth for association valueDataType tests
entity BooksWithAuthorDateOfBirth : managed, cuid {
    title     : String(111);
    bookStore : Association to BookStoresForAssociationDataType;
    author    : Association to Authors;
    stock     : Integer;
}

// Entity with code list as objectID
entity BookStoresWithCodeListObjectId : managed, cuid {
    name            : String;
    location        : String;
    lifecycleStatus : LifecycleStatusCode;
}

// Root entity for special characters UPDATE test (no @changelog on entity - tests missing objectID)
@title: 'Root Sample Draft NoObjectId'
entity RootSampleDraftNoObjectId : managed {
    key ID    : String;
        child : Composition of many Level1SampleDraftNoObjectId on child.parent = $self;
        title : String;
}

// Level1 entity for special characters UPDATE test (no @changelog on entity)
@title: 'Level1 Sample Draft NoObjectId'
entity Level1SampleDraftNoObjectId : managed {
    key ID     : String;
        parent : Association to RootSampleDraftNoObjectId;
        title  : String;
}

// Root entity for special characters CREATE NESTED test (WITH @changelog annotation)
@title: 'Root Sample Draft With ObjectId'
entity RootSampleDraftWithObjectId : managed {
    key ID    : String;
        child : Composition of many Level1SampleDraftWithObjectId on child.parent = $self;
        title : String;
}

// Level1 entity for special characters CREATE NESTED test (WITH @changelog annotation)
@changelog: [ID, title, parent.ID]
@title: 'Level1 Sample Draft With ObjectId'
entity Level1SampleDraftWithObjectId : managed {
    key ID     : String;
        parent : Association to RootSampleDraftWithObjectId;
        child  : Composition of many Level2SampleDraftWithObjectId on child.parent = $self;
        title  : String;
}

// Level2 entity for special characters CREATE NESTED test
@changelog: [ID, title, parent.parent.ID]
entity Level2SampleDraftWithObjectId : managed {
    key ID     : String;
        title  : String;
        parent : Association to Level1SampleDraftWithObjectId;
}
