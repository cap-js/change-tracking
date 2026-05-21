CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTTASKS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_INCIDENTTASKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_IncidentTasks'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'tasks',
				'sap.capire.incidents.Incidents',
				new.incident_ID,
				COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = new.incident_ID LIMIT 1), new.incident_ID),
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = new.incident_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = new.incident_ID
				AND attribute = 'tasks'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = new.incident_ID
		AND attribute = 'tasks'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.IncidentTasks',
			new.ID,
			COALESCE(new.title, new.ID),
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
			WHERE (new.title IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.title'), 'false') != 'true'
UNION ALL

			SELECT 
				'description' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.description) > 5000 THEN SUBSTR(new.description, 1, 4997) || '...' ELSE new.description END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.description IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.description'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTTASKS_ct_update AFTER UPDATE OF title, description 
    ON SAP_CAPIRE_INCIDENTS_INCIDENTTASKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_IncidentTasks'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'tasks',
				'sap.capire.incidents.Incidents',
				new.incident_ID,
				COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = new.incident_ID LIMIT 1), new.incident_ID),
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = new.incident_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = new.incident_ID
				AND attribute = 'tasks'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = new.incident_ID
		AND attribute = 'tasks'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.IncidentTasks',
			new.ID,
			COALESCE(new.title, new.ID),
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
			WHERE (old.title IS NOT new.title) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.title'), 'false') != 'true'
UNION ALL

			SELECT 
				'description' AS attribute, 
				CASE WHEN LENGTH(old.description) > 5000 THEN SUBSTR(old.description, 1, 4997) || '...' ELSE old.description END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.description) > 5000 THEN SUBSTR(new.description, 1, 4997) || '...' ELSE new.description END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.description IS NOT new.description) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.description'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTTASKS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_INCIDENTTASKS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_IncidentTasks'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.IncidentTasks' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
			SELECT
				hex(randomblob(16)),
				NULL,
				'tasks',
				'sap.capire.incidents.Incidents',
				old.incident_ID,
				COALESCE((SELECT (customer.firstName || ' ' || customer.lastName) || ': ' || address.city || ' - ' || "$I".title as value FROM sap_capire_incidents_Incidents as "$I" left JOIN sap_capire_incidents_Customers as customer ON customer.ID = "$I".customer_ID left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = customer.ID WHERE "$I".ID = old.incident_ID LIMIT 1), old.incident_ID),
				session_context('$now'),
				session_context('$user.id'),
				'cds.Composition',
				CASE WHEN EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = old.incident_ID
				AND modification = 'create'
				AND transactionID = session_context('$now')
			) THEN 'create' ELSE 'update' END,
				session_context('$now')
			WHERE NOT EXISTS (
				SELECT 1 FROM sap_changelog_Changes
				WHERE entity = 'sap.capire.incidents.Incidents'
				AND entityKey = old.incident_ID
				AND attribute = 'tasks'
				AND valueDataType = 'cds.Composition'
				AND transactionID = session_context('$now')
			);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Incidents'
		AND entityKey = old.incident_ID
		AND attribute = 'tasks'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.IncidentTasks',
			old.ID,
			COALESCE(old.title, old.ID),
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
			WHERE (old.title IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.title'), 'false') != 'true'
UNION ALL

			SELECT 
				'description' AS attribute, 
				CASE WHEN LENGTH(old.description) > 5000 THEN SUBSTR(old.description, 1, 4997) || '...' ELSE old.description END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.description IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_IncidentTasks.description'), 'false') != 'true'
		);
    END;
