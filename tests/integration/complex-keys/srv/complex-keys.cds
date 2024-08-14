namespace complexkeys;

using {cuid} from '@sap/cds/common';


context db {
    
    @changelog: [name]
    entity Root: cuid {
        @changelog
        name: cds.String;
        @changelog: [links.linked.name]
        links: Composition of many Link on links.root = $self
    }

    entity Link {
        key root: Association to one Root;
        key linked: Association to one Linked;
    }

    entity Linked: cuid {
        name: cds.String;
    }
}


service ComplexKeys {
    @odata.draft.enabled
    entity Root as projection on db.Root;
    entity Link as projection on db.Link;
    entity Linked as projection on db.Linked;
}