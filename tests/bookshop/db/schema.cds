using {
  managed,
  cuid,
  sap
} from '@sap/cds/common';
using {
  sap.capire.common.types.PersonName as PersonName,
  sap.capire.common.types.CountryName as CountryName,
  sap.capire.common.types.LifecycleStatusCode as LifecycleStatusCode,
  sap.capire.common.types.BookTypeCodes as BookTypeCodes,
} from './common/types.cds';
using {sap.capire.bookshop.ActivationStatusCode} from './codelists';
using {sap.capire.bookshop.PaymentAgreementStatusCodes as PaymentAgreementStatusCodes} from './codelists';
using from './incidents/schema';
using from './incidents/attachments';

// Test module schemas
using from './test-crud';
using from './test-config';
using from './test-objectid';
using from './test-draft';

namespace sap.capire.bookshop;

@fiori.draft.enabled
@title: '{i18n>RootEntity.objectTitle}'
entity RootEntity @(cds.autoexpose) : managed, cuid {
  name            : String;
  dateTime        : DateTime;
  timestamp       : Timestamp;
  lifecycleStatus : LifecycleStatusCode;
  child           : Composition of many Level1Entity
                      on child.parent = $self;
  info            : Association to one AssocOne;
}

@title: '{i18n>Level1Entity.objectTitle}'
entity Level1Entity : managed, cuid {
  title  : String;
  parent : Association to one RootEntity;
  child  : Composition of many Level2Entity
             on child.parent = $self;
}

@title: '{i18n>Level2Entity.objectTitle}'
entity Level2Entity : managed, cuid {
  title  : String;
  parent : Association to one Level1Entity;
  child  : Composition of many Level3Entity
             on child.parent = $self;
}

@title: '{i18n>Level3Entity.objectTitle}'
entity Level3Entity : managed, cuid {
  title  : String;
  parent : Association to one Level2Entity;
}

entity AssocOne : cuid {
  name  : String;
  info : Association to one AssocTwo;
}

entity AssocTwo : cuid {
  name     : String;
  info     : Association to one AssocThree;
}

entity AssocThree : cuid {
  name : String;
}

entity RootObject : cuid {
  child : Composition of many Level1Object
            on child.parent = $self;
  title : String;
}

entity Level1Object : cuid {
  parent : Association to one RootObject;
  child  : Composition of many Level2Object
             on child.parent = $self;
  title  : String;
}

entity Level2Object : cuid {
  title  : String;
  parent : Association to one Level1Object;
  child  : Composition of many Level3Object
             on child.parent = $self;
}

entity Level3Object : cuid {
  parent : Association to one Level2Object;
  title  : String;
}

@fiori.draft.enabled
@title : '{i18n>bookStore.objectTitle}'
entity BookStores @(cds.autoexpose) : managed, cuid {
  @title : '{i18n>bookStore.name}'
  name            : String;

  @title : '{i18n>bookStore.location}'
  location        : String;

  lifecycleStatus : LifecycleStatusCode;

  @title : '{i18n>bookStore.city}'
  city            : Association to one City;

  @title : '{i18n>bookStore.books}'
  books           : Composition of many Books
                      on books.bookStore = $self;

  @title : '{i18n>bookStore.registry}'
  registry        : Composition of one BookStoreRegistry;

  @title : '{i18n>bookStore.bookInventory}'
  bookInventory   : Composition of many {
    key ID    : UUID;
    @changelog
    title     : String;
  }
}

@fiori.draft.enabled
@title : '{i18n>books.objectTitle}'
entity Books : managed, cuid {
  @title :                                  '{i18n>books.title}'
  title     : localized String(111);
  @title :                                  '{i18n>books.descr}'
  descr     : localized String(1111);
  bookStore : Association to one BookStores;
  author    : Association to one Authors;
  @title :                                  '{i18n>books.genre}'
  genre     : Association to Genres;
  stock     : Integer;
  price     : Decimal(11, 4);
  isUsed    : Boolean;
  image     : LargeBinary @Core.MediaType : 'image/png';
  @title :                                  '{i18n>books.bookType}'
  bookType  : BookTypeCodes;
  volumns   : Composition of many Volumns
                on volumns.book = $self;
}

@title : '{i18n>authors.objectTitle}'
entity Authors : managed, cuid {
  @title : '{i18n>authors.name}'
  name         : PersonName;
  dateOfBirth  : Date;
  dateOfDeath  : Date;
  @title : '{i18n>authors.placeOfBirth}'
  placeOfBirth : String;
  placeOfDeath : String;
  books        : Association to many Books on books.author = $self;
}

@title                  : '{i18n>volumns.objectTitle}'
@changelog : [title]
entity Volumns : managed, cuid {
  @changelog
  @title : '{i18n>volumns.title}'
  title    : String;

  @changelog
  @title : '{i18n>volumns.sequence}'
  sequence : Integer;
  book     : Association to one Books;
  @title : '{i18n>Status}'
  @changelog : [ActivationStatus.name]
  ActivationStatus : Association to one ActivationStatusCode;
  PaymentAgreementStatus : Association to one PaymentAgreementStatusCodes on PaymentAgreementStatus.code = ActivationStatus.code;
}

@title                  : '{i18n>bookStoreRegistry.objectTitle}'
@changelog : [code]
entity BookStoreRegistry : managed, cuid {
  @title : '{i18n>bookStoreRegistry.code}'
  code      : String;

  @changelog
  @title : '{i18n>bookStoreRegistry.validOn}'
  validOn   : Date;
}

/**
 * Hierarchically organized Code List for Genres
 */
entity Genres : sap.common.CodeList {
  key ID       : Integer;
      parent   : Association to Genres;
      children : Composition of many Genres
                   on children.parent = $self;
}

entity Report : cuid {
  orders  : Association to many Order
              on orders.report = $self;
  comment : String;
}

entity Order : cuid {
  @title     : '{i18n>title}'
  @changelog
  title      : String;
  type       : Association to one OrderType;
  report     : Association to one Report;
  header     : Composition of one OrderHeader;
  orderItems : Composition of many OrderItem
                 on orderItems.order = $self;
  netAmount  : Decimal(19, 2);
  isUsed     : Boolean;
  status     : String;
  Items      : Composition of many {
    key ID   : UUID;
    @changelog
    quantity : Integer;
  }
}

entity OrderType : cuid {
  @title: '{i18n>title}'
  @changelog
  title : String;
}

entity Customers : cuid {
  name       : String;
  city       : String;
  country    : String;
  age        : Integer;
  orderItems : Association to many OrderItem
                 on orderItems.customer = $self;
}

// do not change-track personal data
annotate Customers with {
  name @PersonalData.IsPotentiallyPersonal;
  name @changelog 
};


entity OrderHeader : cuid {
  status : String;
}

entity OrderItem : cuid {
  order    : Association to one Order;
  customer : Association to one Customers;
  notes    : Composition of many OrderItemNote
               on notes.orderItem = $self;
  quantity : Decimal(19, 2);
  price    : Decimal(19, 2);
}

entity OrderItemNote : cuid {
  orderItem : Association to one OrderItem;
  content   : String;
  @title : '{i18n>Status}'
  ActivationStatus : Association to one ActivationStatusCode;
  PaymentAgreementStatus : Association to one PaymentAgreementStatusCodes on PaymentAgreementStatus.code = ActivationStatus.code;
}

entity City : cuid {
  name    : String;
  country : Association to one Country;
}

entity Country : cuid {
  countryName : CountryName;
}

entity FirstEntity : managed, cuid {
  name : String;
  children : Association to one Children;
}

entity SecondEntity : managed, cuid {
  name : String;
  children : Association to one Children;
}

@changelog : [one_ID]
entity Children : managed {
  @changelog
  key one : Association to one FirstEntity;
  @changelog
  key two : Association to one SecondEntity;
}

// Test for Unmanaged entity
entity Schools : managed, cuid {
  @title: '{i18n>Schools.name}'
  name      : String;
  location  : String;
  classes   : Composition of many {
    key ID  : UUID;
    @title: '{i18n>Classes.name}'
    name    : String;
    @title: '{i18n>Classes.teacher}'
    teacher : String;
  };
}

// Test for key which include special character: '/' -- draft enabled
@title: 'Root Sample Draft'
entity RootSampleDraft @(cds.autoexpose) : managed {
  key ID    : String;
      child : Composition of many Level1SampleDraft
                on child.parent = $self;
      title : String;
}

@title: 'Level1 Sample Draft'
entity Level1SampleDraft : managed {
  key ID     : String;
      parent : Association to one RootSampleDraft;
      child  : Composition of many Level2SampleDraft
                 on child.parent = $self;
      title  : String;
}

entity Level2SampleDraft : managed {
  key ID     : String;
      title  : String;
      parent : Association to one Level1SampleDraft;
}

// Test for key which include special character: '/' -- draft disabled
entity RootSample : managed {
  key ID    : String;
      child : Composition of many Level1Sample
                on child.parent = $self;
      title : String;
}

entity Level1Sample : managed {
  key ID     : String;
      parent : Association to one RootSample;
      child  : Composition of many Level2Sample
                 on child.parent = $self;
      title  : String;
}

entity Level2Sample : managed {
  key ID     : String;
      title  : String;
      parent : Association to one Level1Sample;
}
