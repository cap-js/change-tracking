using {sap.capire.bookshop as bookshop} from '../db/schema.cds';
using {sap.change_tracking as change_tracking} from '../db/index.cds';

annotate change_tracking.DifferentFieldTypes with @(changelog: [title]) {
  dateTime  @changelog;
  timestamp @changelog;
  number    @changelog;
  bool      @changelog;
  dppField1 @changelog;
  dppField2 @changelog;
  // Ignored changelog annotations due to data type
  image @changelog;
  icon @changelog;
}

annotate change_tracking.DifferentFieldTypesChildren with {
  double @changelog;
}

annotate change_tracking.RootSample with @(changelog: [
  ID,
  title
]) {
  title @changelog;
}

annotate change_tracking.Level1Sample with @(changelog: [
  ID,
  title,
  parent.ID
]) {
  title @changelog;
}

annotate change_tracking.Level2Sample with @(changelog: [
  ID,
  title,
  parent.parent.ID
]) {
  title @changelog;
}

annotate change_tracking.TrackingComposition with {
  children @changelog: [children.title];
}

annotate change_tracking.ComposedEntities with {
  title @changelog;
  price @changelog;
}

annotate bookshop.Books with {
  authorWithAssocObjectID @changelog: [
    authorWithAssocObjectID.name.firstName,
    authorWithAssocObjectID.dateOfBirth,
    authorWithAssocObjectID.name.lastName
  ];
}

annotate bookshop.OrderItem with {
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

annotate bookshop.OrderItemWithLongerName with @(
  changelog  : [
    customer.city,
    order.status,
    price,
    quantity
  ],
  title      : 'Order Item with longer name',
  UI.LineItem: [{Value: quantity}]
) {
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
  price    @changelog: [
    customer.country,
    price,
    customer.name
  ]
}

annotate bookshop.Authors with @changelog: [
  name.firstName,
  name.lastName
] {
  name         @changelog;
  placeOfBirth @changelog;
  books        @changelog                : [
    books.name,
    books.title
  ];
};

annotate bookshop.AuthorsWithLongerChangelog with @(changelog: [
  placeOfBirth,
  name.firstName,
  name.lastName,
  placeOfDeath,
  dateOfDeath,
  dateOfBirth
]) {
  name         @changelog;
  placeOfBirth @changelog;
};
