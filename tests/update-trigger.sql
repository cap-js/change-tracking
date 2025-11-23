CREATE OR REPLACE TRIGGER Update_Incidents AFTER UPDATE OF status_code
   ON SAP_CAPIRE_INCIDENTS_INCIDENTS
   REFERENCING NEW ROW new, OLD ROW old
      BEGIN 
         -- Trigger Declaration List
         DECLARE entity CONSTANT NVARCHAR(5000) := 'sap.capire.incidents.Incidents';
         DECLARE serviceEntity CONSTANT NVARCHAR(5000) := 'ProcessorService.Incidents';
         DECLARE entityKey CONSTANT NVARCHAR(5000) := TO_NVARCHAR(:old.ID);
         DECLARE rootEntity CONSTANT NVARCHAR(5000) := NULL;
         DECLARE rootEntityKey CONSTANT NVARCHAR(5000) := NULL;
         DECLARE objectID CONSTANT NVARCHAR(5000) := NULL;
         DECLARE rootObjectID CONSTANT NVARCHAR(5000) := NULL;
         DECLARE modification CONSTANT NVARCHAR(5000) := 'update';
         DECLARE transactionID CONSTANT BIGINT := CURRENT_UPDATE_TRANSACTION();
         
         -- Trigger Statement List
         IF (:old.status_code <> :new.status_code OR :old.status_code IS NULL OR :new.status_code IS NULL) AND NOT (:old.status_code IS NULL AND :new.status_code IS NULL) THEN
            DECLARE v_new_status NVARCHAR(5000);
            DECLARE v_old_status NVARCHAR(5000);
            SELECT descr INTO v_new_status FROM PROCESSORSERVICE_STATUS WHERE code = :new.status_code;
            SELECT descr INTO v_old_status FROM PROCESSORSERVICE_STATUS WHERE code = :old.status_code;
            
            INSERT INTO SAP_CHANGELOG_CHANGES (
                ID,
                attribute,
                valueChangedFrom,
                valueChangedTo,
                entity,
                serviceEntity,
                entityKey,
                rootEntity,
                rootEntityKey,
                objectID,
                rootObjectID,
                modification,
                valueDataType,
                createdAt,
                createdBy,
                transactionID
            ) VALUES (
                SYSUUID,
                'status',
                CASE WHEN LENGTH(:v_old_status) > 5000 THEN LEFT(:v_old_status, 4997) || '...' ELSE :v_old_status END,
                CASE WHEN LENGTH(:v_new_status) > 5000 THEN LEFT(:v_new_status, 4997) || '...' ELSE :v_new_status END,
                :entity,
                :serviceEntity,
                :entityKey,
                :rootEntity,
                :rootEntityKey,
                :objectID,
                :rootObjectID,
                :modification,
                'cds.String',
                CURRENT_TIMESTAMP,
                SESSION_CONTEXT('APPLICATIONUSER'),
                :transactionID
            );
         END IF;
      END;