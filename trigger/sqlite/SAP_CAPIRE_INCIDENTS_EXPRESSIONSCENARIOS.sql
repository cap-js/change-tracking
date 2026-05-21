CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_ExpressionScenarios'), 'false') != 'true')
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
			'sap.capire.incidents.ExpressionScenarios',
			new.ID,
			COALESCE((new.firstName || ' ' || new.lastName), new.ID),
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
			WHERE (new.firstName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.lastName) > 5000 THEN SUBSTR(new.lastName, 1, 4997) || '...' ELSE new.lastName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.lastName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				NULL AS valueChangedFrom, 
				new.price AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(case when new.price < 100 then 'Budget' else 'Premium' end) AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.price IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN new.decimalProp IS NOT NULL THEN PRINTF('%.4f', new.decimalProp) ELSE NULL END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				CASE WHEN (new.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (new.decimalProp * 2)) ELSE NULL END AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.decimalProp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(new.status_code || ': ' || (SELECT "$S".descr as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status_code LIMIT 1)) AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.status_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS_ct_update AFTER UPDATE OF firstName, lastName, price, decimalProp, status_code 
    ON SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_ExpressionScenarios'), 'false') != 'true')
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
			'sap.capire.incidents.ExpressionScenarios',
			new.ID,
			COALESCE((new.firstName || ' ' || new.lastName), new.ID),
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
			WHERE (old.firstName IS NOT new.firstName) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				CASE WHEN LENGTH(old.lastName) > 5000 THEN SUBSTR(old.lastName, 1, 4997) || '...' ELSE old.lastName END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.lastName) > 5000 THEN SUBSTR(new.lastName, 1, 4997) || '...' ELSE new.lastName END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.lastName IS NOT new.lastName) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				old.price AS valueChangedFrom, 
				new.price AS valueChangedTo, 
				(case when old.price < 100 then 'Budget' else 'Premium' end) AS valueChangedFromLabel, 
				(case when new.price < 100 then 'Budget' else 'Premium' end) AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.price IS NOT new.price) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				CASE WHEN old.decimalProp IS NOT NULL THEN PRINTF('%.4f', old.decimalProp) ELSE NULL END AS valueChangedFrom, 
				CASE WHEN new.decimalProp IS NOT NULL THEN PRINTF('%.4f', new.decimalProp) ELSE NULL END AS valueChangedTo, 
				CASE WHEN (old.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (old.decimalProp * 2)) ELSE NULL END AS valueChangedFromLabel, 
				CASE WHEN (new.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (new.decimalProp * 2)) ELSE NULL END AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.decimalProp IS NOT new.decimalProp) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				old.status_code AS valueChangedFrom, 
				new.status_code AS valueChangedTo, 
				(old.status_code || ': ' || (SELECT "$S".descr as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status_code LIMIT 1)) AS valueChangedFromLabel, 
				(new.status_code || ': ' || (SELECT "$S".descr as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status_code LIMIT 1)) AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.status_code IS NOT new.status_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_EXPRESSIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_ExpressionScenarios'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.ExpressionScenarios' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.ExpressionScenarios',
			old.ID,
			COALESCE((old.firstName || ' ' || old.lastName), old.ID),
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
			WHERE (old.firstName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.firstName'), 'false') != 'true'
UNION ALL

			SELECT 
				'lastName' AS attribute, 
				CASE WHEN LENGTH(old.lastName) > 5000 THEN SUBSTR(old.lastName, 1, 4997) || '...' ELSE old.lastName END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.lastName IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.lastName'), 'false') != 'true'
UNION ALL

			SELECT 
				'price' AS attribute, 
				old.price AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(case when old.price < 100 then 'Budget' else 'Premium' end) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.price IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.price'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				CASE WHEN old.decimalProp IS NOT NULL THEN PRINTF('%.4f', old.decimalProp) ELSE NULL END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				CASE WHEN (old.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (old.decimalProp * 2)) ELSE NULL END AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.decimalProp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.decimalProp'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				old.status_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(old.status_code || ': ' || (SELECT "$S".descr as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status_code LIMIT 1)) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.status_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_ExpressionScenarios.status'), 'false') != 'true'
		);
    END;
