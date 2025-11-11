const cds = require('@sap/cds');
const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const config = cds.env.requires["change-tracking"];

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

const MODIF_I18N_MAP = {
  create: "ChangeLog.modification.create",
  update: "ChangeLog.modification.update",
  delete: "ChangeLog.modification.delete",
};

// REVISIT: hardcoded data type mappings
const _changes = `PROCEDURE CREATE_CHANGES (
  in_changeLog_ID   NVARCHAR(36),
  in_attribute      NVARCHAR(5000),
  in_old            NCLOB,
  in_new            NCLOB,
  in_objectID       NVARCHAR(5000),
  in_entity         NVARCHAR(5000),
  in_serviceEntity  NVARCHAR(5000),
  in_parentObjectID NVARCHAR(5000),
  in_parentKey      NVARCHAR(5000),
  in_operation      NVARCHAR(5000)
)
LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  INSERT INTO SAP_CHANGELOG_CHANGES (
    ID,
    attribute,
    valueChangedFrom,
    valueChangedTo,
    objectID,
    entity,
    serviceEntity,
    parentObjectID,
    parentKey,
    modification,
    changeLog_ID
  )
  VALUES (
    SYSUUID,
    :in_attribute,
    :in_old,
    :in_new,
    :in_objectID,
    :in_entity,
    :in_serviceEntity,
    :in_parentObjectID,
    :in_parentKey,
    :in_operation,
    :in_changeLog_ID
  );
END;`

const _change_logs = `PROCEDURE CREATE_CHANGE_LOG (
  in_serviceEntity  NVARCHAR(5000),
  in_dbEntity       NVARCHAR(5000),
  in_entityKey      NVARCHAR(5000),
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
    :in_dbEntity,
    :in_entityKey
  );
END;`

function generateTriggersForEntity(csn, name, def) {
  model = csn;
  const triggers = [];
  const tableName = _getTableName(def); // REVISIT: does CDS provide a util for this?
  const dbName = _transformedName(tableName);
  const columns = _extractTrackedColumns(def.elements);
  const keys = _extractKeys(def.keys);

  // create the triggers
  if (!config?.disableUpdateTracking) {
    triggers.push(_generateUpdateTrigger(def, tableName, dbName, columns, keys));
  }

  if (!config?.disableCreateTracking) {
    triggers.push(_generateCreateTrigger(def, tableName, dbName, columns, keys));
  }

  if (!config?.disableDeleteTracking) {
    const deleteTrigger = config?.preserveDeletes
      ? _generateDeleteTriggerPreserve(def, tableName, dbName, columns, keys)
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

function _simplyfiedPath(chain, attr) {
  let chosenIndex = -1
  for (let i = 0; i < chain.length; i++) {
    const targetDef = chain[i].targetDef
    const cand = targetDef.elements?.[attr]
    if (cand && !cand.isAssociation) { chosenIndex = i; break; }
  }
  if (chosenIndex === -1) return null;

  const simplifiedSegs = [chain[0].seg]
  if (chosenIndex > 0) for (let i = 1; i <= chosenIndex; i++) simplifiedSegs.push(chain[i].seg)
  return [...simplifiedSegs, attr];
}

function _getObjectID(entity) {
  if (!entity['@changelog']) return [];
  const objectIDs = [];

  for (const { ['=']: field } of entity['@changelog']) {
    if (!field) continue;

    // Direct field
    if (entity.elements[field]) {
      if (entity.elements[field]['@Core.Computed']) {
        objectIDs.push({ name: field, included: false });
        continue;
      }
      objectIDs.push({ name: field, included: true });
      continue;
    }

    // Handle possible associations
    const segments = field.split('.');
    const attr = segments[segments.length - 1];

    // Follow the association chain
    let currentEntity = entity;
    const chain = [];
    let broken = false;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const assoc = currentEntity.elements?.[seg];
      if (!assoc?.isAssociation || assoc.isComposition && assoc.is2many) { broken = true; break; }
      const targetDef = assoc._target;
      if (!targetDef) { broken = true; break; }
      chain.push({ seg, assoc, targetDef });
      currentEntity = targetDef;
    }

    if (broken || chain.length === 0) continue;

    const simplifiedPath = _simplyfiedPath(chain, attr);
    if (!simplifiedPath) continue;

    // Attribute is included directly when foreign key of first association
    if (simplifiedPath.length === 2) {
      const assoc = chain[0].assoc;
      const foreignKeys = _extractForeignKeys(assoc.foreignKeys)
      if (foreignKeys.includes(attr)) {
        objectIDs.push({
          name: simplifiedPath.join('_'),
          included: true
        });
      }
    }

    objectIDs.push({
      name: simplifiedPath.join('_'),
      included: false
    });
  }
  return objectIDs;
}

const _convertDatetimeTypes = (val, type) => {
  const datetimeDataTypes = ['cds.Date', 'cds.DateTime', 'cds.Time', 'cds.Timestamp'];
  if (!datetimeDataTypes.includes(type)) return val;
  return `TO_NVARCHAR(${val})`;
}

function _generateTriggerDeclaration(name, tableName, rowRef, keys, parent) {
  const entityKey = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
  const parentKeys = parent?.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ") || 'NULL';

  return `
      DECLARE v_serviceEntity     NVARCHAR(5000) := '${name}';
      DECLARE v_entity            NVARCHAR(5000) := '${tableName}';
      DECLARE v_entityKey         NVARCHAR(5000) := ${entityKey};
      DECLARE v_parentKeyStr      NVARCHAR(5000) := ${parentKeys};
      DECLARE v_change_id         NVARCHAR(36);
  `.trim();
}

function _callChangesProcedure(field, oldVal, newVal, objectID, operation, parentObjectID = 'NULL') {
  // CASE WHEN LENGTH(:val) > 5000 THEN LEFT(:val, 4997) || '...' ELSE :val END
  const o = oldVal === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${oldVal}) > 5000 THEN LEFT(${oldVal}, 4997) || '...' ELSE ${oldVal} END`;
  const n = newVal === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${newVal}) > 5000 THEN LEFT(${newVal}, 4997) || '...' ELSE ${newVal} END`;
  return `
    CALL CREATE_CHANGES(
      :v_change_id,
      '${field}',
      ${o},
      ${n},
      ${objectID || ':v_entityKey'},
      :v_entity,
      :v_serviceEntity,
      ${parentObjectID},
      :v_parentKeyStr,
      '${operation}'
    );
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
  if (keys == null) return [];
  const keyArray = [];
  for (const k of keys) {
    keyArray.push(k.name);
  }
  return keyArray;
}

function _extractKeys(keys) {
  const keyArray = [];
  for (const k of keys) {
    // REVISIT: check different types of compositions declarations
    if (k.type === 'cds.Association') {
      let foreignKeys = _extractForeignKeys(k.foreignKeys);
      foreignKeys = foreignKeys.map(fk => k.name + '_' + fk);
      keyArray.push(...foreignKeys);
      continue;
    }
    keyArray.push(k.name);
  }
  return keyArray;
}

function _nullSafeChanged(column, oldRef = 'old', newRef = 'new') {
  const o = `:${oldRef}.${column}`;
  const n = `:${newRef}.${column}`;
  // (o <> n OR o IS NULL OR n IS NULL) AND NOT (o IS NULL AND n IS NULL)
  return `(${o} <> ${n} OR ${o} IS NULL OR ${n} IS NULL) AND NOT (${o} IS NULL AND ${n} IS NULL)`;
}

function _toHanaSQL(query) {
  return HANACQN2SQL.render(cqn4sql(query, model)).sql;
}

function prepareSqlStatement(sql, name, keys, refRow) {
  const intoRegex = /\bSELECT\s+(.*?)\s+FROM\b/i;
  let transformed = sql.replace(intoRegex, `SELECT $1 into v_objectID_${name} FROM`);

  let index = 0;
  transformed = transformed.replace(/\?/g, () => {
    return `:${refRow}.${keys[index++]}`;
  });
  return transformed;
}

function _getObjectIDDeclaration(objectIDs, entity, refRow) {
  return objectIDs.map(oi => {
    if (oi.included) return null;
    const keys = _extractForeignKeys(entity.keys);
    const query = SELECT.one.from(entity.name).columns(`{ ${oi.name.replaceAll('_', '.')} }`).where(keys.reduce((acc, k) => {
      acc[k] = { val: `:new.${k.name}` };
      return acc;
    }, {}));
    const hanaSQL = prepareSqlStatement(_toHanaSQL(query), oi.name, _extractForeignKeys(entity.keys), refRow);
    return `
      DECLARE v_objectID_${oi.name} NVARCHAR(5000);
      ${hanaSQL};`
  }).join('\n')
}

function _generateUpdateTrigger(entity, tableName, dbName, columns, keys) {
  // Object ID and Parent Object ID handling
  const objectIDs = _getObjectID(entity);
  const objectDeclaration = _getObjectIDDeclaration(objectIDs, entity, 'old');
  const object = `${objectIDs.map(oi => oi.included ? `COALESCE(:old.${oi.name},'')` : `COALESCE(:v_objectID_${oi.name},'')`).join(' || ', '')}`;

  const changesCreation = columns.map(c => {
    // REVISIT: hardcoded type mapping for old and new values -> add lookup for target
    const assocLookUp = c.target && c.alt
      ? `
      DECLARE v_new_${c.name} NVARCHAR(5000);
      DECLARE v_old_${c.name} NVARCHAR(5000);
      SELECT ${c.alt} INTO v_new_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :new.${c.name}_${k}`).join(' AND ')};
      SELECT ${c.alt} INTO v_old_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :old.${c.name}_${k}`).join(' AND ')};`
      : '';
    const condition = assocLookUp
      ? c.foreignKeys.map(k => _nullSafeChanged(`${c.name}_${k}`)).join(' OR ')
      : _nullSafeChanged(c.name);

    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;

    oldVal = _convertDatetimeTypes(oldVal, c.type);
    newVal = _convertDatetimeTypes(newVal, c.type);

    return `IF ${condition} THEN
    ${assocLookUp}\n
    ${_callChangesProcedure(c.attribute, oldVal, newVal, object, 'update', null)}
    END IF;`;
  }).join('\n');

  const ofClauseColumns = [];
  for (const c of columns) {
    if (c.target && c.alt) ofClauseColumns.push(...c.foreignKeys.map(k => c.name + '_' + k));
    else ofClauseColumns.push(c.name);
  }
  const ofClause = columns.length > 0 ? `OF ${ofClauseColumns.join(', ')} ` : '';

  return {
    name: entity.name + '_CT_UPDATE',
    sql: `TRIGGER CT_UPDATE_${_transformedName(entity.name)} AFTER UPDATE ${ofClause}ON ${dbName}
      REFERENCING NEW ROW new, OLD ROW old
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(entity.name, tableName, 'old', keys)}
      ${objectDeclaration}

      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityKey, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateCreateTrigger(entity, tableName, dbName, columns, keys) {
  // Object ID and Parent Object ID handling
  const objectIDs = _getObjectID(entity);
  const objectDeclaration = _getObjectIDDeclaration(objectIDs, entity, 'new');
  const object = `${objectIDs.map(oi => oi.included ? `COALESCE(:new.${oi.name},'')` : `COALESCE(:v_objectID_${oi.name},'')`).join(' || ', '')}`;

  const changesCreation = columns.map(c => {
    const assocLookUp = c.target && c.alt
      ? `SELECT ${c.alt} INTO v_new_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :new.${c.name}_${k}`).join(' AND ')};`
      : '';

    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;
    newVal = _convertDatetimeTypes(newVal, c.type);

    return `${assocLookUp}\n${_callChangesProcedure(c.attribute, 'NULL', newVal, object, 'create')}`;
  }).join('\n');

  return {
    name: entity.name + '_CT_CREATE',
    sql: `TRIGGER CT_CREATE_${_transformedName(entity.name)} AFTER INSERT ON ${dbName}
      REFERENCING NEW ROW new
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(entity.name, tableName, 'new', keys)}
      ${columns.map(c => c.target && c.alt ? `DECLARE v_new_${c.name} NVARCHAR(5000);` : '').join('\n')}
      ${objectDeclaration}
      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityKey, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerPreserve(entity, tableName, dbName, columns, keys) {
  // Object ID and Parent Object ID handling
  const objectIDs = _getObjectID(entity);
  const objectDeclaration = _getObjectIDDeclaration(objectIDs, entity, 'old');
  const object = `${objectIDs.map(oi => oi.included ? `COALESCE(:old.${oi.name},'')` : `COALESCE(:v_objectID_${oi.name},'')`).join(' || ', '')}`; // REVISIT: check old

  const changesCreation = columns.map(c => {
    const assocLookUp = c.target && c.alt
      ? `SELECT ${c.alt} INTO v_old_${c.name} FROM ${_transformedName(c.target)} WHERE ${c.foreignKeys.map(k => `${k} = :old.${c.name}_${k}`).join(' AND ')};`
      : '';

    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    oldVal = _convertDatetimeTypes(oldVal, c.type);

    return `${assocLookUp}\n${_callChangesProcedure(c.attribute, oldVal, 'NULL', object, 'delete')}`;
  }).join('\n');

  return {
    name: entity.name + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(entity.name)} AFTER DELETE ON ${dbName}
      REFERENCING OLD ROW old
      FOR EACH ROW
      BEGIN
      ${_generateTriggerDeclaration(entity.name, tableName, 'old', keys)}
      ${columns.map(c => c.target && c.alt ? `DECLARE v_old_${c.name} NVARCHAR(5000);` : '').join('\n')}
      ${objectDeclaration}
      CALL CREATE_CHANGE_LOG(:v_serviceEntity, :v_entity, :v_entityKey, :v_change_id);

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerCascade(name, tableName, dbName, keys) {
  const entityKey = keys.map(k => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
  return {
    name: name + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(name)} AFTER DELETE ON ${dbName}
      REFERENCING OLD ROW old
      FOR EACH ROW
      BEGIN
      DELETE FROM ${_transformedName('sap.changelog.ChangeLog')} WHERE entity = '${tableName}' AND entityKey = ${entityKey};
      DELETE FROM ${_transformedName('sap.changelog.Changes')} WHERE entity = '${tableName}' AND keys = ${entityKey};
      END;`,
    suffix: '.hdbtrigger'
  };
}

module.exports = {
  _changes,
  _change_logs,
  generateTriggersForEntity,
}