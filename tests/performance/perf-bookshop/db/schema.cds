using {
    cuid
} from '@sap/cds/common';

namespace sap.capire.bookshop;

@changelog: [name]
entity Books : cuid {
    name: String @changelog;
    chapters : Composition of many Chapters on chapters.book = $self @changelog;
}

@changelog : [name]
entity Chapters : cuid {
    book : Association to one Books;
    number: Integer @changelog;
    name: String @changelog;
}

