namespace test.composition;

using { cuid } from '@sap/cds/common';

// Root with composition of many
@changelog: [name]
entity Stores : cuid {
    name  : String @changelog;
    books : Composition of many Books on books.store = $self
            @changelog: [books.title];
}

@changelog: [title]
entity Books : cuid {
    title : String @changelog;
    stock : Integer @changelog;
    store : Association to Stores;
}

// Composition of one
@changelog: [name]
entity Orders : cuid {
    name   : String @changelog;
    header : Composition of OrderHeaders
             @changelog: [header.status];
}

@changelog: [status]
entity OrderHeaders : cuid {
    status : String @changelog;
    note   : String @changelog;
}

// Deep composition (3 levels)
@changelog: [name]
entity Root : cuid {
    name   : String @changelog;
    level1 : Composition of many Level1 on level1.root = $self
             @changelog: [level1.title];
}

@changelog: [title]
entity Level1 : cuid {
    title  : String @changelog;
    root   : Association to Root;
    level2 : Composition of many Level2 on level2.level1 = $self
             @changelog: [level2.title];
}

@changelog: [title]
entity Level2 : cuid {
    title  : String @changelog;
    level1 : Association to Level1;
    level3 : Composition of many Level3 on level3.level2 = $self
             @changelog: [level3.title];
}

@changelog: [title]
entity Level3 : cuid {
    title  : String @changelog;
    value  : Integer @changelog;
    level2 : Association to Level2;
}

// Inline entity composition
@changelog: [name]
entity Warehouses : cuid {
    name      : String @changelog;
    inventory : Composition of many {
        key ID   : UUID;
        @changelog
        item     : String;
        @changelog
        quantity : Integer;
    };
}
