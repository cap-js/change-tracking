CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_OrderProducts'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'orderProducts',
			'sap.capire.incidents.Orders',
			new.order_ID,
			new.order_ID,
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Orders'
			AND entityKey = new.order_ID
			AND attribute = 'orderProducts'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Orders'
		AND entityKey = new.order_ID
		AND attribute = 'orderProducts'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.OrderProducts',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'country' AS attribute, 
				NULL AS valueChangedFrom, 
				new.country_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = new.country_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$C".name FROM sap_common_Countries as "$C" WHERE "$C".code = new.country_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.country_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.country'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				NULL AS valueChangedFrom, 
				new.price AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Decimal' AS valueDataType 
			WHERE (new.price IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.price'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS_ct_update AFTER UPDATE OF country_code, price 
    ON SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_OrderProducts'), 'false') != 'true')
    BEGIN
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'orderProducts',
			'sap.capire.incidents.Orders',
			new.order_ID,
			new.order_ID,
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Orders'
			AND entityKey = new.order_ID
			AND attribute = 'orderProducts'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Orders'
		AND entityKey = new.order_ID
		AND attribute = 'orderProducts'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.OrderProducts',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'country' AS attribute, 
				old.country_code AS valueChangedFrom, 
				new.country_code AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = old.country_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$C".name FROM sap_common_Countries as "$C" WHERE "$C".code = old.country_code LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = new.country_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$C".name FROM sap_common_Countries as "$C" WHERE "$C".code = new.country_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.country_code IS NOT new.country_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.country'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				old.price AS valueChangedFrom, 
				new.price AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Decimal' AS valueDataType 
			WHERE (old.price IS NOT new.price) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.price'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_ORDERPRODUCTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_OrderProducts'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.OrderProducts' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			'orderProducts',
			'sap.capire.incidents.Orders',
			old.order_ID,
			old.order_ID,
			session_context('$now'),
			session_context('$user.id'),
			'cds.Composition',
			'update',
			session_context('$now')
		WHERE NOT EXISTS (
			SELECT 1 FROM sap_changelog_Changes
			WHERE entity = 'sap.capire.incidents.Orders'
			AND entityKey = old.order_ID
			AND attribute = 'orderProducts'
			AND valueDataType = 'cds.Composition'
			AND transactionID = session_context('$now')
		);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			(SELECT ID FROM sap_changelog_Changes
		WHERE entity = 'sap.capire.incidents.Orders'
		AND entityKey = old.order_ID
		AND attribute = 'orderProducts'
		AND valueDataType = 'cds.Composition'
		AND transactionID = session_context('$now')
		LIMIT 1),
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.OrderProducts',
			old.ID,
			old.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'country' AS attribute, 
				old.country_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_common_Countries_texts as "$t" WHERE "$t".code = old.country_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$C".name FROM sap_common_Countries as "$C" WHERE "$C".code = old.country_code LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.country_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.country'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				old.price AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Decimal' AS valueDataType 
			WHERE (old.price IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_OrderProducts.price'), 'false') != 'true'
		);
    END;
