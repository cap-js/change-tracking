using {sap.capire.bookshop.test.crud as my} from '../db/test-crud';

service CrudTestService {
    entity Items    as projection on my.Items;
    entity Products as projection on my.Products;
    entity Events   as projection on my.Events;
}

// ObjectID annotations - use name field as human-readable ID
annotate CrudTestService.Items with @changelog: [name];
annotate CrudTestService.Products with @changelog: [title];
annotate CrudTestService.Events with @changelog: [name];
