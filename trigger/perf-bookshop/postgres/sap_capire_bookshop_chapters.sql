CREATE OR REPLACE FUNCTION sap_capire_bookshop_chapters_func_change() RETURNS TRIGGER AS $$
    DECLARE
        entity_name TEXT := 'sap.capire.bookshop.Chapters';
        entity_key TEXT;
        object_id TEXT;
        user_id TEXT := coalesce(current_setting('cap.applicationuser', true), 'anonymous');
        transaction_id BIGINT := txid_current();
        comp_parent_id UUID := NULL;
        
    BEGIN
        
        DECLARE
            rec RECORD;
        BEGIN
            IF NOT (COALESCE(current_setting('ct.skip', true), 'false') != 'true' AND COALESCE(current_setting('ct.skip_entity.sap_capire_bookshop_Chapters', true), 'false') != 'true') THEN
                RETURN NULL;
            END IF;

            IF (TG_OP = 'DELETE') THEN
                rec := OLD;
            ELSE
                rec := NEW;
            END IF;

            entity_key := rec.ID::TEXT;
            object_id := COALESCE(rec.name::TEXT, entity_key);

            IF (TG_OP = 'INSERT') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.bookshop.Books'
                AND entitykey = rec.book_ID::TEXT
                AND attribute = 'chapters'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'chapters',
                        'sap.capire.bookshop.Books',
                        rec.book_ID::TEXT,
                        COALESCE((SELECT "$b".name FROM sap_capire_bookshop_Books as "$b" WHERE "$b".ID = rec.book_ID LIMIT 1)::TEXT, rec.book_ID::TEXT),
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
            SELECT 'number' AS attribute, NULL AS valueChangedFrom, NEW.number::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (NEW.number IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.number', true), 'false') != 'true'
            UNION ALL
            SELECT 'name' AS attribute, NULL AS valueChangedFrom, CASE WHEN LENGTH(NEW.name::TEXT) > 5000 THEN LEFT(NEW.name::TEXT, 4997) || '...' ELSE NEW.name::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.name IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.name', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'UPDATE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.bookshop.Books'
                AND entitykey = rec.book_ID::TEXT
                AND attribute = 'chapters'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'chapters',
                        'sap.capire.bookshop.Books',
                        rec.book_ID::TEXT,
                        COALESCE((SELECT "$b".name FROM sap_capire_bookshop_Books as "$b" WHERE "$b".ID = rec.book_ID LIMIT 1)::TEXT, rec.book_ID::TEXT),
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
            SELECT 'number' AS attribute, OLD.number::TEXT AS valueChangedFrom, NEW.number::TEXT AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (NEW.number IS DISTINCT FROM OLD.number) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.number', true), 'false') != 'true'
            UNION ALL
            SELECT 'name' AS attribute, CASE WHEN LENGTH(OLD.name::TEXT) > 5000 THEN LEFT(OLD.name::TEXT, 4997) || '...' ELSE OLD.name::TEXT END AS valueChangedFrom, CASE WHEN LENGTH(NEW.name::TEXT) > 5000 THEN LEFT(NEW.name::TEXT, 4997) || '...' ELSE NEW.name::TEXT END AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (NEW.name IS DISTINCT FROM OLD.name) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.name', true), 'false') != 'true'
            ) AS changes;
            ELSIF (TG_OP = 'DELETE') THEN
                SELECT id INTO comp_parent_id FROM sap_changelog_changes WHERE entity = 'sap.capire.bookshop.Books'
                AND entitykey = rec.book_ID::TEXT
                AND attribute = 'chapters'
                AND valuedatatype = 'cds.Composition'
                AND transactionid = transaction_id;
            IF comp_parent_id IS NULL THEN
                comp_parent_id := gen_random_uuid();
                INSERT INTO sap_changelog_changes
                    (ID, PARENT_ID, ATTRIBUTE, ENTITY, ENTITYKEY, OBJECTID, CREATEDAT, CREATEDBY, VALUEDATATYPE, MODIFICATION, TRANSACTIONID)
                    VALUES (
                        comp_parent_id,
                        NULL,
                        'chapters',
                        'sap.capire.bookshop.Books',
                        rec.book_ID::TEXT,
                        COALESCE((SELECT "$b".name FROM sap_capire_bookshop_Books as "$b" WHERE "$b".ID = rec.book_ID LIMIT 1)::TEXT, rec.book_ID::TEXT),
                        now(),
                        user_id,
                        'cds.Composition',
                        'update',
                        transaction_id
                    );
            END IF;
                DELETE FROM sap_changelog_changes WHERE entity = 'sap.capire.bookshop.Chapters' AND entitykey = OLD.ID::TEXT;
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
            SELECT 'number' AS attribute, OLD.number::TEXT AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.Integer' AS valueDataType WHERE (OLD.number IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.number', true), 'false') != 'true'
            UNION ALL
            SELECT 'name' AS attribute, CASE WHEN LENGTH(OLD.name::TEXT) > 5000 THEN LEFT(OLD.name::TEXT, 4997) || '...' ELSE OLD.name::TEXT END AS valueChangedFrom, NULL AS valueChangedTo, NULL AS valueChangedFromLabel, NULL AS valueChangedToLabel, 'cds.String' AS valueDataType WHERE (OLD.name IS NOT NULL) AND COALESCE(current_setting('ct.skip_element.sap_capire_bookshop_Chapters.name', true), 'false') != 'true'
            ) AS changes;
            END IF;
        END;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sap_capire_bookshop_chapters_tr_change
    AFTER INSERT OR UPDATE OF number, name OR DELETE ON "sap_capire_bookshop_chapters"
    FOR EACH ROW EXECUTE FUNCTION sap_capire_bookshop_chapters_func_change();
    
