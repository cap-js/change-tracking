using {sap.capire.bookshop as db} from './schema';

annotate db.Books with @changelog: [
  title,
  author.name.firstName,
  author.name.lastName
] {
  title    @changelog;
  descr    @changelog;
  isUsed   @changelog;
  author   @changelog            : [
    author.name.firstName,
    author.name.lastName
  ];
  genre    @changelog;
  bookType @changelog            : [
    bookType.name,
    bookType.descr
  ];
};

annotate db.Authors with @changelog: [
  name.firstName,
  name.lastName
] {
  name         @changelog;
  placeOfBirth @changelog;
  books        @changelog          : [books.title];
};

annotate db.Order with {
  header    @changelog;
  netAmount @changelog;
  isUsed    @changelog;
}

annotate db.BookStores with @changelog: [name, city.name] {
  name            @changelog;
  location        @changelog;
  books           @changelog          : [books.title];
  lifecycleStatus @changelog          : [lifecycleStatus.name];
  city            @changelog          : [
    city.name,
    city.country.countryName.code
  ]
};

annotate db.BookStoreRegistry with @changelog: [code, validOn];


annotate db.RootEntity with @changelog: [name] {
  name            @changelog;
  child           @changelog          : [child.child.child.title];
  lifecycleStatus @changelog          : [lifecycleStatus.name];
  info            @changelog          : [info.info.info.name];
  dateTime        @changelog;
  timestamp      @changelog;
};

annotate db.Level1Entity with @changelog: [parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                      : [child.title];
};

annotate db.Level2Entity with @changelog: [parent.parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                      : [child.title];
};

annotate db.Level3Entity with @changelog: [parent.parent.parent.lifecycleStatus.name] {
  title @changelog;
}

annotate db.AssocOne with {
  name @changelog;
  info @changelog: [info.info.name]
};

annotate db.AssocTwo with {
  name @changelog;
  info @changelog: [info.name]
};

annotate db.AssocThree with {
  name @changelog;
};

annotate db.RootObject with {
  title @changelog;
}

annotate db.Level1Object with {
  title @changelog;
  child @changelog: [child.title];
}

annotate db.Level2Object with {
  title @changelog;
  child @changelog: [child.title];
};

annotate db.Level3Object with {
  title  @changelog;
  parent @changelog: [parent.parent.parent.title]
};

annotate db.Authors with {
  name @(Common.Label: '{i18n>serviceAuthors.name}');
};


annotate db.OrderHeader with {
  status @changelog;
}

annotate db.OrderItem with {
  quantity @changelog;
  customer @changelog: [
    customer.country,
    customer.name,
    customer.city,
  ];
  order    @changelog: [
    order.report.comment,
    order.status
  ];
}

annotate db.OrderItemNote with {
  content          @changelog;
  ActivationStatus @changelog: [ActivationStatus.name];
}

annotate db.Customers with {
  name    @changelog;
  city    @changelog;
  country @changelog;
  age     @changelog;
}

annotate db.Schools with {
  classes @changelog: [
    classes.name,
    classes.teacher
  ]
};

annotate db.RootSampleDraft with @changelog: [
  ID,
  title
] {
  title  @changelog  @title: 'Root Draft Title';
}

annotate db.Level1SampleDraft with @changelog: [
  ID,
  title,
  parent.ID
] {
  title  @changelog  @title: 'Level1 Draft Title';
}

annotate db.Level2SampleDraft with @changelog: [
  ID,
  title,
  parent.parent.ID
] {
  title  @changelog  @title: 'Level2 Draft Title';
};

annotate db.RootSample with @changelog: [
  ID,
  title
] {
  title  @changelog  @title: 'Root Sample Title';
}

annotate db.Level1Sample with @changelog: [
  ID,
  title,
  parent.ID
] {
  title  @changelog  @title: 'Level1 Sample Title';
}

annotate db.Level2Sample with @changelog: [
  ID,
  title,
  parent.parent.ID
] {
  title  @changelog  @title: 'Level2 Sample Title';
};
