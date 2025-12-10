const cds = require('@sap/cds')
const LOG = cds.log('change-tracking')

/**
 * Method to validate changelog path on entity
 * Normalizes flattened paths too
 * @param {*} entity CSN entity definition
 * @param {*} path provided changelog path
 * @returns normalized path or null if invalid
 */
function validateChangelogPath(entity, path, model = cds.model) {
    const segments = path.split('.');

    if (segments.length === 1) {
        return entity.elements?.[segments[0]] ? segments[0] : null;
    }

    let currentEntity = entity;
    const walked = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const element = currentEntity.elements?.[seg];
        if (!element) {
            // try flattened tail on current entity
            const flattened = segments.slice(i).join('_')
            if (currentEntity.elements?.[flattened]) {
                walked.push(flattened);
                return walked.join('.');
            }
            LOG.warn(`Invalid @changelog path '${path}' on entity '${entity.name}': '${seg}' not found. @changelog skipped.`)
            return null;
        }
        walked.push(seg);

        // follow association/composition (REVISIT: cds.common? HANA types?)
        if ((element.type === 'cds.Association' || element.type === 'cds.Composition' || element.type === 'Country') && element.target) {
            const targetDef = model.definitions[element.target] || element._target;
            if (!targetDef || targetDef.kind !== 'entity') {
                return null;
            }
            currentEntity = targetDef;
            continue;
        }

        // Check primitive field
        if (i === segments.length - 1) return walked.join('.');
    }
    return null;
}

// REVISIT
// Extract foreign key names from CSN ‘foreignKeys’ array
function extractForeignKeys(keys) {
    if (keys == null) return [];
    const keyArray = [];
    for (const k of keys) {
        keyArray.push(k.name);
    }
    return keyArray;
}

// Extract entity key fields (flatten association keys to <name>_<fk>)
function extractKeys(keys) {
    if (!keys) return [];
    const result = [];
    for (const k of keys) {
        if (k.type === 'cds.Association' && !k._foreignKey4) continue;
        // REVISIT: check different types of compositions declarations
        if (k.type === 'cds.Association') {
            const fks = extractForeignKeys(k.foreignKeys).map(fk => `${k.name}_${fk}`);
            result.push(...fks);
        } else {
            result.push(k.name);
        }
    }
    return result;
}
/**
 * Retrieves changetracking columns from entity definition
 * @param {*} entity CSN entity definition
 * @returns Array of changetracking columns with their details
 */
function extractTrackedColumns(entity, model = cds.model) {
    const columns = [];
    for (const [name, col] of Object.entries(entity.elements)) {
        if (!col['@changelog'] || col._foreignKey4) continue;

        // skip any PersonalData* annotation
        const hasPersonalData = Object.keys(col).some(k => k.startsWith('@PersonalData'))
        if (hasPersonalData) {
            LOG.warn(`Skipping @changelog for '${name}' on entity '${entity.name}': personal data tracking is not supported.`);
            continue;
        }

        // skip compositions of many
        if (col.type === 'cds.Composition' && col.is2many) {
            LOG.warn(`Skipping @changelog for '${name}' on entity '${entity.name}': to-many compositions are not supported.`);
            continue;
        };

        const isAssociation = col.target !== undefined; //col.type === 'cds.Association' (include cds.common)
        const entry = { name: name, type: col.type };

        if (isAssociation) {
            entry.target = col.target;
            if (col['@changelog'].length > 0) {
                const alt = [];
                const changelogPaths = col['@changelog'].map((c) => c['=']);
                for (const path of changelogPaths) {
                    const p = validateChangelogPath(entity, path, model);
                    if (p) alt.push(p);
                }
                if (alt.length > 0) entry.alt = alt;
            }

            if (col.keys) {
                // for managed associations
                entry.foreignKeys = col.keys.flatMap(k => k.ref);
            } else if (col.on) {
                // for unmanaged associations
                const fks = [];
                for (const condition of col.on) {
                    if (condition.ref && condition.ref.length === 2 && condition.ref[0] === name) {
                        fks.push(condition.ref[1]);
                    }
                }
                entry.on = fks;
            }
        }
        columns.push(entry);
    }
    return columns;
}

// Returns candidates from @changelog on entity
function getObjectIDs(entity, model = cds.model) {
    if (!entity['@changelog']) return [];
    const ids = [];

    for (const { ['=']: field } of entity['@changelog']) {
        if (!field) continue;

        // Validate and normalize the @changelog path
        const normalized = validateChangelogPath(entity, field, model);
        if (!normalized) continue

        // Check if the field is directly included or needs to be computed
        const element = entity.elements?.[normalized];
        const included = !!element && !element['@Core.Computed'];
        ids.push({ name: normalized, included });
    }
    return ids;
}

// Join helper for association lookups
// "a || ', ' || b || ', ' || c"
function buildConcatXpr(columns) {
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

const transformName = (name) => {
    const quoted = cds.env?.sql?.names === 'quoted';
    return quoted ? `"${name}"` : name.replace(/\./g, '_').toUpperCase();
};

function getRootBinding(childEntity, rootEntity) {
    for (const element of childEntity.elements) {
        if ((element.type === 'cds.Composition' || element.type === 'cds.Association') && element.target === rootEntity.name) {
            // managed composition: use foreignKeys (names)
            const fks = extractForeignKeys(element.foreignKeys)
            if (fks.length > 0) {
                return fks.map(fk => `${element.name}_${fk}`)
            }
            // fallback: if no explicit foreignKeys, CAP names them as <compName>_<rootKey>
            const rootKeys = rootEntity.elements
                .filter(([, e]) => e.key)
                .map(([k]) => `${element.name}_${k}`)
            if (rootKeys.length > 0) return { compName: element.name, foreignKeys: rootKeys }
        }
    }
    // common CAP default: up__ID references the parent
    if (childEntity.elements?.up__ID) return { compName: 'up', foreignKeys: ['up__ID'] }
    return null
}

module.exports = {
    extractForeignKeys,
    extractKeys,
    extractTrackedColumns,
    getObjectIDs,
    buildConcatXpr,
    transformName,
    getRootBinding
}