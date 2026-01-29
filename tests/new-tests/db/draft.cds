namespace test.draft;

using { cuid, managed } from '@sap/cds/common';

@changelog: [name]
entity Orders : cuid, managed {
    name   : String @changelog;
    amount : Integer @changelog;
    items  : Composition of many OrderItems on items.order = $self
             @changelog: [items.product];
}

@changelog: [product]
entity OrderItems : cuid {
    product  : String @changelog;
    quantity : Integer @changelog;
    price    : Decimal(10,2) @changelog;
    isActive : Boolean @changelog;
    order    : Association to Orders;
}
