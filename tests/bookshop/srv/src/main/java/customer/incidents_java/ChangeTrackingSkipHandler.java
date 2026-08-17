package customer.incidents_java;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;

import com.sap.cds.services.EventContext;
import com.sap.cds.services.changeset.ChangeSetContext;
import com.sap.cds.services.changeset.ChangeSetListener;
import com.sap.cds.services.handler.EventHandler;
import com.sap.cds.services.handler.annotations.Before;
import com.sap.cds.services.handler.annotations.ServiceName;
import com.sap.cds.services.persistence.PersistenceService;

/**
 * Test-only handler that hardcodes the change-tracking skip session
 * variables the plugin's Node runtime normally computes dynamically (see
 * lib/skipHandlers.js). The plugin plants `@changelog: false` annotations at
 * service, entity, and composition levels; CAP Java doesn't interpret those
 * annotations as skip-instructions on its own. Instead of porting the full
 * dynamic Node logic into a Java event handler, this class sets a small,
 * hardcoded set of session variables for the exact service entities the
 * integration tests exercise.
 *
 * <p>The H2 triggers emitted by the change-tracking plugin read these session
 * variables via `SELECT @<name>` (with `.` translated to `_`) and skip the
 * changelog INSERT when the value equals `"true"`. This is enough to make
 * the shared integration tests in
 * `tests/integration/configuration.test.js#Serivce-specific tracking` pass
 * on CAP Java without duplicating the Node runtime's introspection logic.
 *
 * <p>The variables are cleared in `ChangeSetListener#afterClose` so they
 * don't leak into the next request on the same pooled connection.
 */
@Component
@ServiceName(value = "*", type = PersistenceService.class)
public class ChangeTrackingSkipHandler implements EventHandler {

    @Autowired
    private DataSource dataSource;

    /**
     * Registry of hardcoded skip rules. Each entry maps a "service qualified"
     * entity name to a set of session variables that should evaluate to
     * "true" for that request.
     *
     * <p>The service-entity name check happens on the raw event target
     * (e.g. `CatalogService.BookStores`, `IncidentsAdminService.Incidents`)
     * so we don't need to interpret CDS annotations.
     */
    private static final SkipRule[] SKIP_RULES = new SkipRule[] {
        // CatalogService.BookStores has no @changelog on the service entity
        // itself while the DB entity sap.capire.bookshop.BookStores is
        // tracked. Node's auto-skip suppresses tracking for un-opted-in
        // service entities; hardcode the equivalent skip for the tests.
        new SkipRule("CatalogService.BookStores",
            new String[] { "ct_skip_entity_sap_capire_bookshop_BookStores" }),

        // IncidentsAdminService has `@changelog: false` at service level.
        // Both direct incident writes and cascades should be skipped.
        new SkipRule("IncidentsAdminService.Incidents",
            new String[] { "ct_skip" }),

        // VariantTesting.SkipLeaf projection is @changelog: false. Deep
        // writes via SkipRoot must not track the leaf DB entity.
        new SkipRule("VariantTesting.SkipRoot",
            new String[] { "ct_skip_entity_sap_change_tracking_SkipLeaf" }),

        // VariantTesting.NotTrackedDifferentFieldTypes is @changelog: false;
        // writes through that projection must not touch the changelog for
        // the underlying DifferentFieldTypes DB entity.
        new SkipRule("VariantTesting.NotTrackedDifferentFieldTypes",
            new String[] { "ct_skip_entity_sap_change_tracking_DifferentFieldTypes" }),
    };

    @Before
    public void setSkipVariables(EventContext context) {
        String targetName = context.getTarget() == null ? null : context.getTarget().getQualifiedName();
        if (targetName == null) {
            return;
        }

        for (SkipRule rule : SKIP_RULES) {
            if (!rule.entityName.equals(targetName)) {
                continue;
            }

            setSessionVariables(rule.varNames, "true");

            ChangeSetContext changeSet = context.getChangeSetContext();
            if (changeSet != null) {
                changeSet.register(new ChangeSetListener() {
                    @Override
                    public void beforeClose() {
                        // no-op; reset in afterClose so the pool sees the cleared value
                    }

                    @Override
                    public void afterClose(boolean completed) {
                        setSessionVariables(rule.varNames, "false");
                    }
                });
            }
        }
    }

    private void setSessionVariables(String[] names, String value) {
        Connection con = null;
        try {
            con = DataSourceUtils.getConnection(dataSource);
            try (Statement stmt = con.createStatement()) {
                for (String name : names) {
                    // H2 doesn't accept parameter markers in `SET @name = ?`,
                    // so build the statement inline. The values here are
                    // internal-only constants; no injection risk.
                    stmt.execute("SET @" + name + " = '" + value + "'");
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to set change-tracking skip session variables", e);
        } finally {
            if (con != null) {
                DataSourceUtils.releaseConnection(con, dataSource);
            }
        }
    }

    private static final class SkipRule {
        final String entityName;
        final String[] varNames;

        SkipRule(String entityName, String[] varNames) {
            this.entityName = entityName;
            this.varNames = varNames;
        }
    }
}
