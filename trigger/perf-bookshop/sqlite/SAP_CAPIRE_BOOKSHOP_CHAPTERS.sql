CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_CHAPTERS_ct_create AFTER INSERT
    ON SAP_CAPIRE_BOOKSHOP_CHAPTERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Chapters'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'chapters',
			'sap.capire.bookshop.Books',
			new.book_ID,
			COALESCE((SELECT "$B".name FROM sap_capire_bookshop_Books as "$B" WHERE "$B".ID = new.book_ID LIMIT 1), new.book_ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.bookshop.Books'
			AND entityKey = new.book_ID
			AND attribute = 'chapters'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.bookshop.Books'
		AND entityKey = new.book_ID
		AND attribute = 'chapters'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Chapters',
			new.ID,
			COALESCE(new.name, new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'number' AS attribute, 
				NULL AS valueChangedFrom, 
				new.number AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (new.number IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.number'), 'false') != 'true'
UNION ALL

			SELECT 
				'name' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.name) > 5000 THEN SUBSTR(new.name, 1, 4997) || '...' ELSE new.name END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.name IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.name'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_CHAPTERS_ct_update AFTER UPDATE OF number, name 
    ON SAP_CAPIRE_BOOKSHOP_CHAPTERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Chapters'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'chapters',
			'sap.capire.bookshop.Books',
			new.book_ID,
			COALESCE((SELECT "$B".name FROM sap_capire_bookshop_Books as "$B" WHERE "$B".ID = new.book_ID LIMIT 1), new.book_ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.bookshop.Books'
			AND entityKey = new.book_ID
			AND attribute = 'chapters'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.bookshop.Books'
		AND entityKey = new.book_ID
		AND attribute = 'chapters'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Chapters',
			new.ID,
			COALESCE(new.name, new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'number' AS attribute, 
				old.number AS valueChangedFrom, 
				new.number AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (old.number IS NOT new.number) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.number'), 'false') != 'true'
UNION ALL

			SELECT 
				'name' AS attribute, 
				CASE WHEN LENGTH(old.name) > 5000 THEN SUBSTR(old.name, 1, 4997) || '...' ELSE old.name END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.name) > 5000 THEN SUBSTR(new.name, 1, 4997) || '...' ELSE new.name END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.name IS NOT new.name) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.name'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_CHAPTERS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_BOOKSHOP_CHAPTERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_bookshop_Chapters'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.bookshop.Chapters' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'chapters',
			'sap.capire.bookshop.Books',
			old.book_ID,
			COALESCE((SELECT "$B".name FROM sap_capire_bookshop_Books as "$B" WHERE "$B".ID = old.book_ID LIMIT 1), old.book_ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.bookshop.Books'
			AND entityKey = old.book_ID
			AND attribute = 'chapters'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.bookshop.Books'
		AND entityKey = old.book_ID
		AND attribute = 'chapters'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.bookshop.Chapters',
			old.ID,
			COALESCE(old.name, old.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'number' AS attribute, 
				old.number AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Integer' AS valueDataType 
			WHERE (old.number IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.number'), 'false') != 'true'
UNION ALL

			SELECT 
				'name' AS attribute, 
				CASE WHEN LENGTH(old.name) > 5000 THEN SUBSTR(old.name, 1, 4997) || '...' ELSE old.name END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.name IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_bookshop_Chapters.name'), 'false') != 'true'
		);
    END;
