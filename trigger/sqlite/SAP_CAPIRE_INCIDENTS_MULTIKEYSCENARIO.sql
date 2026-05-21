CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO_ct_create AFTER INSERT
    ON SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_MultiKeyScenario'), 'false') != 'true')
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
			'sap.capire.incidents.MultiKeyScenario',
			LENGTH(CAST(new.GJAHR AS TEXT)) || ',' || CAST(new.GJAHR AS TEXT) || ';' || LENGTH(CAST(new.BUKRS AS TEXT)) || ',' || CAST(new.BUKRS AS TEXT),
			LENGTH(CAST(new.GJAHR AS TEXT)) || ',' || CAST(new.GJAHR AS TEXT) || ';' || LENGTH(CAST(new.BUKRS AS TEXT)) || ',' || CAST(new.BUKRS AS TEXT),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'create',
			session_context('$now')
		FROM (
			
			SELECT 
				'foo1' AS attribute, 
				NULL AS valueChangedFrom, 
				CASE WHEN LENGTH(new.foo1) > 5000 THEN SUBSTR(new.foo1, 1, 4997) || '...' ELSE new.foo1 END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (new.foo1 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				NULL AS valueChangedFrom, 
				new.datetime AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (new.datetime IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO_ct_update AFTER UPDATE OF foo1, datetime 
    ON SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_MultiKeyScenario'), 'false') != 'true')
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
			'sap.capire.incidents.MultiKeyScenario',
			LENGTH(CAST(new.GJAHR AS TEXT)) || ',' || CAST(new.GJAHR AS TEXT) || ';' || LENGTH(CAST(new.BUKRS AS TEXT)) || ',' || CAST(new.BUKRS AS TEXT),
			LENGTH(CAST(new.GJAHR AS TEXT)) || ',' || CAST(new.GJAHR AS TEXT) || ';' || LENGTH(CAST(new.BUKRS AS TEXT)) || ',' || CAST(new.BUKRS AS TEXT),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'update',
			session_context('$now')
		FROM (
			
			SELECT 
				'foo1' AS attribute, 
				CASE WHEN LENGTH(old.foo1) > 5000 THEN SUBSTR(old.foo1, 1, 4997) || '...' ELSE old.foo1 END AS valueChangedFrom, 
				CASE WHEN LENGTH(new.foo1) > 5000 THEN SUBSTR(new.foo1, 1, 4997) || '...' ELSE new.foo1 END AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.foo1 IS NOT new.foo1) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				old.datetime AS valueChangedFrom, 
				new.datetime AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetime IS NOT new.datetime) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime'), 'false') != 'true'
		);
    END;

CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO_ct_delete AFTER DELETE
    ON SAP_CAPIRE_INCIDENTS_MULTIKEYSCENARIO
    WHEN (COALESCE(session_context('ct.skip'), 'false') != 'true' AND COALESCE(session_context('ct.skip_entity.sap_capire_incidents_MultiKeyScenario'), 'false') != 'true')
    BEGIN
        DELETE FROM SAP_CHANGELOG_CHANGES WHERE entity = 'sap.capire.incidents.MultiKeyScenario' AND entityKey = LENGTH(CAST(old.GJAHR AS TEXT)) || ',' || CAST(old.GJAHR AS TEXT) || ';' || LENGTH(CAST(old.BUKRS AS TEXT)) || ',' || CAST(old.BUKRS AS TEXT);
        INSERT INTO sap_changelog_Changes (ID, parent_ID, attribute, valueChangedFrom, valueChangedTo, valueChangedFromLabel, valueChangedToLabel, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification, transactionID)
		SELECT
			hex(randomblob(16)),
			NULL,
			attribute,
			valueChangedFrom,
			valueChangedTo,
			valueChangedFromLabel,
			valueChangedToLabel,
			'sap.capire.incidents.MultiKeyScenario',
			LENGTH(CAST(old.GJAHR AS TEXT)) || ',' || CAST(old.GJAHR AS TEXT) || ';' || LENGTH(CAST(old.BUKRS AS TEXT)) || ',' || CAST(old.BUKRS AS TEXT),
			LENGTH(CAST(old.GJAHR AS TEXT)) || ',' || CAST(old.GJAHR AS TEXT) || ';' || LENGTH(CAST(old.BUKRS AS TEXT)) || ',' || CAST(old.BUKRS AS TEXT),
			session_context('$now'),
			session_context('$user.id'),
			valueDataType,
			'delete',
			session_context('$now')
		FROM (
			
			SELECT 
				'foo1' AS attribute, 
				CASE WHEN LENGTH(old.foo1) > 5000 THEN SUBSTR(old.foo1, 1, 4997) || '...' ELSE old.foo1 END AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.String' AS valueDataType 
			WHERE (old.foo1 IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.foo1'), 'false') != 'true'
UNION ALL

			SELECT 
				'datetime' AS attribute, 
				old.datetime AS valueChangedFrom, 
				NULL AS valueChangedTo, 
				NULL AS valueChangedFromLabel, 
				NULL AS valueChangedToLabel, 
				'cds.DateTime' AS valueDataType 
			WHERE (old.datetime IS NOT NULL) AND COALESCE(session_context('ct.skip_element.sap_capire_incidents_MultiKeyScenario.datetime'), 'false') != 'true'
		);
    END;
