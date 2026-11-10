using from '../../../index.cds';

namespace my;

entity Books {
  key ID    : UUID;
      title : String @changelog;
}

entity MyView(param1 : String, param2 : String) {
  key ID : UUID;
}

service MyService {
  entity Books as projection on my.Books;

  entity MyExposedView(param1 : String, param2 : String) as
    projection on my.MyView (
      param1 : :param1,
      param2 : :param2
    );
}
