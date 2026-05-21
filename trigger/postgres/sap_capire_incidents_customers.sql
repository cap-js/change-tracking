CREATE OR REPLACE FUNCTION sap_capire_incidents_customers_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.Customers';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_Customers', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := COALESCE((SELECT "$c".firstName || ' ' || "$c".lastName as name FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = rec.ID LIMIT 1)::TEXT, entity_key);

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
            SELECT 'firstName' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.firstName::TEXT) > 5000 THEN LEFT(NEW.firstName::TEXT, 4997) || '...' ELSE NEW.firstName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.firstName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.lastName::TEXT) > 5000 THEN LEFT(NEW.lastName::TEXT, 4997) || '...' ELSE NEW.lastName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.lastName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'email' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.email::TEXT) > 5000 THEN LEFT(NEW.email::TEXT, 4997) || '...' ELSE NEW.email::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.email IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.email', true), 'false') != 'true'
            UNION ALL
            SELECT 'phone' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.phone::TEXT) > 5000 THEN LEFT(NEW.phone::TEXT, 4997) || '...' ELSE NEW.phone::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.phone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.phone', true), 'false') != 'true'
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
            SELECT 'firstName' AS attribute, CASE WHEN LENGTH(OLD.firstName::TEXT) > 5000 THEN LEFT(OLD.firstName::TEXT, 4997) || '...' ELSE OLD.firstName::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.firstName::TEXT) > 5000 THEN LEFT(NEW.firstName::TEXT, 4997) || '...' ELSE NEW.firstName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.firstName IS DISTINCT FROM OLD.firstName) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, CASE WHEN LENGTH(OLD.lastName::TEXT) > 5000 THEN LEFT(OLD.lastName::TEXT, 4997) || '...' ELSE OLD.lastName::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.lastName::TEXT) > 5000 THEN LEFT(NEW.lastName::TEXT, 4997) || '...' ELSE NEW.lastName::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.lastName IS DISTINCT FROM OLD.lastName) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'email' AS attribute, CASE WHEN LENGTH(OLD.email::TEXT) > 5000 THEN LEFT(OLD.email::TEXT, 4997) || '...' ELSE OLD.email::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.email::TEXT) > 5000 THEN LEFT(NEW.email::TEXT, 4997) || '...' ELSE NEW.email::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.email IS DISTINCT FROM OLD.email) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.email', true), 'false') != 'true'
            UNION ALL
            SELECT 'phone' AS attribute, CASE WHEN LENGTH(OLD.phone::TEXT) > 5000 THEN LEFT(OLD.phone::TEXT, 4997) || '...' ELSE OLD.phone::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.phone::TEXT) > 5000 THEN LEFT(NEW.phone::TEXT, 4997) || '...' ELSE NEW.phone::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.phone IS DISTINCT FROM OLD.phone) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.phone', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Customers' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'firstName' AS attribute, CASE WHEN LENGTH(OLD.firstName::TEXT) > 5000 THEN LEFT(OLD.firstName::TEXT, 4997) || '...' ELSE OLD.firstName::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.firstName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.firstName', true), 'false') != 'true'
            UNION ALL
            SELECT 'lastName' AS attribute, CASE WHEN LENGTH(OLD.lastName::TEXT) > 5000 THEN LEFT(OLD.lastName::TEXT, 4997) || '...' ELSE OLD.lastName::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.lastName IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.lastName', true), 'false') != 'true'
            UNION ALL
            SELECT 'email' AS attribute, CASE WHEN LENGTH(OLD.email::TEXT) > 5000 THEN LEFT(OLD.email::TEXT, 4997) || '...' ELSE OLD.email::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.email IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.email', true), 'false') != 'true'
            UNION ALL
            SELECT 'phone' AS attribute, CASE WHEN LENGTH(OLD.phone::TEXT) > 5000 THEN LEFT(OLD.phone::TEXT, 4997) || '...' ELSE OLD.phone::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.phone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Customers.phone', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_customers_tr_change
    AFTER INSERT OR UPDATE OF firstname, lastname, email, phone OR DELETE ON "sap_capire_incidents_customers"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_customers_func_change();
    
