CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_ORDERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Orders'), 'false') != 'true')
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
			'sap.capire.incidents.Orders',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'abc' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.abc) > 5000 THEN SUBSTR(new.abc, 1, 4997) || '...' ELSE new.abc END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.abc IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Orders.abc'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERS_ct_update AFTER UPDATE OF abc 
    ON SAP_CAPIRE_INCIDENTS_ORDERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Orders'), 'false') != 'true')
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
			'sap.capire.incidents.Orders',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'abc' AS attribute, 
				CASE WHEN LENGTH(old.abc) > 5000 THEN SUBSTR(old.abc, 1, 4997) || '...' ELSE old.abc END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.abc) > 5000 THEN SUBSTR(new.abc, 1, 4997) || '...' ELSE new.abc END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.abc IS NOT new.abc) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Orders.abc'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_ORDERS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Orders'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.Orders' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Orders',
			old.ID,
			old.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'abc' AS attribute, 
				CASE WHEN LENGTH(old.abc) > 5000 THEN SUBSTR(old.abc, 1, 4997) || '...' ELSE old.abc END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.abc IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Orders.abc'), 'false') != 'true'
		);
    END;
