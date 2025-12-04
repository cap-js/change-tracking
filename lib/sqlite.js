const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const config = cds.env.requires['change-tracking'];

// Use agnostic cds.ql and cqn2sql rendering
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql');
const SQLiteService = require('@cap-js/sqlite');
const SQLiteCQN2SQL = new SQLiteService.CQN2SQL({ model: cds.model });

function _getObjectID(entity) {
	if (!entity['@changelog']) return [];
	const objectIDs = [];

	for (const { ['=']: field } of entity['@changelog']) {
		if (!field) continue;

		// Validate and normalize the @changelog path
		const normalized = validateChangelogPath(entity, field)
		if (!normalized) continue

		// Direct field
		const element = entity.elements?.[normalized];
		const included = !!element && !element['@Core.Computed'];

		objectIDs.push({ name: normalized, included });
	}
	return objectIDs;
}

function _getObjectIDSelect(objectIDs, entityName, entityKeys, refRow) {
	if (objectIDs.length === 0) return null;
	for (const objectID of objectIDs) {
		if (objectID.included) continue;
		const where = entityKeys.reduce((acc, k) => {
			acc[k] = { val: `${refRow}.${k}` };
			return acc;
		}, {});
		const query = SELECT.one.from(entityName).columns(`{${objectID.name}}`).where(where);
		objectID.selectSQL = _toSQLite(query);
	}

	const objectID = objectIDs.map((id) => (id.included ? `SELECT ${refRow}.${id.name} AS value WHERE ${refRow}.${id.name} IS NOT NULL` : `SELECT (${id.selectSQL}) AS value`)).join('\nUNION ALL\n');

	return `(
    SELECT GROUP_CONCAT(value, ', ')
        FROM (
            ${objectID}
        )
    )`;
}

const _transformedName = (name) => {
	const quoted = cds.env?.sql?.names === 'quoted';
	return quoted ? `"${name}"` : name.replace(/\./g, '_').toUpperCase();
};

function validateChangelogPath(entity, path) {
	const segments = path.split('.');

	if (segments.length === 1) {
		if (!entity.elements[segments[0]]) return null;
		return segments[0];
	}

	let currentEntity = entity;
	const walked = [];

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const element = currentEntity.elements?.[seg];
		if (!element) {
			// Check flattened type elements
			if (currentEntity.elements) {
				const flattened = segments.slice(i).join('_')
				if (currentEntity.elements[flattened]) {
					walked.push(flattened);
					const normalizedPath = walked.join('.');
					return normalizedPath;
				}
				return null;
			}
			LOG.warn(`Invalid @changelog path '${path}' on entity '${entity.name}': '${seg}' not found.\n@changelog skipped.`);
			return null;
		}
		walked.push(seg);

		// Follow traget of association
		if ((element.type === 'cds.Association' || element.type === 'cds.Composition') && element.target) {
			const targetName = element.target
			const targetDef = cds.model.definitions[targetName] || currentEntity.elements?.[seg]?._target
			if (!targetDef || targetDef.kind !== 'entity') {
				return { valid: false, reason: `Association target '${targetName}' not found for '${seg}'` }
			}
			currentEntity = targetDef
			continue
		}
		// Check primitive field
		if (i === segments.length - 1) {
			const normalizedPath = walked.join('.');
			return normalizedPath;
		}
	}
}

function _extractTrackedColumns(entity) {
	const columns = []; // REVISIT throw association away
	for (const col of entity.elements) {
		if (!col['@changelog'] || col._foreignKey4) continue;

		// Do not support compositions to many
		if (col.type === 'cds.Composition' && col.is2many) {
			LOG.warn(`Skipping @changelog for '${col.name}' on entity '${entity.name}': to-many compositions are not supported.`);
			continue;
		};

		const isAssociation = col.target !== undefined; //col.type === 'cds.Association' (include cds.common)

		const entry = {
			name: col.name, // REVISIT: duplicate with attribute?
			attribute: col.name,
			type: col.type
		};

		if (isAssociation) {
			entry.target = col.target;
			if (col['@changelog'].length > 0) {
				entry.alt = [];
				const changelogPaths = col['@changelog'].map((c) => c['=']);
				for (const path of changelogPaths) {
					const validPath = validateChangelogPath(entity, path);
					if (validPath) entry.alt.push(validPath);
				}
				if (entry.alt.length === 0) delete entry.alt;
			}

			if (col.keys) {
				// for managed associations
				entry.foreignKeys = col.keys.flatMap((k) => k.ref);
			} else if (col.on) {
				// for unmanaged associations
				const foreignKeys = [];
				for (const condition of col.on) {
					if (condition.ref && condition.ref.length === 2 && condition.ref[0] === col.name) {
						foreignKeys.push(condition.ref[1]);
					}
				}
				entry.on = foreignKeys;
			}
		}

		columns.push(entry);
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
			foreignKeys = foreignKeys.map((fk) => k.name + '_' + fk);
			keyArray.push(...foreignKeys);
			continue;
		}
		keyArray.push(k.name);
	}
	return keyArray;
}

function generateTriggers(entity) {
	const triggers = [];
	const trackedColumns = _extractTrackedColumns(entity);

	if (!config?.disableCreateTracking) {
		triggers.push(_generateCreateTrigger(entity, trackedColumns));
	}

	// if (!config?.disableUpdateTracking) {
	//     triggers.push(_generateUpdateTrigger(entity, trackedColumns));
	// }

	// if (!config?.disableDeleteTracking) {
	// 	let deleteTrigger = config?.preserveDeletes ? _generateDeleteTriggerPreserve(entity, trackedColumns) : _generateDeleteTriggerCascade(entity);
	// 	triggers.push(deleteTrigger);
	// }
	return triggers;
}

function _toSQLite(query) {
	const sqlCQN = cqn4sql(query, cds.model);
	let sql = SQLiteCQN2SQL.SELECT(sqlCQN);
	return unquoteOldNew(sql);
}

// REVISIT: currently just a workaround
function unquoteOldNew(sql) {
	const regex = /'((?:old|new)\.\w+)'/g;
	return sql.replace(regex, '$1');
}

function buildExpression(columns) {
	const parts = [];
	for (let i = 0; i < columns.length; i++) {
		const ref = { ref: columns[i].split('.') };
		parts.push(ref);
		if (i < columns.length - 1) {
			parts.push('||');
			parts.push({ val: ', ' });
			parts.push('||');
		}
	}
	return { xpr: parts, as: 'value' };
}

function _generateCreateTrigger(entity, columns) {
	const keys = _extractKeys(entity.keys);
	const entityKey = keys.map((k) => `new.${k}`).join(" || '||' || ");

	// Object ID
	const objectIDs = _getObjectID(entity);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const entriesSQL = columns
		.map((col) => {
			let newVal = `new.${col.name}`;
			if (col.target && col.alt) {
				const where = col.foreignKeys
					? col.foreignKeys.reduce((acc, k) => {
						acc[k] = { val: `new.${col.name}_${k}` };
						return acc;
					}, {})
					: col.on.reduce((acc, k) => {
						acc[k] = { val: entityKey };
						return acc;
					}, {});
				const alternatives = col.alt.map(s => s.split('.').slice(1).join('.'));
				const columns = alternatives.length === 1 ? alternatives[0] : buildExpression(alternatives);
				const query = SELECT.one.from(col.target).columns(columns).where(where);
				newVal = `(${_toSQLite(query)})`;
			} else if (col.target) {
				newVal = col.foreignKeys.map((fk) => `new.${col.name}_${fk}`).join(" || '||' || ");
			}

			if (col.type === 'cds.Boolean') {
				newVal = `CASE ${newVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
			}

			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', NULL, ${newVal}, '${entity.name}', ${entityKey}, ${objectID}, session_context('$now'), session_context('$user.id'), '${col.type}', 'create'
        WHERE ${_buildWhereClauseCondition(col, keys, 'new')};`;
		})
		.join('\n');

	return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_create AFTER INSERT
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _buildWhereClauseCondition(col, keys, refRow) {
	if (col.target && col.foreignKeys?.length) {
		return col.foreignKeys.map((fk) => `${refRow}.${col.name}_${fk}`).join(' AND ') + ' IS NOT NULL';
	} else if (col.target && col.on?.length) {
		return keys.map((k) => `${refRow}.${k} IS NOT NULL`).join(' AND ');
	}
	return `${refRow}.${col.name} IS NOT NULL`;
}

function _generateUpdateTrigger(entity, columns) {
	const keys = _extractKeys(entity.keys);
	const entityKey = keys.map((k) => `new.${k}`).join(" || '||' || ");

	// Object ID
	const objectIDs = _getObjectID(entity);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'new') ?? entityKey;

	const entriesSQL = columns
		.map((col) => {
			let oldVal = `old.${col.name}`;
			let newVal = `new.${col.name}`;
			if (col.target) {
				const whereOld = col.foreignKeys
					? col.foreignKeys.reduce((acc, k) => {
						acc[k] = { val: `old.${col.name}_${k}` };
						return acc;
					}, {})
					: col.on.reduce((acc, k) => {
						acc[k] = { val: entityKey };
						return acc;
					}, {});
				const queryOld = SELECT.one.from(col.target).columns(col.alt).where(whereOld);
				oldVal = `(${_toSQLite(queryOld)})`;

				const whereNew = col.foreignKeys
					? col.foreignKeys.reduce((acc, k) => {
						acc[k] = { val: `new.${col.name}_${k}` };
						return acc;
					}, {})
					: col.on.reduce((acc, k) => {
						acc[k] = { val: entityKey };
						return acc;
					}, {});
				const queryNew = SELECT.one.from(col.target).columns(col.alt).where(whereNew);
				newVal = `(${_toSQLite(queryNew)})`; // enclose in parentheses for scalar subquery
			}

			// where clause
			let whereCondition = '';
			if (col.target && col.foreignKeys?.length) {
				whereCondition = col.foreignKeys.map((fk) => `old.${col.name}_${fk} IS NOT new.${col.name}_${fk}`).join(' OR ');
			} else {
				whereCondition = `old.${col.name} IS NOT new.${col.name}`;
			}

			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', ${oldVal}, ${newVal}, '${entity.name}', ${entityKey}, ${objectID}, session_context('$now'), session_context('$user.id'), '${col.type}', 'update'
        WHERE ${whereCondition};`;
		})
		.join('\n');

	// OF columns clause
	const ofColumns = columns.flatMap((c) => (c.target ? c.foreignKeys.map((k) => `${c.name}_${k}`) : [c.name]));
	const ofClause = columns.length > 0 ? `OF ${ofColumns.join(', ')} ` : '';

	return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_update AFTER UPDATE ${ofClause}
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

function _generateDeleteTriggerPreserve(entity, columns) {
	const keys = _extractKeys(entity.keys);
	const entityKey = keys.map((k) => `old.${k}`).join(" || '||' || ");

	// Object ID
	const objectIDs = _getObjectID(entity);
	const objectID = _getObjectIDSelect(objectIDs, entity.name, keys, 'old') ?? entityKey;

	const entriesSQL = columns
		.map((col) => {
			let oldVal = `old.${col.name}`;
			if (col.target && col.alt) {
				const where = col.foreignKeys
					? col.foreignKeys.reduce((acc, k) => {
						acc[k] = { val: `old.${col.name}_${k}` };
						return acc;
					}, {})
					: col.on.reduce((acc, k) => {
						acc[k] = { val: entityKey };
						return acc;
					}, {});

				const query = SELECT.one.from(col.target).columns(col.alt).where(where);
				oldVal = `(${_toSQLite(query)})`;
			} else if (col.target) {
				oldVal = col.foreignKeys.map((fk) => `old.${col.name}_${fk}`).join(" || '||' || ");
			}

			if (col.type === 'cds.Boolean') {
				oldVal = `CASE ${oldVal} WHEN 0 THEN 'false' WHEN 1 THEN 'true' ELSE NULL END`;
			}

			// (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
			return `INSERT INTO sap_changelog_Changes (ID, attribute, valueChangedFrom, valueChangedTo, entity, entityKey, objectID, createdAt, createdBy, valueDataType, modification)
        SELECT
        uuid(), '${col.attribute}', ${oldVal}, NULL, '${entity.name}', ${entityKey}, ${objectID}, session_context('$now'), session_context('$user.id'), '${col.type}', 'delete'
        WHERE ${_buildWhereClauseCondition(col, keys, 'old')};`;
		})
		.join('\n');

	return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_delete AFTER DELETE
    ON ${_transformedName(entity.name)}
    BEGIN
        ${entriesSQL}
    END;`;
}

// Revisit: currently all DELETE tracking is CASCADE and this mean no tracking is created at all
function _generateDeleteTriggerCascade(entity) {
	const keys = _extractKeys(entity.keys);
	const entityKey = keys.map((k) => `old.${k}`).join(" || '||' || ");

	return `CREATE TRIGGER ${_transformedName(entity.name)}_ct_delete AFTER DELETE
    ON ${_transformedName(entity.name)}
    BEGIN
        DELETE FROM ${_transformedName('sap.changelog.Changes')} WHERE entity = '${entity.name}' AND entityKey = ${entityKey};
    END;`;
}

module.exports = {
	generateTriggers
};
