using { test.draft } from '../db/draft';

service DraftTestService {
    @odata.draft.enabled
    entity Orders as projection on draft.Orders;
}
