CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents'), 'false') != 'true')
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
			'sap.capire.incidents.Incidents',
			new.ID,
			COALESCE(((SELECT "$C".firstName || ' ' || "$C".lastName as value FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.customer_ID LIMIT 1) || ': ' || (SELECT address.city as value FROM sap_capire_incidents_Customers as "$C" left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = "$C".ID WHERE "$C".ID = new.customer_ID LIMIT 1) || ' - ' || new.title), new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'customer' AS attribute, 
				NULL AS valueChangedFrom, 
				new.customer_ID AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.customer_ID LIMIT 1) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.customer_ID IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.customer'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.status_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.status'), 'false') != 'true'
UNION ALL

			SELECT 
				'statusExpr' AS attribute, 
				NULL AS valueChangedFrom, 
				new.statusExpr_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.statusExpr_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.statusExpr_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.statusExpr_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.statusExpr'), 'false') != 'true'
UNION ALL

			SELECT 
				'date' AS attribute, 
				NULL AS valueChangedFrom, 
				new.date AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Date' AS valueDataType 
			WHERE (new.date IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.date'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				NULL AS valueChangedFrom, 
				new.datetime AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (new.datetime IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetime'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWTimeZone' AS attribute, 
				NULL AS valueChangedFrom, 
				new.datetimeWTimeZone AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (new.datetimeWTimeZone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWDynamicTimeZone' AS attribute, 
				NULL AS valueChangedFrom, 
				new.datetimeWDynamicTimeZone AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (new.datetimeWDynamicTimeZone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'time' AS attribute, 
				NULL AS valueChangedFrom, 
				new.time AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Time' AS valueDataType 
			WHERE (new.time IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.time'), 'false') != 'true'
UNION ALL

			SELECT 
				'timestamp' AS attribute, 
				NULL AS valueChangedFrom, 
				new.timestamp AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Timestamp' AS valueDataType 
			WHERE (new.timestamp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.timestamp'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN new.decimalProp IS NOT NULL THEN PRINTF('%.4f', new.decimalProp) ELSE NULL END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				CASE WHEN (new.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (new.decimalProp * 2)) ELSE NULL END AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.decimalProp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.decimalProp'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_ct_update AFTER UPDATE OF customer_ID, status_code, statusExpr_code, date, datetime, datetimeWTimeZone, datetimeWDynamicTimeZone, time, timestamp, decimalProp 
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents'), 'false') != 'true')
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
			'sap.capire.incidents.Incidents',
			new.ID,
			COALESCE(((SELECT "$C".firstName || ' ' || "$C".lastName as value FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.customer_ID LIMIT 1) || ': ' || (SELECT address.city as value FROM sap_capire_incidents_Customers as "$C" left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = "$C".ID WHERE "$C".ID = new.customer_ID LIMIT 1) || ' - ' || new.title), new.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'customer' AS attribute, 
				old.customer_ID AS valueChangedFrom, 
				new.customer_ID AS valueChangedTo, 
				(SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = old.customer_ID LIMIT 1) AS valueChangedFromLabel, 
				(SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = new.customer_ID LIMIT 1) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.customer_ID IS NOT new.customer_ID) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.customer'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				old.status_code AS valueChangedFrom, 
				new.status_code AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status_code LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status_code IS NOT new.status_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.status'), 'false') != 'true'
UNION ALL

			SELECT 
				'statusExpr' AS attribute, 
				old.statusExpr_code AS valueChangedFrom, 
				new.statusExpr_code AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.statusExpr_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.statusExpr_code LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.statusExpr_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.statusExpr_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.statusExpr_code IS NOT new.statusExpr_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.statusExpr'), 'false') != 'true'
UNION ALL

			SELECT 
				'date' AS attribute, 
				old.date AS valueChangedFrom, 
				new.date AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Date' AS valueDataType 
			WHERE (old.date IS NOT new.date) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.date'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				old.datetime AS valueChangedFrom, 
				new.datetime AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetime IS NOT new.datetime) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetime'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWTimeZone' AS attribute, 
				old.datetimeWTimeZone AS valueChangedFrom, 
				new.datetimeWTimeZone AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetimeWTimeZone IS NOT new.datetimeWTimeZone) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWDynamicTimeZone' AS attribute, 
				old.datetimeWDynamicTimeZone AS valueChangedFrom, 
				new.datetimeWDynamicTimeZone AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetimeWDynamicTimeZone IS NOT new.datetimeWDynamicTimeZone) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'time' AS attribute, 
				old.time AS valueChangedFrom, 
				new.time AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Time' AS valueDataType 
			WHERE (old.time IS NOT new.time) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.time'), 'false') != 'true'
UNION ALL

			SELECT 
				'timestamp' AS attribute, 
				old.timestamp AS valueChangedFrom, 
				new.timestamp AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Timestamp' AS valueDataType 
			WHERE (old.timestamp IS NOT new.timestamp) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.timestamp'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				CASE WHEN old.decimalProp IS NOT NULL THEN PRINTF('%.4f', old.decimalProp) ELSE NULL END AS valueChangedFrom, 
				CASE WHEN new.decimalProp IS NOT NULL THEN PRINTF('%.4f', new.decimalProp) ELSE NULL END AS valueChangedTo, 
				CASE WHEN (old.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (old.decimalProp * 2)) ELSE NULL END AS valueChangedFromLabel, 
				CASE WHEN (new.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (new.decimalProp * 2)) ELSE NULL END AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.decimalProp IS NOT new.decimalProp) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.decimalProp'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_INCIDENTS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_INCIDENTS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_Incidents'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.Incidents' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.Incidents',
			old.ID,
			COALESCE(((SELECT "$C".firstName || ' ' || "$C".lastName as value FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = old.customer_ID LIMIT 1) || ': ' || (SELECT address.city as value FROM sap_capire_incidents_Customers as "$C" left JOIN sap_capire_incidents_Addresses as address ON address.customer_ID = "$C".ID WHERE "$C".ID = old.customer_ID LIMIT 1) || ' - ' || old.title), old.ID),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'customer' AS attribute, 
				old.customer_ID AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT "$C".firstName || ' ' || "$C".lastName as name FROM sap_capire_incidents_Customers as "$C" WHERE "$C".ID = old.customer_ID LIMIT 1) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.customer_ID IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.customer'), 'false') != 'true'
UNION ALL

			SELECT 
				'status' AS attribute, 
				old.status_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status_code LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.status'), 'false') != 'true'
UNION ALL

			SELECT 
				'statusExpr' AS attribute, 
				old.statusExpr_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.statusExpr_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.statusExpr_code LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.statusExpr_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.statusExpr'), 'false') != 'true'
UNION ALL

			SELECT 
				'date' AS attribute, 
				old.date AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Date' AS valueDataType 
			WHERE (old.date IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.date'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				old.datetime AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetime IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetime'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWTimeZone' AS attribute, 
				old.datetimeWTimeZone AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetimeWTimeZone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetimeWDynamicTimeZone' AS attribute, 
				old.datetimeWDynamicTimeZone AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetimeWDynamicTimeZone IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.datetimeWDynamicTimeZone'), 'false') != 'true'
UNION ALL

			SELECT 
				'time' AS attribute, 
				old.time AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Time' AS valueDataType 
			WHERE (old.time IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.time'), 'false') != 'true'
UNION ALL

			SELECT 
				'timestamp' AS attribute, 
				old.timestamp AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Timestamp' AS valueDataType 
			WHERE (old.timestamp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.timestamp'), 'false') != 'true'
UNION ALL

			SELECT 
				'decimalProp' AS attribute, 
				CASE WHEN old.decimalProp IS NOT NULL THEN PRINTF('%.4f', old.decimalProp) ELSE NULL END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				CASE WHEN (old.decimalProp * 2) IS NOT NULL THEN PRINTF('%.4f', (old.decimalProp * 2)) ELSE NULL END AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.decimalProp IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_Incidents.decimalProp'), 'false') != 'true'
		);
    END;
