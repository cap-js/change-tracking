using {sap.capire.bookshop as persistence} from '../db/schema';

service AdminDraftService @(path: 'admin-draft', impl: './admin.js') {
    @odata.draft.enabled
    entity Books as projection on persistence.Books actions {
        action createChildren();
        action updateChildren();
        action deleteChildren();
    };
}

service AdminService @(path: 'admin', impl: './admin.js') {
    entity Books as projection on persistence.Books actions {
        action createChildren();
        action updateChildren();
        action deleteChildren();
    };

    action setupMockData() returns {bookID: String};
}