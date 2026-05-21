CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents_conversation'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'conversation',
			'sap.capire.incidents.Incidents',
			new.up__ID,
			COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = new.up__ID LIMIT 1), new.up__ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Incidents'
			AND entityKey = new.up__ID
			AND attribute = 'conversation'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = new.up__ID
		AND attribute = 'conversation'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Incidents.conversation',
			LENGTH(CAST(new.up__ID AS TEXT)) || ',' || CAST(new.up__ID AS TEXT) || ';' || LENGTH(CAST(new.ID AS TEXT)) || ',' || CAST(new.ID AS TEXT),
			COALESCE((SELECT "$c".author FROM sap_capire_incidents_Incidents_conversation as "$c" WHERE "$c".up__ID = new.up__ID and "$c".ID = new.ID LIMIT 1), LENGTH(CAST(new.up__ID AS TEXT)) || ',' || CAST(new.up__ID AS TEXT) || ';' || LENGTH(CAST(new.ID AS TEXT)) || ',' || CAST(new.ID AS TEXT)),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'message' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.message) > 5000 THEN SUBSTR(new.message, 1, 4997) || '...' ELSE new.message END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.message IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents_conversation.message'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION_ct_update AFTER UPDATE OF message 
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents_conversation'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'conversation',
			'sap.capire.incidents.Incidents',
			new.up__ID,
			COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = new.up__ID LIMIT 1), new.up__ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Incidents'
			AND entityKey = new.up__ID
			AND attribute = 'conversation'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = new.up__ID
		AND attribute = 'conversation'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Incidents.conversation',
			LENGTH(CAST(new.up__ID AS TEXT)) || ',' || CAST(new.up__ID AS TEXT) || ';' || LENGTH(CAST(new.ID AS TEXT)) || ',' || CAST(new.ID AS TEXT),
			COALESCE((SELECT "$c".author FROM sap_capire_incidents_Incidents_conversation as "$c" WHERE "$c".up__ID = new.up__ID and "$c".ID = new.ID LIMIT 1), LENGTH(CAST(new.up__ID AS TEXT)) || ',' || CAST(new.up__ID AS TEXT) || ';' || LENGTH(CAST(new.ID AS TEXT)) || ',' || CAST(new.ID AS TEXT)),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'message' AS attribute, 
				CASE WHEN LENGTH(old.message) > 5000 THEN SUBSTR(old.message, 1, 4997) || '...' ELSE old.message END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.message) > 5000 THEN SUBSTR(new.message, 1, 4997) || '...' ELSE new.message END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.message IS NOT new.message) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents_conversation.message'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS_CONVERSATION
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents_conversation'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.Incidents.conversation' AND entityKey = LENGTH(CAST(old.up__ID AS TEXT)) || ',' || CAST(old.up__ID AS TEXT) || ';' || LENGTH(CAST(old.ID AS TEXT)) || ',' || CAST(old.ID AS TEXT);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'conversation',
			'sap.capire.incidents.Incidents',
			old.up__ID,
			COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = old.up__ID LIMIT 1), old.up__ID),
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Incidents'
			AND entityKey = old.up__ID
			AND attribute = 'conversation'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = old.up__ID
		AND attribute = 'conversation'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Incidents.conversation',
			LENGTH(CAST(old.up__ID AS TEXT)) || ',' || CAST(old.up__ID AS TEXT) || ';' || LENGTH(CAST(old.ID AS TEXT)) || ',' || CAST(old.ID AS TEXT),
			COALESCE((SELECT "$c".author FROM sap_capire_incidents_Incidents_conversation as "$c" WHERE "$c".up__ID = old.up__ID and "$c".ID = old.ID LIMIT 1), LENGTH(CAST(old.up__ID AS TEXT)) || ',' || CAST(old.up__ID AS TEXT) || ';' || LENGTH(CAST(old.ID AS TEXT)) || ',' || CAST(old.ID AS TEXT)),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'message' AS attribute, 
				CASE WHEN LENGTH(old.message) > 5000 THEN SUBSTR(old.message, 1, 4997) || '...' ELSE old.message END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.message IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents_conversation.message'), 'false') != 'true'
		);
    END;
