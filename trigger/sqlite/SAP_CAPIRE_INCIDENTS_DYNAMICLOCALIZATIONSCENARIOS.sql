CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_DynamicLocalizationScenarios'), 'false') != 'true')
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
			'sap.capire.incidents.DynamicLocalizationScenarios',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'status1' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status1_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status1_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr || ', ' || "$S".code as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status1_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.status1_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1'), 'false') != 'true'
UNION ALL

			SELECT 
				'status2' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status2_code AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status2_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status2_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.status2_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2'), 'false') != 'true'
UNION ALL

			SELECT 
				'status3' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status3_code || '||' || new.status3_code2 AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = new.status3_code and "$t".code2 = new.status3_code2 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$V".name FROM sap_capire_incidents_VHWithMultiKey as "$V" WHERE "$V".code = new.status3_code and "$V".code2 = new.status3_code2 LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.status3_code IS NOT NULL OR new.status3_code2 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.status4) > 5000 THEN SUBSTR(new.status4, 1, 4997) || '...' ELSE new.status4 END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.status4 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4Nav' AS attribute, 
				NULL AS valueChangedFrom, 
				new.status4 AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status4 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status4 LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (new.status4 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS_ct_update AFTER UPDATE OF status1_code, status2_code, status3_code, status3_code2, status4 
    ON SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_DynamicLocalizationScenarios'), 'false') != 'true')
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
			'sap.capire.incidents.DynamicLocalizationScenarios',
			new.ID,
			new.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'status1' AS attribute, 
				old.status1_code AS valueChangedFrom, 
				new.status1_code AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status1_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr || ', ' || "$S".code as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status1_code LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status1_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr || ', ' || "$S".code as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status1_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status1_code IS NOT new.status1_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1'), 'false') != 'true'
UNION ALL

			SELECT 
				'status2' AS attribute, 
				old.status2_code AS valueChangedFrom, 
				new.status2_code AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status2_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status2_code LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status2_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status2_code LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status2_code IS NOT new.status2_code) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2'), 'false') != 'true'
UNION ALL

			SELECT 
				'status3' AS attribute, 
				old.status3_code || '||' || old.status3_code2 AS valueChangedFrom, 
				new.status3_code || '||' || new.status3_code2 AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = old.status3_code and "$t".code2 = old.status3_code2 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$V".name FROM sap_capire_incidents_VHWithMultiKey as "$V" WHERE "$V".code = old.status3_code and "$V".code2 = old.status3_code2 LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = new.status3_code and "$t".code2 = new.status3_code2 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$V".name FROM sap_capire_incidents_VHWithMultiKey as "$V" WHERE "$V".code = new.status3_code and "$V".code2 = new.status3_code2 LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status3_code IS NOT new.status3_code OR old.status3_code2 IS NOT new.status3_code2) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4' AS attribute, 
				CASE WHEN LENGTH(old.status4) > 5000 THEN SUBSTR(old.status4, 1, 4997) || '...' ELSE old.status4 END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.status4) > 5000 THEN SUBSTR(new.status4, 1, 4997) || '...' ELSE new.status4 END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.status4 IS NOT new.status4) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4Nav' AS attribute, 
				old.status4 AS valueChangedFrom, 
				new.status4 AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status4 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status4 LIMIT 1))) AS valueChangedFromLabel, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = new.status4 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = new.status4 LIMIT 1))) AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status4 IS NOT new.status4) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_DYNAMICLOCALIZATIONSCENARIOS
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_DynamicLocalizationScenarios'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.DynamicLocalizationScenarios' AND entityKey = old.ID;
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.DynamicLocalizationScenarios',
			old.ID,
			old.ID,
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'status1' AS attribute, 
				old.status1_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr || ', ' || "$t".code as value FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status1_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr || ', ' || "$S".code as value FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status1_code LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status1_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status1'), 'false') != 'true'
UNION ALL

			SELECT 
				'status2' AS attribute, 
				old.status2_code AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status2_code and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status2_code LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status2_code IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status2'), 'false') != 'true'
UNION ALL

			SELECT 
				'status3' AS attribute, 
				old.status3_code || '||' || old.status3_code2 AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".name FROM sap_capire_incidents_VHWithMultiKey_texts as "$t" WHERE "$t".code = old.status3_code and "$t".code2 = old.status3_code2 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$V".name FROM sap_capire_incidents_VHWithMultiKey as "$V" WHERE "$V".code = old.status3_code and "$V".code2 = old.status3_code2 LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status3_code IS NOT NULL OR old.status3_code2 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status3'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4' AS attribute, 
				CASE WHEN LENGTH(old.status4) > 5000 THEN SUBSTR(old.status4, 1, 4997) || '...' ELSE old.status4 END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.status4 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4'), 'false') != 'true'
UNION ALL

			SELECT 
				'status4Nav' AS attribute, 
				old.status4 AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				(SELECT COALESCE((SELECT "$t".descr FROM sap_capire_incidents_Status_texts as "$t" WHERE "$t".code = old.status4 and "$t".locale = session_context('$user.locale') LIMIT 1), (SELECT "$S".descr FROM sap_capire_incidents_Status as "$S" WHERE "$S".code = old.status4 LIMIT 1))) AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.Association' AS valueDataType 
			WHERE (old.status4 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_DynamicLocalizationScenarios.status4Nav'), 'false') != 'true'
		);
    END;
