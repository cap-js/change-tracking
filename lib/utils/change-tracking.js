const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');

function isExpression(annotationValue) {
	return annotationValue && !!annotationValue.xpr;
}

/**
 * Method to validate changelog path on entity
 * Normalizes flattened paths too
 * @param {*} entity CSN entity definition
 * @param {*} path provided changelog path
 * @returns normalized path or null if invalid
 */
function validateChangelogPath(entity, path, model = cds.context?.model ?? cds.model) {
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
			const flattened = segments.slice(i).join('_');
			if (currentEntity.elements?.[flattened]) {
				walked.push(flattened);
				return walked.join('.');
			}
			LOG.warn(`Invalid @changelog path '${path}' on entity '${entity.name}': '${seg}' not found. @changelog skipped.`);
			return null;
		}
		walked.push(seg);

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

// Extract foreign key names from CSN ‘foreignKeys’ array
function extractForeignKeys(keys) {
	if (keys == null) return [];
	const keyArray = [];
	for (const k of keys) {
		keyArray.push(k.name);
	}
	return keyArray;
}

function extractFKFieldsFromOnCondition(on, assocName) {
	const fkFields = [];
	for (let i = 0; i < on.length; i++) {
		const cond = on[i];
		if (cond.ref && cond.ref.length === 2 && cond.ref[0] === assocName) {
			if (i + 1 < on.length && on[i + 1] === '=') {
				const fkRef = on[i + 2];
				if (fkRef?.ref) {
					const fkField = fkRef.ref[fkRef.ref.length - 1];
					if (fkField !== '$self') fkFields.push(fkField);
				}
			}
		}
	}
	return fkFields;
}

// Extract entity key fields (flatten association keys to <name>_<fk>)
function extractKeys(keys) {
	if (!keys) return [];
	const result = [];
	for (const k of keys) {
		if (k.type === 'cds.Association' && !k._foreignKey4) continue;
		if (k.type === 'cds.Association') {
			const fks = extractForeignKeys(k.foreignKeys).map((fk) => `${k.name}_${fk}`);
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
 * @param {*} model CSN model (defaults to cds.model)
 * @param {Object|null} overrideAnnotations Optional merged annotations to use instead of entity's own
 * @returns {{ columns: Array, compositionsOfMany: Array }} Object with regular columns and composition of many info
 */
function extractTrackedColumns(entity, model = cds.context?.model ?? cds.model, overrideAnnotations = null) {
	const columns = [];
	const compositionsOfMany = [];

	for (const [name, col] of Object.entries(entity.elements)) {
		// Use override annotation if provided, otherwise use the element's own annotation
		const changelogAnnotation = overrideAnnotations?.elementAnnotations?.[name] ?? col['@changelog'];

		// Skip foreign key columns (we want the generated FKs instead)
		if (col._foreignKey4 || col['@odata.foreignKey4']) continue;

		// Auto-include composition elements, unless explicitly defined with @changelog: false
		const isComposition = col.type === 'cds.Composition';
		if ((!changelogAnnotation && !isComposition) || changelogAnnotation === false) continue;

		// skip any PersonalData* annotation
		const hasPersonalData = Object.keys(col).some((k) => k.startsWith('@PersonalData'));
		if (hasPersonalData) {
			LOG.warn(`Skipped @changelog for ${name} on entity ${entity.name}: Personal data tracking not supported!`);
			continue;
		}

		// Skip unsupported data types (Binary, LargeBinary, Vector)
		const unsupportedTypes = ['cds.LargeBinary', 'cds.Binary', 'cds.Vector'];
		if (unsupportedTypes.includes(col.type)) {
			LOG.warn(`Skipped @changelog for ${name} on entity ${entity.name}: ${col.type} change tracking not supported!`);
			continue;
		}

		const hasChildSideFK = col.type === 'cds.Composition' && (col.is2many || (col.on && col.on.some((c) => c.ref?.includes('$self'))));
		if (hasChildSideFK) {
			const compEntry = {
				name: name,
				target: col.target
			};

			// Extract objectID paths from annotation (e.g., [books.title] -> ['title'])
			if (Array.isArray(changelogAnnotation) && changelogAnnotation.length > 0) {
				const alt = [];
				for (const c of changelogAnnotation) {
					// Skip expressions for composition objectIDs (not supported)
					if (isExpression(c)) continue;
					const path = c['='];
					// Path format is "compositionName.field" (e.g., "books.title")
					// We need to strip the composition prefix and validate on target entity
					const segments = path.split('.');
					if (segments.length >= 2 && segments[0] === name) {
						// Strip the composition name prefix
						const targetPath = segments.slice(1).join('.');
						const targetEntity = model.definitions[col.target];
						if (targetEntity) {
							const validated = validateChangelogPath(targetEntity, targetPath, model);
							if (validated) alt.push(validated);
						}
					}
				}
				if (alt.length > 0) compEntry.alt = alt;
			}

			compositionsOfMany.push(compEntry);
			continue;
		}

		const isAssociation = col.target !== undefined; //REVISIT col.type === 'cds.Association' includes cds.common
		if (isAssociation && col.is2many && col.on) {
			// create trigger that leave values empty
			continue;
		}
		const entry = { name: name, type: col.type };

		if (isAssociation) {
			// Check if association target has a table
			const targetEntity = model.definitions[col.target];
			if (!targetEntity || targetEntity['@cds.persistence.skip'] === true) {
				LOG.warn(`Skipped @changelog for ${name} on entity ${entity.name}: Association target "${col.target}" is annotated with @cds.persistence.skip!`);
				continue;
			}
			entry.target = col.target;
			// Use the resolved changelog annotation (which could be from override)
			if (Array.isArray(changelogAnnotation) && changelogAnnotation.length > 0) {
				// Check if any entry is an expression
				const hasExpressions = changelogAnnotation.some((c) => isExpression(c));
				if (hasExpressions) {
					// Expression mode
					const expressions = [];
					for (const c of changelogAnnotation) {
						if (isExpression(c)) {
							expressions.push(c.xpr);
						}
					}
					if (expressions.length > 0) entry.altExpressions = expressions;
				} else {
					// Path expression
					const alt = [];
					const changelogPaths = changelogAnnotation.map((c) => c['=']);
					for (const path of changelogPaths) {
						const p = validateChangelogPath(entity, path, model);
						if (!p) continue;
						if (p.includes('.')) alt.push({ path: p, source: 'assoc' });
						else alt.push({ path: p, source: 'local' });
					}
					if (alt.length > 0) entry.alt = alt;
				}
			}

			if (col.keys) {
				// for managed associations with generated foreign keys
				entry.foreignKeys = col.keys.flatMap((k) => k.ref);
			} else if (col.on) {
				// for unmanaged associations (multiple conditions possible)
				const mapping = [];
				for (let i = 0; i < col.on.length; i++) {
					const cond = col.on[i];
					if (cond.ref && cond.ref.length === 2 && cond.ref[0] === name) {
						const targetKey = cond.ref[1];
						// next should be '='
						if (i + 1 < col.on.length && col.on[i + 1] === '=') {
							const fkRef = col.on[i + 2];
							if (fkRef?.ref) {
								// get last segement as foreign key field
								const fkField = fkRef.ref[fkRef.ref.length - 1];
								mapping.push({ targetKey, foreignKeyField: fkField });
							}
						}
					}
				}
				if (mapping.length > 0) entry.on = mapping;
			}
		} else if (Array.isArray(changelogAnnotation) && changelogAnnotation.length > 0) {
			// Non-association elements with expression-based @changelog labels
			const hasExpressions = changelogAnnotation.some((c) => isExpression(c));
			if (hasExpressions) {
				const expressions = [];
				for (const c of changelogAnnotation) {
					if (isExpression(c)) {
						expressions.push(c.xpr);
					}
				}
				if (expressions.length > 0) entry.altExpressions = expressions;
			}
		}
		columns.push(entry);
	}
	return { columns, compositionsOfMany };
}

function getObjectIDs(entity, model = cds.context?.model ?? cds.model, overrideEntityAnnotation = null) {
	if (!entity) return [];
	// Use override annotation if provided, otherwise use the entity's own annotation
	const entityAnnotation = overrideEntityAnnotation ?? entity['@changelog'];
	if (!entityAnnotation || entityAnnotation === true) return [];
	const ids = [];

	for (const entry of entityAnnotation) {
		// Check if this is a CDS expression (e.g., @changelog: [(firstName || ' ' || lastName)])
		if (isExpression(entry)) {
			ids.push({ name: entry['='] || '<expression>', expression: entry.xpr, included: false });
			continue;
		}

		const field = entry['='];
		if (!field) continue;

		// Validate and normalize the @changelog path
		const normalized = validateChangelogPath(entity, field, model);
		if (!normalized) continue;

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

/**
 * Checks if an array looks like a CDS ref (array of only plain strings).
 * Distinguishes from xpr arrays which contain mixed token types.
 */
function _isRefArray(arr) {
	return Array.isArray(arr) && arr.length > 0 && arr.every((s) => typeof s === 'string');
}

/**
 * Builds a CQN expression column for use in a SELECT query.
 * Combines multiple expressions with ' || ', ' || ' separators.
 * @param {Array} expressions Array of CDS expressions (xpr arrays or ref arrays)
 * @returns {Object} CQN column object with xpr and alias
 */
function buildExpressionColumn(expressions) {
	if (expressions.length === 1) {
		const expr = expressions[0];
		if (_isRefArray(expr)) {
			return { ref: expr, as: 'value' };
		}
		return { xpr: expr, as: 'value' };
	}
	// Concatenate multiple expressions with ', '
	const combined = [];
	for (let i = 0; i < expressions.length; i++) {
		const expr = expressions[i];
		if (_isRefArray(expr)) {
			combined.push({ ref: expr });
		} else {
			combined.push(...(Array.isArray(expr) ? expr : [expr]));
		}
		if (i < expressions.length - 1) {
			combined.push('||');
			combined.push({ val: ', ' });
			combined.push('||');
		}
	}
	return { xpr: combined, as: 'value' };
}

const transformName = (name) => {
	const quoted = cds.env?.sql?.names === 'quoted';
	return quoted ? `"${name}"` : name.replace(/\./g, '_').toUpperCase();
};

function getRootBinding(childEntity, rootEntity) {
	for (const element of childEntity.elements) {
		if ((element.type === 'cds.Composition' || element.type === 'cds.Association') && element.target === rootEntity.name) {
			// managed composition: use foreignKeys (names)
			const fks = extractForeignKeys(element.foreignKeys);
			if (fks.length > 0) {
				return fks.map((fk) => `${element.name}_${fk}`);
			}
			// unmanaged association: extract FK fields from on condition
			if (element.on) {
				const fkFields = extractFKFieldsFromOnCondition(element.on, element.name);
				if (fkFields.length > 0) return fkFields;
			}
			// fallback: if no explicit foreignKeys, CAP names them as <compName>_<rootKey>
			const rootKeys = Object.entries(rootEntity.elements)
				.filter(([, e]) => e.key)
				.map(([k]) => `${element.name}_${k}`);
			if (rootKeys.length > 0) return { compName: element.name, foreignKeys: rootKeys };
		}
	}
	// Check for up_ link (inline compositions)
	const upElement = childEntity.elements?.up_;
	if (upElement?.type === 'cds.Association') {
		const fks = extractForeignKeys(upElement.foreignKeys);
		if (fks.length > 0) return fks.map((fk) => `up__${fk}`);
	}

	// handle composition of one: root has FK to child
	for (const element of rootEntity.elements) {
		if (element.type === 'cds.Composition' && element.target === childEntity.name && element.is2one) {
			// Get child entity keys to build the reverse lookup
			const childKeys = extractKeys(childEntity.keys);
			if (childKeys.length > 0) {
				return {
					type: 'compositionOfOne',
					compositionName: element.name,
					childKeys: childKeys,
					rootEntityName: rootEntity.name
				};
			}
		}
	}

	return null;
}

/**
 * Gets the FK binding from a composition target entity back to its parent/root entity.
 * Used for composition of many tracking where we need to find the parent's key from the child.
 * @param {*} targetEntity The composition target entity (e.g., Books)
 * @param {*} rootEntity The root/parent entity (e.g., BookStores)
 * @returns {Array|null} Array of FK field names on target that point to root, or null if not found
 */
function getCompositionParentBinding(targetEntity, rootEntity) {
	// Look for association/backlink from target to root
	for (const element of targetEntity.elements) {
		if ((element.type === 'cds.Association' || element.type === 'cds.Composition') && element.target === rootEntity.name) {
			// managed association: use foreignKeys
			const fks = extractForeignKeys(element.foreignKeys);
			if (fks.length > 0) {
				return fks.map((fk) => `${element.name}_${fk}`);
			}
			// unmanaged association: extract FK fields from on condition
			if (element.on) {
				const fkFields = extractFKFieldsFromOnCondition(element.on, element.name);
				if (fkFields.length > 0) return fkFields;
			}
			// fallback: if no explicit foreignKeys, CAP names them as <assocName>_<rootKey>
			const rootKeys = extractKeys(rootEntity.keys);
			if (rootKeys.length > 0) {
				return rootKeys.map((k) => `${element.name}_${k}`);
			}
		}
	}

	// Check for up_ link (inline compositions)
	const upElement = targetEntity.elements?.up_;
	if (upElement?.type === 'cds.Association') {
		const fks = extractForeignKeys(upElement.foreignKeys);
		if (fks.length > 0) return fks.map((fk) => `up__${fk}`);
	}

	// Handle composition of one: root has FK to child (reverse lookup needed)
	for (const element of rootEntity.elements) {
		if (element.type === 'cds.Composition' && element.target === targetEntity.name && element.is2one) {
			// Get child entity keys for the reverse lookup
			const childKeys = extractKeys(targetEntity.keys);
			if (childKeys.length > 0) {
				return {
					type: 'compositionOfOne',
					compositionName: element.name,
					childKeys: childKeys,
					rootEntityName: rootEntity.name
				};
			}
		}
	}

	return null;
}

function getLocalizedLookupInfo(targetEntityName, altFields, model = cds.context?.model ?? cds.model) {
	if (!altFields || altFields.length === 0) return null;
	const targetEntity = model.definitions[targetEntityName];
	if (!targetEntity) return null;

	// Check if target entity has localized data (i.e., a .texts table exists)
	const textsEntityName = `${targetEntityName}.texts`;
	const textsEntity = model.definitions[textsEntityName];
	if (!textsEntity) return null;

	// Get the key fields of the target entity (needed for the texts table join)
	const targetKeys = extractKeys(targetEntity.keys);
	if (targetKeys.length === 0) return null;

	// Check which alt fields are localized on the target entity
	// alt fields are in format "assocName.field" - we need to check if "field" is localized
	const localizedFields = [];
	for (const altField of altFields) {
		const fieldName = altField.split('.').slice(1).join('.');
		if (!fieldName) continue;

		if (textsEntity.elements?.[fieldName]) {
			localizedFields.push(fieldName);
		}
	}

	if (localizedFields.length === 0) return null;

	return {
		textsEntity: textsEntityName,
		localizedFields,
		keys: targetKeys
	};
}

module.exports = {
	isExpression,
	extractForeignKeys,
	extractKeys,
	extractTrackedColumns,
	getObjectIDs,
	buildConcatXpr,
	buildExpressionColumn,
	transformName,
	getRootBinding,
	getCompositionParentBinding,
	getLocalizedLookupInfo
};
