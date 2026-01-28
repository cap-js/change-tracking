using { sap.capire.bookshop.test.config as my } from '../db/test-config';

service ConfigTestService {
    entity Records as projection on my.Records;
}

annotate ConfigTestService.Records with @changelog: [name];
