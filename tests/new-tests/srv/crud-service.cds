using { test.crud } from '../db/crud';

service CrudTestService {
    entity Items as projection on crud.Items;
    entity Events as projection on crud.Events;
}
