CREATE OR REPLACE FUNCTION sap_capire_incidents_pagesnotid_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.incidents.PagesNotID';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        comp_parent_id UUID := NULL;
        
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_incidents_PagesNotID', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.NOT_ID::TEXT;
            object_id := entity_key;

            IF (TG_OP = 'INSERT') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.BooksNotID'
                AND entitykey = rec.book_NOT_ID::TEXT
                AND attribute = 'pages'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'pages',
                        'sap.capire.incidents.BooksNotID',
                        rec.book_NOT_ID::TEXT,
                        rec.book_NOT_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.BooksNotID'
                    AND entitykey = rec.book_NOT_ID::TEXT
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
            SELECT 'page' AS attribute, NULL AS valueChangedFrom, NEW.page::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (NEW.page IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_PagesNotID.page', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.BooksNotID'
                AND entitykey = rec.book_NOT_ID::TEXT
                AND attribute = 'pages'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'pages',
                        'sap.capire.incidents.BooksNotID',
                        rec.book_NOT_ID::TEXT,
                        rec.book_NOT_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.BooksNotID'
                    AND entitykey = rec.book_NOT_ID::TEXT
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
            SELECT 'page' AS attribute, OLD.page::TEXT AS valueChangedFrom, NEW.page::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (NEW.page IS DISTINCT FROM OLD.page) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_PagesNotID.page', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.BooksNotID'
                AND entitykey = rec.book_NOT_ID::TEXT
                AND attribute = 'pages'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'pages',
                        'sap.capire.incidents.BooksNotID',
                        rec.book_NOT_ID::TEXT,
                        rec.book_NOT_ID::TEXT,
                        now(),
                        user_id,
                        'cds.Composition',
                        CASE WHEN EXISTS (
                    SELECT 1 FROM sap_changelog_changes
                    WHERE entity = 'sap.capire.incidents.BooksNotID'
                    AND entitykey = rec.book_NOT_ID::TEXT
                    AND modification = 'create'
                    AND transactionid = transaction_id
                ) THEN 'create' ELSE 'update' END,
                        transaction_id
                    );
            END IF;
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.incidents.PagesNotID' AND entitykey = OLD.NOT_ID::TEXT;
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
            SELECT 'page' AS attribute, OLD.page::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (OLD.page IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_incidents_PagesNotID.page', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_incidents_pagesnotid_tr_change
    AFTER INSERT OR UPDATE OF page OR DELETE ON "sap_capire_incidents_pagesnotid"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_incidents_pagesnotid_func_change();
    
