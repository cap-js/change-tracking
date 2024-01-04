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

namespace sap.capire.bookshop;

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
  price     : Decimal;
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
  report     : Association to one Report;
  header     : Composition of one OrderHeader;
  orderItems : Composition of many OrderItem
                 on orderItems.order = $self;
  netAmount  : Decimal(19, 2);
  status     : String;
}

entity Customers : cuid {
  name       : String;
  city       : String;
  country    : String;
  age        : Integer;
  orderItems : Association to many OrderItem
                 on orderItems.customer = $self;
}

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
