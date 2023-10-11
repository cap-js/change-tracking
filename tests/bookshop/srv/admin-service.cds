using {sap.capire.bookshop as my} from '../db/schema';

@path: '/admin'
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

annotate AdminService.BookStores with @changelog.keys : [name]{
  name            @changelog;
  location        @changelog;
  books           @changelog                              : [books.title];
  lifecycleStatus @changelog                              : [lifecycleStatus.name];
  city            @changelog                              : [
    city.name,
    city.country.countryName.code
  ]
};


annotate AdminService.Books with @changelog.keys : [
  title,
  author.name.firstName,
  author.name.lastName
]{
  title    @changelog;
  descr    @changelog;
  author   @changelog                                : [
    author.name.firstName,
    author.name.lastName
  ];
  genre    @changelog;
  bookType @changelog                                : [
    bookType.name,
    bookType.descr
  ];
};

annotate AdminService.Authors with @changelog.keys : [
  name.firstName,
  name.lastName
]{
  name         @changelog;
  placeOfBirth @changelog;
  books        @changelog                              : [
    books.name,
    books.title
  ];
};

annotate AdminService.Order with {
  header @changelog;
}

annotate AdminService.OrderHeader with {
  status @changelog;
}

annotate AdminService.OrderItem with {
  quantity @changelog;
  customer @changelog : [
    customer.country,
    customer.name,
    customer.city,
  ];
  order    @changelog : [
    order.report.comment,
    order.status
  ];
}

annotate AdminService.OrderItemNote with {
  content @changelog;
}

annotate AdminService.Customers with {
  name    @changelog;
  city    @changelog;
  country @changelog;
  age     @changelog;
}
