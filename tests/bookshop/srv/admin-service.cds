using {sap.capire.bookshop as my} from '../db/schema';
using {sap.changelog as change} from '@cap-js/change-tracking';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;

  entity ChangeView as projection on change.ChangeView;

  entity Authors                      as projection on my.Authors;
  entity Report                       as projection on my.Report;
  entity Order                        as projection on my.Order;
  entity Order.Items                  as projection on my.Order.Items;
  entity OrderItem                    as projection on my.OrderItem;

  entity OrderItemWithLongerName as projection on my.OrderItemWithLongerName;
  entity AuthorsWithLongerChangelog as projection on my.AuthorsWithLongerChangelog;

  entity OrderItemNote                as projection on my.OrderItemNote
    actions {
      @Common.SideEffects             : {TargetEntities: [in]}
      action activate(ID: String);
    };

  entity Volumes                      as projection on my.Volumes
    actions {
      @Common.SideEffects             : {TargetEntities: [in]}
      action activate();
    };

  entity Customers                    as projection on my.Customers;
}

annotate AdminService.Authors with {
  name @(Common.Label: '{i18n>serviceAuthors.name}');
};

annotate AdminService.BookStores with @changelog: [name] {
  name            @changelog;
  location        @changelog;
  books           @changelog                    : [books.title];
  lifecycleStatus @changelog                    : [lifecycleStatus.name];
  city            @changelog                    : [
    city.name,
    city.country.countryName.code
  ]
};


annotate AdminService.Books with @changelog: [
  title,
  author.name.firstName,
  author.name.lastName
] {
  title    @changelog;
  descr    @changelog;
  isUsed   @changelog;
  author   @changelog                      : [
    author.name.firstName,
    author.name.lastName
  ];
  genre    @changelog;
  bookType @changelog                      : [
    bookType.name,
    bookType.descr
  ];
};

annotate AdminService.Order with {
  header @changelog;
}

annotate AdminService.OrderHeader with {
  status @changelog;
}

annotate AdminService.OrderItemNote with {
  content          @changelog;
  ActivationStatus @changelog: [ActivationStatus.name];
}

annotate AdminService.Customers with {
  name    @changelog;
  city    @changelog: false;  // Explicitly skip tracking for this element
  country @changelog;
  age     @changelog;
}