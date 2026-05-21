CREATE OR REPLACE FUNCTION sap_capire_incidents_orders_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.Orders';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_Orders', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := entity_key;

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
            SELECT 'abc' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.abc::TEXT) > 5000 THEN LEFT(NEW.abc::TEXT, 4997) || '...' ELSE NEW.abc::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.abc IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Orders.abc', true), 'false') != 'true'
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
            SELECT 'abc' AS attribute, CASE WHEN LENGTH(OLD.abc::TEXT) > 5000 THEN LEFT(OLD.abc::TEXT, 4997) || '...' ELSE OLD.abc::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.abc::TEXT) > 5000 THEN LEFT(NEW.abc::TEXT, 4997) || '...' ELSE NEW.abc::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.abc IS DISTINCT FROM OLD.abc) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Orders.abc', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Orders' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'abc' AS attribute, CASE WHEN LENGTH(OLD.abc::TEXT) > 5000 THEN LEFT(OLD.abc::TEXT, 4997) || '...' ELSE OLD.abc::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.abc IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Orders.abc', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_orders_tr_change
    AFTER INSERT OR UPDATE OF abc OR DELETE ON "sap_capire_incidents_orders"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_orders_func_change();
    
