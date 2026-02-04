using {sap.capire.bookshop as my} from '../db/schema';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;
}

annotate AdminService.BookStores with @changelog: [name] {
  name            @changelog;
  location        @changelog;
  books           @changelog                    : [books.title];
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
  author   @changelog                      : [
    author.name.firstName,
    author.name.lastName
  ];
  genre    @changelog;
};