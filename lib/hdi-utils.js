const cds = require('@sap/cds');
const config = cds.env.requires["change-tracking"];

// REVISIT: currently only supports single key entities
// REVISIT: hardcoded data type mappings
const _changes = `PROCEDURE CREATE_CHANGES (
  in_changeLog_ID   NVARCHAR(36),
  in_attribute      NVARCHAR(5000),
  in_old            NCLOB,
  in_new            NCLOB,
  in_entityID       NVARCHAR(5000),
  in_entity         NVARCHAR(5000),
  in_serviceEntity  NVARCHAR(5000),
  in_parentEntityID NVARCHAR(5000),
  in_parentKey      NVARCHAR(36),
  in_operation      NVARCHAR(5000)
)
LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  INSERT INTO SAP_CHANGELOG_CHANGES (
    ID,
    attribute,
    valueChangedFrom,
    valueChangedTo,
    entityID,
    entity,
    serviceEntity,
    parentEntityID,
    parentKey,
    modification,
    changeLog_ID
  )
  VALUES (
    SYSUUID,
    :in_attribute,
    :in_old,
    :in_new,
    :in_entityID,
    :in_entity,
    :in_serviceEntity,
    :in_parentEntityID,
    :in_parentKey,
    :in_operation,
    :in_changeLog_ID
  );
END;`

const _change_logs = `PROCEDURE CREATE_CHANGE_LOG (
  in_serviceEntity  NVARCHAR(5000),
  in_table          NVARCHAR(5000),
  in_row_pk         NVARCHAR(36),
  out change_id     NVARCHAR(36)
)
LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  change_id := SYSUUID;

  INSERT INTO SAP_CHANGELOG_CHANGELOG (
    createdAt,
    createdBy,
    ID,
    serviceEntity,
    entity,
    entityKey
  )
  VALUES (
    CURRENT_TIMESTAMP,
    SESSION_CONTEXT('APPLICATIONUSER'),
    :change_id,
    :in_serviceEntity,
    :in_table,
    :in_row_pk
  );
END;`

function generateTriggersForEntity(name, def) {
  const triggers = [];
  const tableName = _getTableName(def); // REVISIT: does CDS provide a util for this?
  const dbName = _transformedName(tableName);
  const columns = _extractTrackedColumns(def.elements);
  const keys = _extractKeys(def.keys); // REVISIT: composite keys


  // create the triggers
  if (!config?.disableUpdateTracking) {
    triggers.push(
      _generateUpdateTrigger(name, tableName, dbName, columns, keys)
    );
  }

  if (!config?.disableCreateTracking) {
    triggers.push(
      _generateCreateTrigger(name, tableName, dbName, columns, keys)
    );
  }

  if (!config?.disableDeleteTracking) {
    const deleteTrigger = config?.preserveDeletes
      ? _generateDeleteTriggerPreserve(name, tableName, dbName, columns, keys)
      : _generateDeleteTriggerCascade(name, tableName, dbName, keys);

    triggers.push(deleteTrigger);
  }

  return triggers;
}
function _getTableName(entity) {
  const table = entity.query?._target;
  if (table?.query && table?.query?._target) {
    return _getTableName(table);
  }
  return table?.name || entity.name;
}

const _transformedName = (name) => {
  const quoted = cds.env?.sql?.names === 'quoted';
  return quoted ? `"${name}"` : name.replace(/\./g, '_').toUpperCase();
};

// REVISIT 
const _checkDataTypeConversion = (val, type) => {
  if (type === 'cds.Date') return `TO_NVARCHAR(${val}, 'YYYY-MM-DD')`;
  if (type === 'cds.DateTime') return `TO_NVARCHAR(${val}, 'YYYY-MM-DD HH24:MI:SS')`;
  if (type === 'cds.Time') return `TO_NVARCHAR(${val}, 'HH24:MI:SS')`;
  if (type === 'cds.Timestamp') return `TO_NVARCHAR(${val}, 'YYYY-MM-DD HH24:MI:SS.FF')`;
  return val;
}

function _generateTriggerDeclaration(name, tableName, rowRef, keys) {
  // REVISIT: hardcoded type mapping and single key assumption
  return `
      DECLARE v_serviceEntity     NVARCHAR(5000) := '${name}';
      DECLARE v_entity            NVARCHAR(5000) := '${tableName}';
      DECLARE v_entityID          NVARCHAR(5000) := TO_NVARCHAR(:${rowRef}.${keys[0].name});
      DECLARE v_parentEntityID    NVARCHAR(5000) := NULL;
      DECLARE v_parentKeyStr      NVARCHAR(36)   := NULL;
      DECLARE v_change_id         NVARCHAR(36);
  `.trim();
}

function _extractTrackedColumns(elements) {
  const columns = [];
  for (const col of elements) {
    if (!col['@changelog']) continue;
    const isAssociation = col.type === 'cds.Association';

    columns.push({
      name: col.name,
      attribute: col['@title'] || col.name,
      target: isAssociation ? col.target : null,
      type: col.type,
      foreignKeys: isAssociation ? _extractForeignKeys(col.foreignKeys) : null,
      alt: isAssociation && col['@changelog'].length === 1 ? col['@changelog'][0]["="].replace(col.name + '.', '') : null //REVISIT
    });
  }
  return columns;
}

function _extractForeignKeys(keys) {
  const keyArray = [];
  for (const k of keys) {
    keyArray.push(k.name);
  }
  return keyArray;
}

function _extractKeys(keys) {
  const keyArray = [];
  for (const k of keys) {
    keyArray.push({
      name: k.name,
      type: k.type
    });
  }
  return keyArray;
}

function _nullSafeChanged(column, oldRef = 'old', newRef = 'new') {
  const o = `:${oldRef}.${column}`;
  const n = `:${newRef}.${column}`;
  // (o <> n OR o IS NULL OR n IS NULL) AND NOT (o IS NULL AND n IS NULL)
  return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

function _generateUpdateTrigger(name, tableName, dbName, columns, keys) {
  const changesCreation = columns.map(c => {
    // REVISIT: hardcoded type mapping for old and new values -> add lookup for target
    const assocLookUp = c.target && c.alt
      ? `DECLARE v_new_${c.name} NVARCHAR(5000); DECLARE v_old_${c.name} NVARCHAR(5000);
           SELECT ${c.alt} INTO v_new_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :new.${c.name}_${k}`).join(' AND ')};
           SELECT ${c.alt} INTO v_old_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :old.${c.name}_${k}`).join(' AND ')};`
      : '';
    const condition = assocLookUp
      ? c.foreignKeys.map(k => _nullSafeChanged(`${c.name}_${k}`)).join(' OR ')
      : _nullSafeChanged(c.name);

    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;

    oldVal = _checkDataTypeConversion(oldVal, c.type);
    newVal = _checkDataTypeConversion(newVal, c.type);

    return `IF ${condition} THEN
      ${assocLookUp}
      CALL CREATE_CHANGES(
      :v_change_id,
      '${c.attribute}',
      ${oldVal},
      ${newVal},
      :v_entityID,
      :v_entity,
      :v_serviceEntity,
      :v_parentEntityID,
      :v_parentKeyStr,
      'update'
      );
      END IF;`;
  }).join('\n');

  const ofClauseColumns = [];
  for (const c of columns) {
    if (c.target && c.alt) {
      ofClauseColumns.push(...c.foreignKeys.map(k => c.name + '_' + k));
    }
    else ofClauseColumns.push(c.name);
  }

  const ofClause = columns.length > 0
    ? `OF ${ofClauseColumns.join(', ')} `
    : '';

  return {
    name: name + '_CT_UPDATE',
    sql: `TRIGGER CT_UPDATE_${_transformedName(name)} AFTER UPDATE ${ofClause}ON ${dbName}
      REFERENCING NEW ROW new, OLD ROW old
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(name, tableName, 'old', keys)}

      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityID, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateCreateTrigger(name, tableName, dbName, columns, keys) {
  const changesCreation = columns.map(c => {
    const assocLookUp = c.target && c.alt
      ? `SELECT ${c.alt} INTO v_new_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :new.${c.name}_${k}`).join(' AND ')};`
      : '';

    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;
    newVal = _checkDataTypeConversion(newVal, c.type);

    return `${assocLookUp}
      CALL CREATE_CHANGES(
      :v_change_id,
      '${c.attribute}',
      NULL,
      ${newVal},
      :v_entityID,
      :v_entity,
      :v_serviceEntity,
      :v_parentEntityID,
      :v_parentKeyStr,
      'create'
      );`;
  }).join('\n');

  return {
    name: name + '_CT_CREATE',
    sql: `TRIGGER CT_CREATE_${_transformedName(name)} AFTER INSERT ON ${dbName}
      REFERENCING NEW ROW new
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(name, tableName, 'new', keys)}
      ${columns.map(c => c.target && c.alt ? `DECLARE v_new_${c.name} NVARCHAR(5000);` : '').join('\n')}
      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityID, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerPreserve(name, tableName, dbName, columns, keys) {
  const changesCreation = columns.map(c => {
    const assocLookUp = c.target && c.alt
      ? `SELECT ${c.alt} INTO v_old_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :old.${c.name}_${k}`).join(' AND ')};`
      : '';

    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    oldVal = _checkDataTypeConversion(oldVal, c.type);
    
    return `${assocLookUp}
      CALL CREATE_CHANGES(
      :v_change_id,
      '${c.attribute}',
      ${oldVal},
      NULL,
      :v_entityID,
      :v_entity,
      :v_serviceEntity,
      :v_parentEntityID,
      :v_parentKeyStr,
      'delete'
      );`;
  }).join('\n');

  return {
    name: name + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(name)} AFTER DELETE ON ${dbName}
      REFERENCING OLD ROW old
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(name, tableName, 'old', keys)}
      ${columns.map(c => c.target && c.alt ? `DECLARE v_old_${c.name} NVARCHAR(5000);` : '').join('\n')}
      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityID, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerCascade(name, tableName, dbName, keys) {
  return {
    name: name + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(name)} AFTER DELETE ON ${dbName}
      REFERENCING OLD ROW old
      FOR EACH ROW
      BEGIN
      DELETE FROM ${_transformedName('sap.changelog.ChangeLog')} WHERE entity = '${tableName}' AND entityID = TO_NVARCHAR(:old.${keys[0].name});
      DELETE FROM ${_transformedName('sap.changelog.Changes')} WHERE entity = '${tableName}' AND entityID = TO_NVARCHAR(:old.${keys[0].name});
      END;`,
    suffix: '.hdbtrigger'
  };
}

module.exports = {
  _changes,
  _change_logs,
  generateTriggersForEntity,
}