CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_CUSTOMERS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_CUSTOMERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Customers'), 'false') != 'true')
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
			'sap.capire.incidents.Customers',
			new.ID,
			COALESCE((SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.ID LIMIT 1), new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'firstName' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.firstName) > 5000 THEN SUBSTR(new.firstName, 1, 4997) || '...' ELSE new.firstName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.firstName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.lastName) > 5000 THEN SUBSTR(new.lastName, 1, 4997) || '...' ELSE new.lastName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.lastName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'email' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.email) > 5000 THEN SUBSTR(new.email, 1, 4997) || '...' ELSE new.email END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.email IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.email'), 'false') != 'true'
UNION ALL

			SELECT 
				'phone' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.phone) > 5000 THEN SUBSTR(new.phone, 1, 4997) || '...' ELSE new.phone END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.phone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.phone'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_CUSTOMERS_ct_update AFTER UPDATE OF firstName, lastName, email, phone 
    ON SAP_CAPIRE_INCIDENTS_CUSTOMERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Customers'), 'false') != 'true')
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
			'sap.capire.incidents.Customers',
			new.ID,
			COALESCE((SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.ID LIMIT 1), new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'firstName' AS attribute, 
				CASE WHEN LENGTH(old.firstName) > 5000 THEN SUBSTR(old.firstName, 1, 4997) || '...' ELSE old.firstName END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.firstName) > 5000 THEN SUBSTR(new.firstName, 1, 4997) || '...' ELSE new.firstName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.firstName IS NOT new.firstName) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				CASE WHEN LENGTH(old.lastName) > 5000 THEN SUBSTR(old.lastName, 1, 4997) || '...' ELSE old.lastName END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.lastName) > 5000 THEN SUBSTR(new.lastName, 1, 4997) || '...' ELSE new.lastName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.lastName IS NOT new.lastName) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'email' AS attribute, 
				CASE WHEN LENGTH(old.email) > 5000 THEN SUBSTR(old.email, 1, 4997) || '...' ELSE old.email END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.email) > 5000 THEN SUBSTR(new.email, 1, 4997) || '...' ELSE new.email END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.email IS NOT new.email) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.email'), 'false') != 'true'
UNION ALL

			SELECT 
				'phone' AS attribute, 
				CASE WHEN LENGTH(old.phone) > 5000 THEN SUBSTR(old.phone, 1, 4997) || '...' ELSE old.phone END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.phone) > 5000 THEN SUBSTR(new.phone, 1, 4997) || '...' ELSE new.phone END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.phone IS NOT new.phone) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.phone'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_CUSTOMERS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_CUSTOMERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Customers'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.Customers' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Customers',
			old.ID,
			COALESCE((SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = old.ID LIMIT 1), old.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'firstName' AS attribute, 
				CASE WHEN LENGTH(old.firstName) > 5000 THEN SUBSTR(old.firstName, 1, 4997) || '...' ELSE old.firstName END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.firstName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				CASE WHEN LENGTH(old.lastName) > 5000 THEN SUBSTR(old.lastName, 1, 4997) || '...' ELSE old.lastName END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.lastName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'email' AS attribute, 
				CASE WHEN LENGTH(old.email) > 5000 THEN SUBSTR(old.email, 1, 4997) || '...' ELSE old.email END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.email IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.email'), 'false') != 'true'
UNION ALL

			SELECT 
				'phone' AS attribute, 
				CASE WHEN LENGTH(old.phone) > 5000 THEN SUBSTR(old.phone, 1, 4997) || '...' ELSE old.phone END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.phone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Customers.phone'), 'false') != 'true'
		);
    END;
