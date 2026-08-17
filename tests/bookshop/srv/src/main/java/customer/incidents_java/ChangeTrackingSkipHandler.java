package customer.incidents_java;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;

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

/** Test-only hardcoded skip rules for H2 change-tracking triggers. */
@Component
@ServiceName(value = "*", type = PersistenceService.class)
public class ChangeTrackingSkipHandler implements EventHandler {

    @Autowired
    private DataSource dataSource;

    private static final Map<String, String[]> SKIP_VARIABLES = Map.of(
        "CatalogService.BookStores", new String[] { "ct_skip_entity_sap_capire_bookshop_BookStores" },
        "IncidentsAdminService.Incidents", new String[] { "ct_skip" },
        "VariantTesting.SkipRoot", new String[] { "ct_skip_entity_sap_change_tracking_SkipLeaf" },
        "VariantTesting.NotTrackedDifferentFieldTypes",
        new String[] { "ct_skip_entity_sap_change_tracking_DifferentFieldTypes" });

    @Before
    public void setSkipVariables(EventContext context) {
        String targetName = context.getTarget() == null ? null : context.getTarget().getQualifiedName();
        if (targetName == null) {
            return;
        }

        String[] variableNames = SKIP_VARIABLES.get(targetName);
        if (variableNames == null) {
            return;
        }

        setSessionVariables(variableNames, "true");

        ChangeSetContext changeSet = context.getChangeSetContext();
        if (changeSet != null) {
            changeSet.register(new ChangeSetListener() {
                @Override
                public void beforeClose() {
                }

                @Override
                public void afterClose(boolean completed) {
                    setSessionVariables(variableNames, "false");
                }
            });
        }
    }

    private void setSessionVariables(String[] names, String value) {
        Connection con = null;
        try {
            con = DataSourceUtils.getConnection(dataSource);
            try (Statement stmt = con.createStatement()) {
                for (String name : names) {
                    // H2 does not allow parameter markers for session variable names.
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

}
