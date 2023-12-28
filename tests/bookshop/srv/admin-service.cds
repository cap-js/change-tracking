using {sap.capire.bookshop as my} from '../db/schema';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;

  @odata.draft.enabled
  entity RootEntity @(cds.autoexpose) as projection on my.RootEntity;

  entity RootOrder                    as projection on my.RootOrder;
  entity Level1Order                  as projection on my.Level1Order;
  entity Level2Order                  as projection on my.Level2Order;
  entity Level3Order                  as projection on my.Level3Order;
  entity Level1Entity                 as projection on my.Level1Entity;
  entity Level2Entity                 as projection on my.Level2Entity;
  entity Level3Entity                 as projection on my.Level3Entity;
  entity Lock                         as projection on my.Lock;
  entity Door                         as projection on my.Door;
  entity Room                         as projection on my.Room;
  entity Authors                      as projection on my.Authors;
  entity Report                       as projection on my.Report;
  entity Order                        as projection on my.Order;
  entity OrderItem                    as projection on my.OrderItem;
  entity OrderItemNote                as projection on my.OrderItemNote;
  entity Volumns                      as projection on my.Volumns;
  entity Customers                    as projection on my.Customers;
}

annotate AdminService.RootEntity with @changelog: [name] {
  name            @changelog;
  child           @changelog                    : [child.child.child.title];
  lifecycleStatus @changelog                    : [lifecycleStatus.name];
  goods           @changelog                    : [goods.goods.goods.name]
};

annotate AdminService.Level1Entity with @changelog: [parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                                : [child.title];
};

annotate AdminService.Level2Entity with @changelog: [parent.parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                                : [child.title];
};

annotate AdminService.Level3Entity with @changelog: [parent.parent.parent.lifecycleStatus.name] {
  title @changelog;
}

annotate AdminService.Lock with {
  name  @changelog;
  goods @changelog: [goods.goods.name]
};

annotate AdminService.Door with {
  name  @changelog;
  goods @changelog: [goods.name]
};

annotate AdminService.Room with {
  name @changelog;
};

annotate AdminService.RootOrder with {
  title @changelog;
}

annotate AdminService.Level1Order with {
  title @changelog;
  child @changelog: [child.title];
}

annotate AdminService.Level2Order with {
  title @changelog;
  child @changelog: [child.title];
};

annotate AdminService.Level3Order with {
  title  @changelog;
  parent @changelog: [parent.parent.parent.title]
};

annotate AdminService.Authors with {
  name @(Common.Label : '{i18n>serviceAuthors.name}');
};

annotate AdminService.BookStores with @changelog : [name]{
  name            @changelog;
  location        @changelog;
  books           @changelog                              : [books.title];
  lifecycleStatus @changelog                              : [lifecycleStatus.name];
  city            @changelog                              : [
    city.name,
    city.country.countryName.code
  ]
};


annotate AdminService.Books with @changelog : [
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

annotate AdminService.Authors with @changelog : [
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
