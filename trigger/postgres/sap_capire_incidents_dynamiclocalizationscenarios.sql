CREATE OR REPLACE FUNCTION sap_capire_incidents_dynamiclocalizationscenarios_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.DynamicLocalizationScenarios';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_DynamicLocalizationScenarios', true), 'false') != 'true') THEN
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
            SELECT 'status1' AS attribute, NULL AS valueChangedFrom, NEW.status1_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status1_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr || ', ' || "$s".code as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status1_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status1_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1', true), 'false') != 'true'
            UNION ALL
            SELECT 'status2' AS attribute, NULL AS valueChangedFrom, NEW.status2_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status2_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status2_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status2_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2', true), 'false') != 'true'
            UNION ALL
            SELECT 'status3' AS attribute, NULL AS valueChangedFrom, NEW.status3_code::TEXT || ' ' || NEW.status3_code2::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = NEW.status3_code and "$t".code2 = NEW.status3_code2 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$v".name FROM sap_capire_incidents_VHWithMultiKey as "$v" WHERE "$v".code = NEW.status3_code and "$v".code2 = NEW.status3_code2 LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status3_code IS NOT NULL OR NEW.status3_code2 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.status4::TEXT) > 5000 THEN LEFT(NEW.status4::TEXT, 4997) || '...' ELSE NEW.status4::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.status4 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4Nav' AS attribute, NULL AS valueChangedFrom, NEW.status4::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status4 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status4 LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status4 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav', true), 'false') != 'true'
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
            SELECT 'status1' AS attribute, OLD.status1_code::TEXT AS valueChangedFrom, NEW.status1_code::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status1_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr || ', ' || "$s".code as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status1_code LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status1_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr || ', ' || "$s".code as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status1_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status1_code IS DISTINCT FROM OLD.status1_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1', true), 'false') != 'true'
            UNION ALL
            SELECT 'status2' AS attribute, OLD.status2_code::TEXT AS valueChangedFrom, NEW.status2_code::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status2_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status2_code LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status2_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status2_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status2_code IS DISTINCT FROM OLD.status2_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2', true), 'false') != 'true'
            UNION ALL
            SELECT 'status3' AS attribute, OLD.status3_code::TEXT || ' ' || OLD.status3_code2::TEXT AS valueChangedFrom, NEW.status3_code::TEXT || ' ' || NEW.status3_code2::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = OLD.status3_code and "$t".code2 = OLD.status3_code2 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$v".name FROM sap_capire_incidents_VHWithMultiKey as "$v" WHERE "$v".code = OLD.status3_code and "$v".code2 = OLD.status3_code2 LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = NEW.status3_code and "$t".code2 = NEW.status3_code2 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$v".name FROM sap_capire_incidents_VHWithMultiKey as "$v" WHERE "$v".code = NEW.status3_code and "$v".code2 = NEW.status3_code2 LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status3_code IS DISTINCT FROM OLD.status3_code OR NEW.status3_code2 IS DISTINCT FROM OLD.status3_code2) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4' AS attribute, CASE WHEN LENGTH(OLD.status4::TEXT) > 5000 THEN LEFT(OLD.status4::TEXT, 4997) || '...' ELSE OLD.status4::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.status4::TEXT) > 5000 THEN LEFT(NEW.status4::TEXT, 4997) || '...' ELSE NEW.status4::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.status4 IS DISTINCT FROM OLD.status4) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4Nav' AS attribute, OLD.status4::TEXT AS valueChangedFrom, NEW.status4::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status4 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status4 LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status4 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status4 LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status4 IS DISTINCT FROM OLD.status4) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.DynamicLocalizationScenarios' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'status1' AS attribute, OLD.status1_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status1_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr || ', ' || "$s".code as value FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status1_code LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.status1_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1', true), 'false') != 'true'
            UNION ALL
            SELECT 'status2' AS attribute, OLD.status2_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status2_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status2_code LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.status2_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2', true), 'false') != 'true'
            UNION ALL
            SELECT 'status3' AS attribute, OLD.status3_code::TEXT || ' ' || OLD.status3_code2::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = OLD.status3_code and "$t".code2 = OLD.status3_code2 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$v".name FROM sap_capire_incidents_VHWithMultiKey as "$v" WHERE "$v".code = OLD.status3_code and "$v".code2 = OLD.status3_code2 LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.status3_code IS NOT NULL OR OLD.status3_code2 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4' AS attribute, CASE WHEN LENGTH(OLD.status4::TEXT) > 5000 THEN LEFT(OLD.status4::TEXT, 4997) || '...' ELSE OLD.status4::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.status4 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4', true), 'false') != 'true'
            UNION ALL
            SELECT 'status4Nav' AS attribute, OLD.status4::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status4 and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status4 LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.status4 IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_dynamiclocalizationscenarios_tr_change
    AFTER INSERT OR UPDATE OF status1_code, status2_code, status3_code, status3_code2, status4 OR DELETE ON "sap_capire_incidents_dynamiclocalizationscenarios"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_dynamiclocalizationscenarios_func_change();
    
