using {sap.capire.bookshop as my} from '../db/schema';
using {sap.capire.bookshop.PaymentAgreementStatusCodes as PaymentAgreementStatusCodes} from '../db/codelists';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;

  entity Authors                      as projection on my.Authors;
  entity Report                       as projection on my.Report;
  entity Order                        as projection on my.Order;
  entity OrderItem                    as projection on my.OrderItem;
  
  entity OrderItemNote                as projection on my.OrderItemNote actions {
    @cds.odata.bindingparameter.name: 'self'
    @Common.SideEffects             : {TargetEntities: [self]}
    action activate();
  };

  entity Volumns                      as projection on my.Volumns actions {
    @cds.odata.bindingparameter.name: 'self'
    @Common.SideEffects             : {TargetEntities: [self]}
    action activate();
  };

  entity Customers                    as projection on my.Customers;
}

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
  isUsed   @changelog;
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
  ActivationStatus @changelog : [ActivationStatus.name];
}

annotate AdminService.Customers with {
  name    @changelog;
  city    @changelog;
  country @changelog;
  age     @changelog;
}
