CREATE OR REPLACE FUNCTION sap_capire_incidents_orderproducts_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.OrderProducts';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        comp_parent_id UUID := NULL;
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_OrderProducts', true), 'false') != 'true') THEN
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
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Orders'
                AND entitykey = rec.order_ID::TEXT
                AND attribute = 'orderProducts'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'orderProducts',
                        'sap.capire.incidents.Orders',
                        rec.order_ID::TEXT,
                        rec.order_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
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
            SELECT 'country' AS attribute, NULL AS valueChangedFrom, NEW.country_code::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = NEW.country_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$c".name FROM sap_common_Countries as "$c" WHERE "$c".code = NEW.country_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.country_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.country', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, NULL AS valueChangedFrom, NEW.price::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Decimal' AS valueDataType WHERE (NEW.price IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.price', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Orders'
                AND entitykey = rec.order_ID::TEXT
                AND attribute = 'orderProducts'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'orderProducts',
                        'sap.capire.incidents.Orders',
                        rec.order_ID::TEXT,
                        rec.order_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
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
            SELECT 'country' AS attribute, OLD.country_code::TEXT AS valueChangedFrom, NEW.country_code::TEXT AS valueChangedTo, (SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = OLD.country_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$c".name FROM sap_common_Countries as "$c" WHERE "$c".code = OLD.country_code LIMIT 1))) AS valueChangedFromLabel, (SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = NEW.country_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$c".name FROM sap_common_Countries as "$c" WHERE "$c".code = NEW.country_code LIMIT 1))) AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (NEW.country_code IS DISTINCT FROM OLD.country_code) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.country', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, OLD.price::TEXT AS valueChangedFrom, NEW.price::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Decimal' AS valueDataType WHERE (NEW.price IS DISTINCT FROM OLD.price) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.price', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.Orders'
                AND entitykey = rec.order_ID::TEXT
                AND attribute = 'orderProducts'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'orderProducts',
                        'sap.capire.incidents.Orders',
                        rec.order_ID::TEXT,
                        rec.order_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.OrderProducts' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'country' AS attribute, OLD.country_code::TEXT AS valueChangedFrom, NULL AS valueChangedTo, (SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = OLD.country_code and "$t".locale = current_setting('cap.locale',true) LIMIT 1), (SELECT "$c".name FROM sap_common_Countries as "$c" WHERE "$c".code = OLD.country_code LIMIT 1))) AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Association' AS valueDataType WHERE (OLD.country_code IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.country', true), 'false') != 'true'
            UNION ALL
            SELECT 'price' AS attribute, OLD.price::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Decimal' AS valueDataType WHERE (OLD.price IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_OrderProducts.price', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_orderproducts_tr_change
    AFTER INSERT OR UPDATE OF country_code, price OR DELETE ON "sap_capire_incidents_orderproducts"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_orderproducts_func_change();
    
