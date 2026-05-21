CREATE OR REPLACE FUNCTION sap_capire_incidents_expressionscenarios_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.ExpressionScenarios';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_ExpressionScenarios', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := COALESCE((rec.firstName || ' ' || rec.lastName)::TEXT, entity_key);

            IF (TG_OP = 'INSERT') THEN
                
                INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                NULL,
                attribute,
                valueChangedFrom,
                valueChangedTo,
                valueChangedFromLabel,
                valueChangedToLabel,
                entity_name,
                entity_key,
                object_id,
                now(),
                user_id,
                valueDataType,
                'create',
                transaction_id
            FROM (
            SELECT 'firstName' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.firstName::TEXT) > 5000 THEN LEFT(NEW.firstName::TEXT, 4997) || '...' ELSE NEW.firstName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.firstName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.lastName::TEXT) > 5000 THEN LEFT(NEW.lastName::TEXT, 4997) || '...' ELSE NEW.lastName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.lastName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, NULL AS valueChangedFrom, NEW.price::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (case when NEW.price < 100 then 'Budget' else 'Premium' end)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.price IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, NULL AS valueChangedFrom, NEW.decimalProp::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (NEW.decimalProp * 2)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.decimalProp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, NULL AS valueChangedFrom, NEW.status_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (NEW.status_code || ': ' || (SELECT "$s".descr as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status_code LIMIT 1))::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.status_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                
                INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                NULL,
                attribute,
                valueChangedFrom,
                valueChangedTo,
                valueChangedFromLabel,
                valueChangedToLabel,
                entity_name,
                entity_key,
                object_id,
                now(),
                user_id,
                valueDataType,
                'update',
                transaction_id
            FROM (
            SELECT 'firstName' AS attribute, CASE WHEN LENGTH(OLD.firstName::TEXT) > 5000 THEN LEFT(OLD.firstName::TEXT, 4997) || '...' ELSE OLD.firstName::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.firstName::TEXT) > 5000 THEN LEFT(NEW.firstName::TEXT, 4997) || '...' ELSE NEW.firstName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.firstName IS DISTINCT FROM OLD.firstName) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, CASE WHEN LENGTH(OLD.lastName::TEXT) > 5000 THEN LEFT(OLD.lastName::TEXT, 4997) || '...' ELSE OLD.lastName::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.lastName::TEXT) > 5000 THEN LEFT(NEW.lastName::TEXT, 4997) || '...' ELSE NEW.lastName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.lastName IS DISTINCT FROM OLD.lastName) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, OLD.price::TEXT AS valueChangedFrom, NEW.price::TEXT AS valueChangedTo, (case when OLD.price < 100 then 'Budget' else 'Premium' end)::TEXT AS valueChangedFromLabel, (case when NEW.price < 100 then 'Budget' else 'Premium' end)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.price IS DISTINCT FROM OLD.price) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, OLD.decimalProp::TEXT AS valueChangedFrom, NEW.decimalProp::TEXT AS valueChangedTo, (OLD.decimalProp * 2)::TEXT AS valueChangedFromLabel, (NEW.decimalProp * 2)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.decimalProp IS DISTINCT FROM OLD.decimalProp) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, OLD.status_code::TEXT AS valueChangedFrom, NEW.status_code::TEXT AS valueChangedTo, (OLD.status_code || ': ' || (SELECT "$s".descr as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status_code LIMIT 1))::TEXT AS valueChangedFromLabel, (NEW.status_code || ': ' || (SELECT "$s".descr as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status_code LIMIT 1))::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.status_code IS DISTINCT FROM OLD.status_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.ExpressionScenarios' AND entitykey = OLD.ID::TEXT;
            INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                NULL,
                attribute,
                valueChangedFrom,
                valueChangedTo,
                valueChangedFromLabel,
                valueChangedToLabel,
                entity_name,
                entity_key,
                object_id,
                now(),
                user_id,
                valueDataType,
                'delete',
                transaction_id
            FROM (
            SELECT 'firstName' AS attribute, CASE WHEN LENGTH(OLD.firstName::TEXT) > 5000 THEN LEFT(OLD.firstName::TEXT, 4997) || '...' ELSE OLD.firstName::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.firstName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, CASE WHEN LENGTH(OLD.lastName::TEXT) > 5000 THEN LEFT(OLD.lastName::TEXT, 4997) || '...' ELSE OLD.lastName::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.lastName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, OLD.price::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (case when OLD.price < 100 then 'Budget' else 'Premium' end)::TEXT AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.price IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, OLD.decimalProp::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (OLD.decimalProp * 2)::TEXT AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.decimalProp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, OLD.status_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (OLD.status_code || ': ' || (SELECT "$s".descr as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status_code LIMIT 1))::TEXT AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.status_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_expressionscenarios_tr_change
    AFTER INSERT OR UPDATE OF firstname, lastname, price, decimalprop, status_code OR DELETE ON "sap_capire_incidents_expressionscenarios"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_expressionscenarios_func_change();
    
