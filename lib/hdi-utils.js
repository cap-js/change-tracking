const cds = require('@sap/cds');
const HANAService = require('@cap-js/hana');
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const config = cds.env.requires["change-tracking"];

const HANACQN2SQL = new HANAService.CQN2SQL();
let model;

const insertChangesSQL = `INSERT INTO SAP_CHANGELOG_CHANGES (
  ID,
  attribute,
  valueChangedFrom,
  valueChangedTo,
  entity,
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
  {{attribute}},
  {{valueChangedFrom}},
  {{valueChangedTo}},
  :entity,
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
);`

function generateTriggersForEntity(csn, entity) {
  model = csn;
  const triggers = [];
  const tableName = _getTableName(entity);
  const columns = _extractTrackedColumns(entity.elements);
  const keys = _extractKeys(entity.keys);
  const objectIDs = _getObjectID(entity);

  // create the triggers
  if (!config?.disableUpdateTracking) {
    const declaration = _generateTriggerDeclaration(tableName, 'update', 'old', keys, null, objectIDs, null)
    const objectIDSQLInit = _getObjectIDSelect(objectIDs, tableName, keys, 'old');
    triggers.push(_generateUpdateTrigger(tableName, columns, declaration, objectIDSQLInit));
  }

  if (!config?.disableCreateTracking) {
    const declaration = _generateTriggerDeclaration(tableName, 'create', 'new', keys, null, objectIDs, null)
    const objectIDSQLInit = _getObjectIDSelect(objectIDs, tableName, keys, 'new');
    triggers.push(_generateCreateTrigger(tableName, columns, declaration, objectIDSQLInit));
  }

  if (!config?.disableDeleteTracking) {
    if (config?.preserveDeletes) {
      const declaration = _generateTriggerDeclaration(tableName, 'delete', 'old', keys, null, objectIDs, null)
      const objectIDSQLInit = _getObjectIDSelect(objectIDs, tableName, keys, 'old');
      triggers.push(_generateDeleteTriggerPreserve(tableName, columns, declaration, objectIDSQLInit));
    } else {
      triggers.push(_generateDeleteTriggerCascade(tableName, keys));
    }
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

const getInsertChangesSQL = (attribute, oldVal, newVal) => {
  return insertChangesSQL
    .replace('{{attribute}}', `'${attribute}'`)
    .replace('{{valueChangedFrom}}', oldVal)
    .replace('{{valueChangedTo}}', newVal);
};

function _generateTriggerDeclaration(tableName, modification, rowRef, keys, rootEntity, objectID, rootObjectID) {
  // Entity Keys
  const entityKey = keys.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ");
  const rootEntityKeys = rootEntity?.map(k => `TO_NVARCHAR(:${rowRef}.${k})`).join(" || '||' || ") || 'NULL';

  // Object IDs
  const objectIDDeclaration = _getObjectIDDeclaration(objectID);

  return `
      -- Trigger Declaration List
      DECLARE entity           CONSTANT NVARCHAR(5000) := '${tableName}';
      DECLARE entityKey        CONSTANT NVARCHAR(5000) := ${entityKey};
      DECLARE rootEntity       CONSTANT NVARCHAR(5000) := ${rootEntity || 'NULL'};
      DECLARE rootEntityKey    CONSTANT NVARCHAR(5000) := ${rootEntityKeys};
      DECLARE modification     CONSTANT NVARCHAR(5000) := '${modification}';
      DECLARE transactionID    CONSTANT BIGINT         := CURRENT_UPDATE_TRANSACTION();
      DECLARE objectID         NVARCHAR(5000);
      DECLARE rootObjectID     NVARCHAR(5000);
      ${objectIDDeclaration}
  `.trim();
}

function considerLargeString(val) {
  // CASE WHEN LENGTH(:val) > 5000 THEN LEFT(:val, 4997) || '...' ELSE :val END
  return val === 'NULL' ? 'NULL' : `CASE WHEN LENGTH(${val}) > 5000 THEN LEFT(${val}, 4997) || '...' ELSE ${val} END`;
}

function _extractTrackedColumns(elements) {
  const columns = [];
  for (const col of elements) {
    if (!col['@changelog']) continue;
    const isAssociation = col.target !== undefined; //col.type === 'cds.Association' (include cds.common)

    columns.push({
      name: col.name,
      attribute: col.name,
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
  const sqlCQN = cqn4sql(query, model);
  let hanaSQL = HANACQN2SQL.SELECT(sqlCQN)
  return removeSingleQuotes(hanaSQL) + ';';
}

// REVISIT: currently just a workaround
function removeSingleQuotes(sql) {
  const regex = /'(:(?:old|new)\.\w+)'/g;
  return sql.replace(regex, '$1');
}

function addInsertTo(sql, name, ref) {
  return sql.replace(/\bSELECT\s+(.*?)\s+FROM\b/i, `SELECT $1 into v_${ref}_${name} FROM`);
}

function _getObjectIDDeclaration(objectIDs) {
  const declarations = objectIDs.map(oi => oi.included ? null : `DECLARE v_objectID_${oi.name} NVARCHAR(5000);`);
  return declarations.join('\n');
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
  const selects = objectIDs.map(oi => {
    if (oi.included) return null;
    const query = SELECT.one.from(entityName).columns(`{ ${oi.name.replaceAll('_', '.')} }`).where(entityKeys.reduce((acc, k) => {
      acc[k] = { val: `:${refRow}.${k}` };
      return acc;
    }, {}));

    let hanaSQL = _toHanaSQL(query);
    hanaSQL = addInsertTo(hanaSQL, oi.name, 'objectID');
    return hanaSQL;
  }).join('\n');

  const objectID = objectIDs.map(id => id.included ? `COALESCE(:${refRow}.${id.name},'')` : `COALESCE(:v_objectID_${id.name},'')`).join(' || ', '');
  return `${selects}
  objectID := ${objectID || ':entityKey'};
  rootObjectID := :rootEntityKey;`;
}

function _generateUpdateTrigger(tableName, columns, triggerDeclaration, objectIDSQLInit) {

  const changesCreation = columns.map(c => {
    // REVISIT: hardcoded type mapping for old and new values -> add lookup for target
    const assocLookUp = c.target
      ? `
      DECLARE v_new_${c.name} NVARCHAR(5000);
      DECLARE v_old_${c.name} NVARCHAR(5000);
      ${handleAssociationLookUp(c, 'new')}
      ${handleAssociationLookUp(c, 'old')}`
      : '';
    const condition = assocLookUp
      ? c.foreignKeys.map(k => _nullSafeChanged(`${c.name}_${k}`)).join(' OR ')
      : _nullSafeChanged(c.name);

    // Define old and new values
    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;
    oldVal = _convertDatetimeTypes(oldVal, c.type);
    newVal = _convertDatetimeTypes(newVal, c.type);
    oldVal = considerLargeString(oldVal);
    newVal = considerLargeString(newVal);

    const insertStatement = getInsertChangesSQL(c.attribute, oldVal, newVal);

    return `IF ${condition} THEN
    ${assocLookUp}
    ${insertStatement}
    END IF;`;
  }).join('\n');

  const ofClauseColumns = [];
  for (const c of columns) {
    if (c.target) ofClauseColumns.push(...c.foreignKeys.map(k => c.name + '_' + k));
    else ofClauseColumns.push(c.name);
  }
  const ofClause = columns.length > 0 ? `OF ${ofClauseColumns.join(', ')} ` : '';

  return {
    name: tableName + '_CT_UPDATE',
    sql: `TRIGGER CT_UPDATE_${_transformedName(tableName)} AFTER UPDATE ${ofClause}
      ON ${_transformedName(tableName)}
      REFERENCING NEW ROW new, OLD ROW old
      BEGIN
        ${triggerDeclaration}
        ${objectIDSQLInit}

        ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function handleAssociationLookUp(column, refRow) {
  const columns = column.alt ?? column.foreignKeys;
  const query = SELECT.one.from(column.target).columns(columns).where(column.foreignKeys.reduce((acc, k) => {
    acc[k] = { val: `:${refRow}.${column.name}_${k}` };
    return acc;
  }, {}));
  let hanaSQL = _toHanaSQL(query);
  return addInsertTo(hanaSQL, column.name, refRow);
}

function _generateCreateTrigger(tableName, columns, triggerDeclarations, objectIDSQLInit) {
  const changesCreation = columns.map(c => {
    const assocLookUp = c.target ? handleAssociationLookUp(c, 'new') : '';

    let newVal = assocLookUp ? `:v_new_${c.name}` : ':new.' + c.name;
    newVal = _convertDatetimeTypes(newVal, c.type);
    newVal = considerLargeString(newVal);

    const insertStatement = getInsertChangesSQL(c.attribute, 'NULL', newVal);

    return assocLookUp + '\n' + insertStatement;
  }).join('\n');

  return {
    name: tableName + '_CT_CREATE',
    sql: `TRIGGER CT_CREATE_${_transformedName(tableName)} AFTER INSERT
    ON ${_transformedName(tableName)}
    REFERENCING NEW ROW new
      BEGIN
      ${triggerDeclarations}
      ${columns.map(c => c.target ? `DECLARE v_new_${c.name} NVARCHAR(5000);` : '').join('\n')}
      ${objectIDSQLInit}

      ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerPreserve(tableName, columns, triggerDeclarations, objectIDSQLInit) {

  const changesCreation = columns.map(c => {
    const assocLookUp = c.target ? handleAssociationLookUp(c, 'old') : '';

    let oldVal = assocLookUp ? `:v_old_${c.name}` : ':old.' + c.name;
    oldVal = _convertDatetimeTypes(oldVal, c.type);
    oldVal = considerLargeString(oldVal);

    const insertStatement = getInsertChangesSQL(c.attribute, oldVal, 'NULL');

    return assocLookUp + '\n' + insertStatement;
  }).join('\n');

  return {
    name: tableName + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(tableName)} AFTER DELETE
    ON ${_transformedName(tableName)}
    REFERENCING OLD ROW old
      BEGIN
        ${triggerDeclarations}
        ${columns.map(c => c.target ? `DECLARE v_old_${c.name} NVARCHAR(5000);` : '').join('\n')}
        ${objectIDSQLInit}

        ${changesCreation}
      END;`,
    suffix: '.hdbtrigger'
  };
}

function _generateDeleteTriggerCascade(tableName, keys) {
  const entityKey = keys.map(k => `TO_NVARCHAR(:old.${k})`).join(" || '||' || ");
  return {
    name: tableName + '_CT_DELETE',
    sql: `TRIGGER CT_DELETE_${_transformedName(tableName)} AFTER DELETE
    ON ${_transformedName(tableName)}
    REFERENCING OLD ROW old
      BEGIN
        DELETE FROM ${_transformedName('sap.changelog.Changes')} WHERE entity = '${tableName}' AND entityKey = ${entityKey};
      END;`,
    suffix: '.hdbtrigger'
  };
}

module.exports = {
  generateTriggersForEntity,
}