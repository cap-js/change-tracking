using AdminService from '../../srv/admin-service';
using {sap.capire.bookshop as my} from '../../db/schema';

annotate AdminService.Books with {
    stock @changelog;
}

extend my.Books with {
    isbn : String @changelog;
}
