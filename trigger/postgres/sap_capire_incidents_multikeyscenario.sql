CREATE OR REPLACE FUNCTION sap_capire_incidents_multikeyscenario_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.MultiKeyScenario';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_MultiKeyScenario', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := LENGTH(rec.GJAHR::TEXT) || ',' || rec.GJAHR::TEXT || ';' || LENGTH(rec.BUKRS::TEXT) || ',' || rec.BUKRS::TEXT;
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
            SELECT 'foo1' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.foo1::TEXT) > 5000 THEN LEFT(NEW.foo1::TEXT, 4997) || '...' ELSE NEW.foo1::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.foo1 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, NULL AS valueChangedFrom, NEW.datetime::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetime IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime', true), 'false') != 'true'
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
            SELECT 'foo1' AS attribute, CASE WHEN LENGTH(OLD.foo1::TEXT) > 5000 THEN LEFT(OLD.foo1::TEXT, 4997) || '...' ELSE OLD.foo1::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.foo1::TEXT) > 5000 THEN LEFT(NEW.foo1::TEXT, 4997) || '...' ELSE NEW.foo1::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.foo1 IS DISTINCT FROM OLD.foo1) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, OLD.datetime::TEXT AS valueChangedFrom, NEW.datetime::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetime IS DISTINCT FROM OLD.datetime) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.MultiKeyScenario' AND entitykey = LENGTH(OLD.GJAHR::TEXT) || ',' || OLD.GJAHR::TEXT || ';' || LENGTH(OLD.BUKRS::TEXT) || ',' || OLD.BUKRS::TEXT;
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
            SELECT 'foo1' AS attribute, CASE WHEN LENGTH(OLD.foo1::TEXT) > 5000 THEN LEFT(OLD.foo1::TEXT, 4997) || '...' ELSE OLD.foo1::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.foo1 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, OLD.datetime::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (OLD.datetime IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_multikeyscenario_tr_change
    AFTER INSERT OR UPDATE OF foo1, datetime OR DELETE ON "sap_capire_incidents_multikeyscenario"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_multikeyscenario_func_change();
    
