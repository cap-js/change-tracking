const cds = require('@sap/cds');
const config = cds.env.requires["change-tracking"];

// Parked for REVISIT: Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql')
const SQLiteService = require('@cap-js/sqlite')
const SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model })


// const q = INSERT.into('sap.changelog.Changes').entries({
//     attribute: 'status',
//     valueChangedFrom: 'I',
//     valueChangedTo: 'H',
//     entity: 'sap.capire.incidents.Incidents',
//     entityKey: '3583f982-d7df-4aad-ab26-301d4a157cd7',
//     modification: 'update'
// });

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

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
    const selects = objectIDs.map(async oi => {
        if (oi.included) return null;
        const query = SELECT.one.from(entityName).columns(`{ ${oi.name.replaceAll('_', '.')} }`).where(entityKeys.reduce((acc, k) => {
            acc[k] = { val: `:${refRow}.${k}` };
            return acc;
        }, {}));

        let sql = await SQLiteCQN2SQL(query, cds.model);
        //hanaSQL = addInsertTo(hanaSQL, oi.name, 'objectID');
        return sql;
    }).join('\n');

    const objectID = objectIDs.map(id => id.included ? `COALESCE(:${refRow}.${id.name},'')` : `COALESCE(:v_objectID_${id.name},'')`).join(' || ', '');
    return objectID;
}

const _transformedName = (name) => {
    const quoted = cds.env?.sql?.names === 'quoted';
    return quoted ? `"${name}"` : name.replace(/\./g, '_').toUpperCase();
};

function _extractTrackedColumns(elements) {
    const columns = []; // REVISIT throw association away
    for (const col of elements) {
        if (!col['@changelog'] || col._foreignKey4) continue;
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
        if (k.type === 'cds.Association' && !k._foreignKey4) continue;
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


function generateTriggers(entity) {
    const triggers = [];
    const trackedColumns = _extractTrackedColumns(entity.elements);

    if (!config?.disableCreateTracking) {
        triggers.push(_generateCreateTrigger(entity, trackedColumns));
    }

    if (!config?.disableUpdateTracking) {
        triggers.push(_generateUpdateTrigger(entity, trackedColumns));
    }


    if (!config?.disableDeleteTracking) {
        let deleteTrigger = config?.preserveDeletes
            ? _generateDeleteTriggerPreserve(entity, trackedColumns)
            : _generateDeleteTriggerCascade(entity);
        triggers.push(deleteTrigger);
    }
    return triggers;
}

function _toSQLite(query) {
    const sqlCQN = cqn4sql(query, cds.model);
    let sql = SQLiteCQN2SQL.SELECT(sqlCQN)
    return removeSingleQuotes(sql);
}

// REVISIT: currently just a workaround
function removeSingleQuotes(sql) {
    const regex = /'((?:old|new)\.\w+)'/g;
    return sql.replace(regex, '$1');
}

function _generateCreateTrigger(entity, columns) {

    const keys = _extractKeys(entity.keys);
    const objectIDs = _getObjectID(entity);
    // const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new');
    const objectID = null;
    const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");

    const entriesSQL = columns.map(col => {
        let newVal = `new.${col.name}`;
        if (col.target && col.alt) {
            const query = SELECT.one.from(col.target).columns(col.alt).where(col.foreignKeys.reduce((acc, k) => {
                acc[k] = { val: `new.${col.name}_${k}` };
                return acc;
            }, {}));
            newVal = `(${_toSQLite(query)})`;
        }

        // (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', NULL, ${newVal}, '${entity.name}', ${entityKey}, ${objectID || entityKey}, session_context('$now'), session_context('$user.id'), '${col.type}', 'create'
        WHERE ${_buildWhereClauseCondition(col, 'new')} IS NOT NULL;`;
    }).join('\n');

    return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_create AFTER INSERT
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _buildWhereClauseCondition(col, refRow) {
    if (col.target && col.foreignKeys?.length) {
        return col.foreignKeys.map(fk => `${refRow}.${col.name}_${fk}`).join(' AND ');
    }
    return `${refRow}.${col.name}`;
}

function _generateUpdateTrigger(entity, columns) {

    const keys = _extractKeys(entity.keys);
    const objectIDs = _getObjectID(entity);
    // const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new');
    const objectID = null;
    const entityKey = keys.map(k => `new.${k}`).join(" || '||' || ");

    const entriesSQL = columns.map(col => {
        let oldVal = `old.${col.name}`;
        let newVal = `new.${col.name}`;
        if (col.target && col.alt) {
            const queryOld = SELECT.one.from(col.target).columns(col.alt).where(col.foreignKeys.reduce((acc, k) => {
                acc[k] = { val: `old.${col.name}_${k}` };
                return acc;
            }, {}));
            oldVal = `(${_toSQLite(queryOld)})`;
            const queryNew = SELECT.one.from(col.target).columns(col.alt).where(col.foreignKeys.reduce((acc, k) => {
                acc[k] = { val: `new.${col.name}_${k}` };
                return acc;
            }, {}));
            newVal = `(${_toSQLite(queryNew)})`; // enclose in parentheses for scalar subquery
        }

        // where clause
        let whereCondition = '';
        if (col.target && col.foreignKeys?.length) {
            whereCondition = col.foreignKeys.map(fk => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
        } else {
            whereCondition = `old.${col.name} IS NOT new.${col.name}`;
        }

        // (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', ${oldVal}, ${newVal}, '${entity.name}', ${entityKey}, ${objectID || entityKey}, session_context('$now'), session_context('$user.id'), '${col.type}', 'update'
        WHERE ${whereCondition};`;
    }).join('\n');

    // OF columns clause
    const ofColumns = columns.flatMap(c => c.target ? c.foreignKeys.map(k => `${c.name}_${k}`) : [c.name]);
    const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

    return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _generateDeleteTriggerPreserve(entity, columns) {
    const keys = _extractKeys(entity.keys);
    const objectIDs = _getObjectID(entity);
    // const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new');
    const objectID = null;
    const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");

    const entriesSQL = columns.map(col => {
        let oldVal = `old.${col.name}`;
        if (col.target && col.alt) {
            const query = SELECT.one.from(col.target).columns(col.alt).where(col.foreignKeys.reduce((acc, k) => {
                acc[k] = { val: `old.${col.name}_${k}` };
                return acc;
            }, {}));
            oldVal = `(${_toSQLite(query)})`;
        }
        // (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', ${oldVal}, NULL, '${entity.name}', ${entityKey}, ${objectID || entityKey}, session_context('$now'), session_context('$user.id'), '${col.type}', 'delete';`;
    }).join('\n');

    return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_delete AFTER DELETE
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

// Revisit: currently all DELETE tracking is CASCADE and this mean no tracking is created at all
function _generateDeleteTriggerCascade(entity) {
    const keys = _extractKeys(entity.keys);
    const entityKey = keys.map(k => `old.${k}`).join(" || '||' || ");

    return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_delete AFTER DELETE
    ON ${_transformedName(entity.name)}
    BEGIN
        DELETE FROM ${_transformedName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
    END;`;
}

module.exports = {
    generateTriggers
}