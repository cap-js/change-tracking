CREATE OR REPLACE FUNCTION sap_capire_incidents_incidents_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.Incidents';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_Incidents', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := COALESCE(((SELECT "$c".firstName || ' ' || "$c".lastName as value FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = rec.customer_ID LIMIT 1) || ': ' || (SELECT address.city as value FROM sap_capire_incidents_Customers as "$c" left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = "$c".ID WHERE "$c".ID = rec.customer_ID LIMIT 1) || ' - ' || rec.title)::TEXT, entity_key);

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
            SELECT 'customer' AS attribute, NULL AS valueChangedFrom, NEW.customer_ID::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT "$c".firstName || ' ' || "$c".lastName as name FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = NEW.customer_ID LIMIT 1) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.customer_ID IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.customer', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, NULL AS valueChangedFrom, NEW.status_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.status', true), 'false') != 'true'
            UNION ALL
            SELECT 'statusExpr' AS attribute, NULL AS valueChangedFrom, NEW.statusExpr_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.statusExpr_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.statusExpr_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.statusExpr_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.statusExpr', true), 'false') != 'true'
            UNION ALL
            SELECT 'date' AS attribute, NULL AS valueChangedFrom, NEW.date::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Date' AS valueDataType WHERE (NEW.date IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.date', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, NULL AS valueChangedFrom, NEW.datetime::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetime IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetime', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWTimeZone' AS attribute, NULL AS valueChangedFrom, NEW.datetimeWTimeZone::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetimeWTimeZone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWDynamicTimeZone' AS attribute, NULL AS valueChangedFrom, NEW.datetimeWDynamicTimeZone::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetimeWDynamicTimeZone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'time' AS attribute, NULL AS valueChangedFrom, NEW.time::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Time' AS valueDataType WHERE (NEW.time IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.time', true), 'false') != 'true'
            UNION ALL
            SELECT 'timestamp' AS attribute, NULL AS valueChangedFrom, NEW.timestamp::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Timestamp' AS valueDataType WHERE (NEW.timestamp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.timestamp', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, NULL AS valueChangedFrom, NEW.decimalProp::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (NEW.decimalProp * 2)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.decimalProp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.decimalProp', true), 'false') != 'true'
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
            SELECT 'customer' AS attribute, OLD.customer_ID::TEXT AS valueChangedFrom, NEW.customer_ID::TEXT AS valueChangedTo, (SELECT "$c".firstName || ' ' || "$c".lastName as name FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = OLD.customer_ID LIMIT 1) AS valueChangedFromLabel, (SELECT "$c".firstName || ' ' || "$c".lastName as name FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = NEW.customer_ID LIMIT 1) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.customer_ID IS DISTINCT FROM OLD.customer_ID) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.customer', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, OLD.status_code::TEXT AS valueChangedFrom, NEW.status_code::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status_code LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.status_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.status_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.status_code IS DISTINCT FROM OLD.status_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.status', true), 'false') != 'true'
            UNION ALL
            SELECT 'statusExpr' AS attribute, OLD.statusExpr_code::TEXT AS valueChangedFrom, NEW.statusExpr_code::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.statusExpr_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.statusExpr_code LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = NEW.statusExpr_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = NEW.statusExpr_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.statusExpr_code IS DISTINCT FROM OLD.statusExpr_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.statusExpr', true), 'false') != 'true'
            UNION ALL
            SELECT 'date' AS attribute, OLD.date::TEXT AS valueChangedFrom, NEW.date::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Date' AS valueDataType WHERE (NEW.date IS DISTINCT FROM OLD.date) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.date', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, OLD.datetime::TEXT AS valueChangedFrom, NEW.datetime::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetime IS DISTINCT FROM OLD.datetime) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetime', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWTimeZone' AS attribute, OLD.datetimeWTimeZone::TEXT AS valueChangedFrom, NEW.datetimeWTimeZone::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetimeWTimeZone IS DISTINCT FROM OLD.datetimeWTimeZone) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWDynamicTimeZone' AS attribute, OLD.datetimeWDynamicTimeZone::TEXT AS valueChangedFrom, NEW.datetimeWDynamicTimeZone::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (NEW.datetimeWDynamicTimeZone IS DISTINCT FROM OLD.datetimeWDynamicTimeZone) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'time' AS attribute, OLD.time::TEXT AS valueChangedFrom, NEW.time::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Time' AS valueDataType WHERE (NEW.time IS DISTINCT FROM OLD.time) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.time', true), 'false') != 'true'
            UNION ALL
            SELECT 'timestamp' AS attribute, OLD.timestamp::TEXT AS valueChangedFrom, NEW.timestamp::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Timestamp' AS valueDataType WHERE (NEW.timestamp IS DISTINCT FROM OLD.timestamp) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.timestamp', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, OLD.decimalProp::TEXT AS valueChangedFrom, NEW.decimalProp::TEXT AS valueChangedTo, (OLD.decimalProp * 2)::TEXT AS valueChangedFromLabel, (NEW.decimalProp * 2)::TEXT AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.decimalProp IS DISTINCT FROM OLD.decimalProp) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.decimalProp', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'customer' AS attribute, OLD.customer_ID::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT "$c".firstName || ' ' || "$c".lastName as name FROM sap_capire_incidents_Customers as "$c" WHERE "$c".ID = OLD.customer_ID LIMIT 1) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.customer_ID IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.customer', true), 'false') != 'true'
            UNION ALL
            SELECT 'status' AS attribute, OLD.status_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.status_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.status_code LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.status_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.status', true), 'false') != 'true'
            UNION ALL
            SELECT 'statusExpr' AS attribute, OLD.statusExpr_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = OLD.statusExpr_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$s".descr FROM sap_capire_incidents_Status as "$s" WHERE "$s".code = OLD.statusExpr_code LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.statusExpr_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.statusExpr', true), 'false') != 'true'
            UNION ALL
            SELECT 'date' AS attribute, OLD.date::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Date' AS valueDataType WHERE (OLD.date IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.date', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetime' AS attribute, OLD.datetime::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (OLD.datetime IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetime', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWTimeZone' AS attribute, OLD.datetimeWTimeZone::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (OLD.datetimeWTimeZone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'datetimeWDynamicTimeZone' AS attribute, OLD.datetimeWDynamicTimeZone::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.DateTime' AS valueDataType WHERE (OLD.datetimeWDynamicTimeZone IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone', true), 'false') != 'true'
            UNION ALL
            SELECT 'time' AS attribute, OLD.time::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Time' AS valueDataType WHERE (OLD.time IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.time', true), 'false') != 'true'
            UNION ALL
            SELECT 'timestamp' AS attribute, OLD.timestamp::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Timestamp' AS valueDataType WHERE (OLD.timestamp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.timestamp', true), 'false') != 'true'
            UNION ALL
            SELECT 'decimalProp' AS attribute, OLD.decimalProp::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (OLD.decimalProp * 2)::TEXT AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.decimalProp IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents.decimalProp', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_incidents_tr_change
    AFTER INSERT OR UPDATE OF customer_id, status_code, statusexpr_code, date, datetime, datetimewtimezone, datetimewdynamictimezone, time, timestamp, decimalprop OR DELETE ON "sap_capire_incidents_incidents"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_incidents_func_change();
    
