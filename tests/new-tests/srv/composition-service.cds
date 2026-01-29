using { test.composition } from '../db/composition';

service CompositionTestService {
    entity Stores as projection on composition.Stores;
    entity Books as projection on composition.Books;
    entity Orders as projection on composition.Orders;
    entity OrderHeaders as projection on composition.OrderHeaders;
    entity Root as projection on composition.Root;
    entity Level1 as projection on composition.Level1;
    entity Level2 as projection on composition.Level2;
    entity Level3 as projection on composition.Level3;
    entity Warehouses as projection on composition.Warehouses;
}
