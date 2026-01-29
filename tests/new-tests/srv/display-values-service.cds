using { test.display } from '../db/display-values';

service DisplayValuesTestService {
    entity Books as projection on display.Books;
    entity Authors as projection on display.Authors;
    entity Orders as projection on display.Orders;
    entity Customers as projection on display.Customers;
}
