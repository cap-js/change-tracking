CREATE OR REPLACE FUNCTION sap_capire_incidents_incidenttasks_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.IncidentTasks';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        comp_parent_id UUID := NULL;
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_IncidentTasks', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := COALESCE(rec.title::TEXT, entity_key);

            IF (TG_OP = 'INSERT') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.incident_ID::TEXT
                AND attribute = 'tasks'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'tasks',
                        'sap.capire.incidents.Incidents',
                        rec.incident_ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.incident_ID LIMIT 1)::TEXT, rec.incident_ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.incident_ID::TEXT
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END,
                        transaction_id
                    );
            END IF;
                INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                comp_parent_id,
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
            SELECT 'title' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.title::TEXT) > 5000 THEN LEFT(NEW.title::TEXT, 4997) || '...' ELSE NEW.title::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.title IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.title', true), 'false') != 'true'
            UNION ALL
            SELECT 'description' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.description::TEXT) > 5000 THEN LEFT(NEW.description::TEXT, 4997) || '...' ELSE NEW.description::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.description IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.description', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.incident_ID::TEXT
                AND attribute = 'tasks'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'tasks',
                        'sap.capire.incidents.Incidents',
                        rec.incident_ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.incident_ID LIMIT 1)::TEXT, rec.incident_ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.incident_ID::TEXT
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END,
                        transaction_id
                    );
            END IF;
                INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                comp_parent_id,
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
            SELECT 'title' AS attribute, CASE WHEN LENGTH(OLD.title::TEXT) > 5000 THEN LEFT(OLD.title::TEXT, 4997) || '...' ELSE OLD.title::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.title::TEXT) > 5000 THEN LEFT(NEW.title::TEXT, 4997) || '...' ELSE NEW.title::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.title IS DISTINCT FROM OLD.title) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.title', true), 'false') != 'true'
            UNION ALL
            SELECT 'description' AS attribute, CASE WHEN LENGTH(OLD.description::TEXT) > 5000 THEN LEFT(OLD.description::TEXT, 4997) || '...' ELSE OLD.description::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.description::TEXT) > 5000 THEN LEFT(NEW.description::TEXT, 4997) || '...' ELSE NEW.description::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.description IS DISTINCT FROM OLD.description) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.description', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.incident_ID::TEXT
                AND attribute = 'tasks'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'tasks',
                        'sap.capire.incidents.Incidents',
                        rec.incident_ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.incident_ID LIMIT 1)::TEXT, rec.incident_ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.incident_ID::TEXT
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END,
                        transaction_id
                    );
            END IF;
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.IncidentTasks' AND entitykey = OLD.ID::TEXT;
            INSERT INTO sap_changelog_changes
            (ID, PARENT_ID, ATTRIBUTE, VALUECHANGEDFROM, VALUECHANGEDTO, VALUECHANGEDFROMLABEL, VALUECHANGEDTOLABEL, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
            SELECT
                gen_random_uuid(),
                comp_parent_id,
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
            SELECT 'title' AS attribute, CASE WHEN LENGTH(OLD.title::TEXT) > 5000 THEN LEFT(OLD.title::TEXT, 4997) || '...' ELSE OLD.title::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.title IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.title', true), 'false') != 'true'
            UNION ALL
            SELECT 'description' AS attribute, CASE WHEN LENGTH(OLD.description::TEXT) > 5000 THEN LEFT(OLD.description::TEXT, 4997) || '...' ELSE OLD.description::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.description IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_IncidentTasks.description', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_incidenttasks_tr_change
    AFTER INSERT OR UPDATE OF title, description OR DELETE ON "sap_capire_incidents_incidenttasks"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_incidenttasks_func_change();
    
