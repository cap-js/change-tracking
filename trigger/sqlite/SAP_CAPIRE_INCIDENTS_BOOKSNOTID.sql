CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_BOOKSNOTID_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_BOOKSNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_BooksNotID'), 'false') != 'true')
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
			'sap.capire.incidents.BooksNotID',
			new.NOT_ID,
			new.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'title' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.title) > 5000 THEN SUBSTR(new.title, 1, 4997) || '...' ELSE new.title END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.title IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_BooksNotID.title'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_BOOKSNOTID_ct_update AFTER UPDATE OF title 
    ON SAP_CAPIRE_INCIDENTS_BOOKSNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_BooksNotID'), 'false') != 'true')
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
			'sap.capire.incidents.BooksNotID',
			new.NOT_ID,
			new.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'title' AS attribute, 
				CASE WHEN LENGTH(old.title) > 5000 THEN SUBSTR(old.title, 1, 4997) || '...' ELSE old.title END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.title) > 5000 THEN SUBSTR(new.title, 1, 4997) || '...' ELSE new.title END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.title IS NOT new.title) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_BooksNotID.title'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_BOOKSNOTID_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_BOOKSNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_BooksNotID'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.BooksNotID' AND entityKey = old.NOT_ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.BooksNotID',
			old.NOT_ID,
			old.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'title' AS attribute, 
				CASE WHEN LENGTH(old.title) > 5000 THEN SUBSTR(old.title, 1, 4997) || '...' ELSE old.title END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.title IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_BooksNotID.title'), 'false') != 'true'
		);
    END;
