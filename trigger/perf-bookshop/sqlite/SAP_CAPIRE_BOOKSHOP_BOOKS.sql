CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_BOOKS_ct_create AFTER INSERT
    ON SAP_CAPIRE_BOOKSHOP_BOOKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Books'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Books',
			new.ID,
			COALESCE(new.name, new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'name' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.name) > 5000 THEN SUBSTR(new.name, 1, 4997) || '...' ELSE new.name END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.name IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Books.name'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_BOOKS_ct_update AFTER UPDATE OF name 
    ON SAP_CAPIRE_BOOKSHOP_BOOKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Books'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Books',
			new.ID,
			COALESCE(new.name, new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'name' AS attribute, 
				CASE WHEN LENGTH(old.name) > 5000 THEN SUBSTR(old.name, 1, 4997) || '...' ELSE old.name END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.name) > 5000 THEN SUBSTR(new.name, 1, 4997) || '...' ELSE new.name END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.name IS NOT new.name) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Books.name'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_BOOKS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_BOOKSHOP_BOOKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Books'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.bookshop.Books' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Books',
			old.ID,
			COALESCE(old.name, old.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'name' AS attribute, 
				CASE WHEN LENGTH(old.name) > 5000 THEN SUBSTR(old.name, 1, 4997) || '...' ELSE old.name END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.name IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Books.name'), 'false') != 'true'
		);
    END;
