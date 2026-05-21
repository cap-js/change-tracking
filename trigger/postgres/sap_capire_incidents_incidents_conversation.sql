CREATE OR REPLACE FUNCTION sap_capire_incidents_incidents_conversation_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.Incidents.conversation';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        comp_parent_id UUID := NULL;
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_Incidents_conversation', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := LENGTH(rec.up__ID::TEXT) || ',' || rec.up__ID::TEXT || ';' || LENGTH(rec.ID::TEXT) || ',' || rec.ID::TEXT;
            object_id := COALESCE((SELECT "$c".author FROM sap_capire_incidents_Incidents_conversation as "$c" WHERE "$c".up__ID = rec.up__ID and "$c".ID = rec.ID LIMIT 1)::TEXT, entity_key);

            IF (TG_OP = 'INSERT') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.up__ID::TEXT
                AND attribute = 'conversation'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'conversation',
                        'sap.capire.incidents.Incidents',
                        rec.up__ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.up__ID LIMIT 1)::TEXT, rec.up__ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.up__ID::TEXT
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
            SELECT 'message' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.message::TEXT) > 5000 THEN LEFT(NEW.message::TEXT, 4997) || '...' ELSE NEW.message::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.message IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents_conversation.message', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.up__ID::TEXT
                AND attribute = 'conversation'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'conversation',
                        'sap.capire.incidents.Incidents',
                        rec.up__ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.up__ID LIMIT 1)::TEXT, rec.up__ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.up__ID::TEXT
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
            SELECT 'message' AS attribute, CASE WHEN LENGTH(OLD.message::TEXT) > 5000 THEN LEFT(OLD.message::TEXT, 4997) || '...' ELSE OLD.message::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.message::TEXT) > 5000 THEN LEFT(NEW.message::TEXT, 4997) || '...' ELSE NEW.message::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.message IS DISTINCT FROM OLD.message) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents_conversation.message', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents'
                AND entitykey = rec.up__ID::TEXT
                AND attribute = 'conversation'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'conversation',
                        'sap.capire.incidents.Incidents',
                        rec.up__ID::TEXT,
                        COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$i".title as value FROM sap_capire_incidents_Incidents as "$i" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$i".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$i".ID = rec.up__ID LIMIT 1)::TEXT, rec.up__ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.Incidents'
                    AND entitykey = rec.up__ID::TEXT
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END,
                        transaction_id
                    );
            END IF;
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Incidents.conversation' AND entitykey = LENGTH(OLD.up__ID::TEXT) || ',' || OLD.up__ID::TEXT || ';' || LENGTH(OLD.ID::TEXT) || ',' || OLD.ID::TEXT;
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
            SELECT 'message' AS attribute, CASE WHEN LENGTH(OLD.message::TEXT) > 5000 THEN LEFT(OLD.message::TEXT, 4997) || '...' ELSE OLD.message::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.message IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_Incidents_conversation.message', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_incidents_conversation_tr_change
    AFTER INSERT OR UPDATE OF message OR DELETE ON "sap_capire_incidents_incidents_conversation"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_incidents_conversation_func_change();
    
