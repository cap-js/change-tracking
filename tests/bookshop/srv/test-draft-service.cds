using { sap.capire.bookshop.test.draft as db } from '../db/test-draft';
using { sap.capire.bookshop.Authors as BookshopAuthors } from '../db/schema';

service DraftTestService {
    @odata.draft.enabled
    entity BookStoresBasic @(cds.autoexpose) as projection on db.BookStoresBasic;

    @odata.draft.enabled
    entity BookStoresNoObjectId @(cds.autoexpose) as projection on db.BookStoresNoObjectId;

    @odata.draft.enabled
    entity BookStoresForValueDataType @(cds.autoexpose) as projection on db.BookStoresForValueDataType;

    @odata.draft.enabled
    entity BookStoresForAssociationDataType @(cds.autoexpose) as projection on db.BookStoresForAssociationDataType;

    entity BooksWithAuthorDateOfBirth as projection on db.BooksWithAuthorDateOfBirth;

    @odata.draft.enabled
    entity BookStoresWithCodeListObjectId @(cds.autoexpose) as projection on db.BookStoresWithCodeListObjectId;

    @odata.draft.enabled
    entity RootSampleDraftNoObjectId @(cds.autoexpose) as projection on db.RootSampleDraftNoObjectId;

    @odata.draft.enabled
    entity RootSampleDraftWithObjectId @(cds.autoexpose) as projection on db.RootSampleDraftWithObjectId;

    entity BooksWithPriceTracking as projection on db.BooksWithPriceTracking;
    entity BooksNoObjectId as projection on db.BooksNoObjectId;
    entity BooksForCompositionDataType as projection on db.BooksForCompositionDataType;
    entity Level1SampleDraftNoObjectId as projection on db.Level1SampleDraftNoObjectId;
    entity Level1SampleDraftWithObjectId as projection on db.Level1SampleDraftWithObjectId;
    entity Level2SampleDraftWithObjectId as projection on db.Level2SampleDraftWithObjectId;
    entity Authors as projection on BookshopAuthors;
}

// BookStoresBasic with price tracking enabled
annotate DraftTestService.BookStoresBasic with @title: 'Book Stores Basic' @changelog: [name] {
    name  @changelog;
    books @changelog: [books.title] @title: 'Books';
}

annotate DraftTestService.BooksWithPriceTracking with @title: 'Books With Price Tracking' @changelog: [title, author.name.firstName, author.name.lastName] {
    title  @changelog @title: 'Title';
    price  @changelog @title: 'Price';
    isUsed @changelog @title: 'Is Used';
    author @changelog: [author.name.firstName, author.name.lastName] @title: 'Author';
}

// BookStoresNoObjectId - no @changelog entity annotation for missing objectID tests
// The entity-level @changelog is missing, but books composition is tracked
annotate DraftTestService.BookStoresNoObjectId with @title: 'Book Stores No Object Id' {
    books @changelog: [books.title] @title: 'Books';
}

annotate DraftTestService.BooksNoObjectId with @title: 'Books No Object Id' {
    title @changelog;
}

// BookStoresForValueDataType for composition valueDataType tests
annotate DraftTestService.BookStoresForValueDataType with @changelog: [name] {
    name  @changelog;
    books @changelog: [books.title, books.stock, books.price];
}

annotate DraftTestService.BooksForCompositionDataType with @changelog: [title, author.name.firstName, author.name.lastName] {
    title  @changelog;
    stock  @changelog;
    price  @changelog;
    author @changelog: [author.name.firstName, author.name.lastName];
}

// BookStoresForAssociationDataType for association valueDataType tests
annotate DraftTestService.BookStoresForAssociationDataType with @changelog: [name] {
    name  @changelog;
    books @changelog: [books.title];
}

// BooksWithAuthorDateOfBirth for association valueDataType tests
annotate DraftTestService.BooksWithAuthorDateOfBirth with @changelog: [title, author.name.firstName, author.name.lastName] {
    title  @changelog;
    author @changelog: [author.name.firstName, author.dateOfBirth, author.name.lastName];
}

// BookStoresWithCodeListObjectId for code list as objectID tests
annotate DraftTestService.BookStoresWithCodeListObjectId with @changelog: [name, lifecycleStatus.name] {
    name            @changelog;
    lifecycleStatus @changelog: [lifecycleStatus.name];
}

// RootSampleDraftNoObjectId - no @changelog entity annotation for special characters UPDATE test
annotate DraftTestService.Level1SampleDraftNoObjectId with {
    title @changelog @title: 'Level1 Draft NoObjectId Title';
}

// RootSampleDraftWithObjectId - WITH @changelog for special characters CREATE NESTED test
annotate DraftTestService.RootSampleDraftWithObjectId with @changelog: [ID, title] {
    title @changelog @title: 'Root Sample Draft With ObjectId';
}

annotate DraftTestService.Level1SampleDraftWithObjectId with @changelog: [ID, title, parent.ID] {
    title @changelog @title: 'Level1 Draft WithObjectId Title';
}

annotate DraftTestService.Level2SampleDraftWithObjectId with @changelog: [ID, title, parent.parent.ID] {
    title @changelog @title: 'Level2 Draft WithObjectId Title';
}
