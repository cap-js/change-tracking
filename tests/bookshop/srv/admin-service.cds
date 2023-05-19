using {sap.capire.bookshop as my} from '../db/schema';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;

  entity Authors                      as projection on my.Authors;
  entity Report                       as projection on my.Report;
  entity Order                        as projection on my.Order;
  entity OrderItem                    as projection on my.OrderItem;
  entity OrderItemNote                as projection on my.OrderItemNote;
  entity Volumns                      as projection on my.Volumns;
  entity Customers                    as projection on my.Customers;
}

annotate AdminService.Authors with {
  name @(Common.Label : '{i18n>serviceAuthors.name}');
};

annotate AdminService.BookStores with @changehistory.objectID : [name]{
  name            @changehistory;
  location        @changehistory;
  books           @changehistory                              : [books.title];
  lifecycleStatus @changehistory                              : [lifecycleStatus.name];
  city            @changehistory                              : [
    city.name,
    city.country.countryName.code
  ]
};


annotate AdminService.Books with @changehistory.objectID : [
  title,
  author.name.firstName,
  author.name.lastName
]{
  title    @changehistory;
  descr    @changehistory;
  author   @changehistory                                : [
    author.name.firstName,
    author.name.lastName
  ];
  genre    @changehistory;
  bookType @changehistory                                : [
    bookType.name,
    bookType.descr
  ];
};

annotate AdminService.Authors with @changehistory.objectID : [
  name.firstName,
  name.lastName
]{
  name         @changehistory;
  placeOfBirth @changehistory;
  books        @changehistory                              : [
    books.name,
    books.title
  ];
};

annotate AdminService.Order with {
  header @changehistory;
}

annotate AdminService.OrderHeader with {
  status @changehistory;
}

annotate AdminService.OrderItem with {
  quantity @changehistory;
  customer @changehistory : [
    customer.country,
    customer.name,
    customer.city,
  ];
  order    @changehistory : [
    order.report.comment,
    order.status
  ];
}

annotate AdminService.OrderItemNote with {
  content @changehistory;
}

annotate AdminService.Customers with {
  name    @changehistory;
  city    @changehistory;
  country @changehistory;
  age     @changehistory;
}
