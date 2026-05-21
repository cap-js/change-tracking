CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_PAGESNOTID_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_PAGESNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_PagesNotID'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'pages',
				'sap.capire.incidents.BooksNotID',
				new.book_NOT_ID,
				new.book_NOT_ID,
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = new.book_NOT_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = new.book_NOT_ID
				AND attribute = 'pages'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.BooksNotID'
		AND entityKey = new.book_NOT_ID
		AND attribute = 'pages'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.PagesNotID',
			new.NOT_ID,
			new.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'page' AS attribute, 
				NULL AS valueChangedFrom, 
				new.page AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (new.page IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_PagesNotID.page'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_PAGESNOTID_ct_update AFTER UPDATE OF page 
    ON SAP_CAPIRE_INCIDENTS_PAGESNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_PagesNotID'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'pages',
				'sap.capire.incidents.BooksNotID',
				new.book_NOT_ID,
				new.book_NOT_ID,
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = new.book_NOT_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = new.book_NOT_ID
				AND attribute = 'pages'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.BooksNotID'
		AND entityKey = new.book_NOT_ID
		AND attribute = 'pages'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.PagesNotID',
			new.NOT_ID,
			new.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'page' AS attribute, 
				old.page AS valueChangedFrom, 
				new.page AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (old.page IS NOT new.page) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_PagesNotID.page'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_PAGESNOTID_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_PAGESNOTID
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_PagesNotID'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.PagesNotID' AND entityKey = old.NOT_ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'pages',
				'sap.capire.incidents.BooksNotID',
				old.book_NOT_ID,
				old.book_NOT_ID,
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = old.book_NOT_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.BooksNotID'
				AND entityKey = old.book_NOT_ID
				AND attribute = 'pages'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.BooksNotID'
		AND entityKey = old.book_NOT_ID
		AND attribute = 'pages'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.PagesNotID',
			old.NOT_ID,
			old.NOT_ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'page' AS attribute, 
				old.page AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (old.page IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_PagesNotID.page'), 'false') != 'true'
		);
    END;
