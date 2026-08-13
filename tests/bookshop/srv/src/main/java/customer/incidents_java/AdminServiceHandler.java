package customer.incidents_java;

import org.springframework.stereotype.Component;

import com.sap.cds.services.draft.DraftNewEventContext;
import com.sap.cds.services.draft.DraftService;
import com.sap.cds.services.handler.EventHandler;
import com.sap.cds.services.handler.annotations.Before;
import com.sap.cds.services.handler.annotations.ServiceName;

import cds.gen.adminservice.AdminService_;
import cds.gen.adminservice.BookStores;
import cds.gen.adminservice.BookStores_;

/**
 * Mirrors the Node.js {@code srv.before('CREATE', 'BookStores.drafts')} handler
 * in {@code tests/bookshop/srv/admin-service.js}, which defaults
 * {@code lifecycleStatus_code} to {@code 'IP'} on draft creation.
 *
 * The shared integration tests (e.g. "displays human-readable code list name")
 * rely on this default being present regardless of runtime.
 */
@Component
@ServiceName(AdminService_.CDS_NAME)
public class AdminServiceHandler implements EventHandler {

    @Before(event = DraftService.EVENT_DRAFT_NEW, entity = BookStores_.CDS_NAME)
    public void defaultBookStoreLifecycleStatus(DraftNewEventContext context, BookStores draft) {
        if (draft.getLifecycleStatusCode() == null) {
            draft.setLifecycleStatusCode("IP");
        }
    }
}
