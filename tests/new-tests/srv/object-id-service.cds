using { test.objectid } from '../db/object-id';

service ObjectIdTestService {
    entity Stores as projection on objectid.Stores;
    entity Books as projection on objectid.Books;
    entity Authors as projection on objectid.Authors;
    entity Status as projection on objectid.Status;
    entity Projects as projection on objectid.Projects;
    entity Level1Items as projection on objectid.Level1Items;
    entity Level2Items as projection on objectid.Level2Items;
    entity Level3Items as projection on objectid.Level3Items;
    entity Parents as projection on objectid.Parents;
    entity Children as projection on objectid.Children;
}
