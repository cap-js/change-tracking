using {sap.capire.bookshop as db} from './schema';

annotate db.Books with @changelog: [
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

annotate db.Authors with @changelog: [
    name.firstName,
    name.lastName
] {
    name         @changelog;
    placeOfBirth @changelog;
    books        @changelog        : [books.title];
};

annotate db.Order with {
    header    @changelog;
    netAmount @changelog;
    isUsed    @changelog;
}

annotate db.BookStores with @changelog: [name] {
    name            @changelog;
    location        @changelog;
    books           @changelog        : [books.title];
    lifecycleStatus @changelog        : [lifecycleStatus.name];
    city            @changelog        : [
        city.name,
        city.country.countryName.code
    ]
};
