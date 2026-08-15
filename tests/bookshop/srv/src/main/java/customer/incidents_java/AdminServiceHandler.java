package customer.incidents_java;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.sap.cds.ql.CQL;
import com.sap.cds.ql.Update;
import com.sap.cds.ql.cqn.AnalysisResult;
import com.sap.cds.ql.cqn.CqnAnalyzer;
import com.sap.cds.reflect.CdsModel;
import com.sap.cds.services.draft.DraftNewEventContext;
import com.sap.cds.services.draft.DraftService;
import com.sap.cds.services.handler.EventHandler;
import com.sap.cds.services.handler.annotations.On;
import com.sap.cds.services.handler.annotations.Before;
import com.sap.cds.services.handler.annotations.ServiceName;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.adminservice.AdminService_;
import cds.gen.adminservice.BookStores;
import cds.gen.adminservice.BookStores_;
import cds.gen.adminservice.OrderItemNote_;
import cds.gen.adminservice.OrderItemNoteActivateContext;

@Component
@ServiceName(AdminService_.CDS_NAME)
public class AdminServiceHandler implements EventHandler {

    @Autowired
    private PersistenceService db;

    @Autowired
    private CdsModel model;

    @Before(event = DraftService.EVENT_DRAFT_NEW, entity = BookStores_.CDS_NAME)
    public void defaultBookStoreLifecycleStatus(DraftNewEventContext context, BookStores draft) {
        if (draft.getLifecycleStatusCode() == null) {
            draft.setLifecycleStatusCode("IP");
        }
    }

    @On(event = "activate", entity = OrderItemNote_.CDS_NAME)
    public void activateOrderItemNote(OrderItemNoteActivateContext context) {
        String noteID = extractNoteId(context);
        if (noteID != null) {
            db.run(Update.entity("sap.capire.bookshop.OrderItemNote")
                .where(o -> CQL.get("ID").eq(noteID))
                .data("ActivationStatus_code", "VALID"));
        }

        String lvl2ID = context.getId();
        if (lvl2ID != null) {
            db.run(Update.entity("sap.change_tracking.Level2Sample")
                .where(o -> CQL.get("ID").eq(lvl2ID))
                .data("title", "Game Science"));
        }

        context.setCompleted();
    }

    private String extractNoteId(OrderItemNoteActivateContext context) {
        try {
            if (context.getCqn() == null) return null;
            CqnAnalyzer analyzer = CqnAnalyzer.create(model);
            AnalysisResult result = analyzer.analyze(context.getCqn().ref());
            Map<String, Object> keyValues = result.targetKeyValues();
            Object id = keyValues == null ? null : keyValues.get("ID");
            return id == null ? null : id.toString();
        } catch (Throwable ignore) {
            return null;
        }
    }
}
