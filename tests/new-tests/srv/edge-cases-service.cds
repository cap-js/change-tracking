using { test.edge } from '../db/edge-cases';

service EdgeCasesTestService {
    entity Customers as projection on edge.Customers;
    entity Items as projection on edge.Items;
    entity Products as projection on edge.Products;
    entity Categories as projection on edge.Categories;
}
