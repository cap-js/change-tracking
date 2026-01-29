namespace test.edge;

using { cuid } from '@sap/cds/common';

// Personal data - should NOT be tracked
entity Customers : cuid {
    name : String @PersonalData.IsPotentiallyPersonal @changelog;
    city : String @changelog;
}

// Special characters in keys
entity Items {
    key ID   : String;
    title    : String @changelog;
    category : String @changelog;
}

// Localized values
entity Products : cuid {
    title    : localized String @changelog;
    descr    : localized String @changelog;
    category : Association to Categories;
}

// Association to many (should NOT track the association itself)
entity Categories : cuid {
    name     : String @changelog;
    products : Association to many Products on products.category = $self;
}
