const cds = require('@sap/cds/lib');

/**
 * Generate i18n label translations for change tracking triggers
 * Used by trigger generators to populate the sap.changelog.i18nKeys table
 */
function getLabelTranslations(entities, model) {
	// Create bundle from the passed model
	const labelBundle = cds.i18n.bundle4(model);
	const allLabels = labelBundle.translations4('all');

	// Get translations for modification texts
	const bundle = cds.i18n.bundle4({ folders: [cds.utils.path.join(__dirname, '..', '_i18n')] });
	const modificationLabels = bundle.translations4('all');

	const rows = new Map();
	const addRow = (ID, locale, text) => {
		const compositeKey = `${ID}::${locale}`;
		rows.set(compositeKey, { ID, locale, text });
	};

	for (const { dbEntityName, mergedAnnotations } of entities) {
		const entity = model.definitions[dbEntityName];

		// Entity labels
		const entityLabelKey = labelBundle.key4(entity);
		if (entityLabelKey && entityLabelKey !== entity.name) {
			for (const [locale, localeTranslations] of Object.entries(allLabels)) {
				if (!locale) continue;
				const text = localeTranslations[entityLabelKey] || entityLabelKey;
				addRow(entity.name, locale, text);
			}
		}

		// Attribute labels
		for (const element of entity.elements) {
			// Use merged annotation if available, otherwise use element's own annotation
			const annotations = mergedAnnotations?.elementAnnotations?.[element.name] ?? element['@changelog'];
			if (!annotations || element._foreignKey4) continue; // REVISIT: skip foreign keys
			const attrKey = labelBundle.key4(element);
			if (attrKey && attrKey !== element.name) {
				for (const [locale, localeTranslations] of Object.entries(allLabels)) {
					if (!locale) continue;
					const text = localeTranslations[attrKey] || attrKey;
					addRow(element.name, locale, text);
				}
			}
		}
	}

	// Modification labels (create, update, delete)
	const MODIF_I18N_MAP = {
		create: 'Changes.modification.create',
		update: 'Changes.modification.update',
		delete: 'Changes.modification.delete'
	};

	for (const [locale, localeTranslations] of Object.entries(modificationLabels)) {
		if (!locale) continue;
		for (const [key, i18nKey] of Object.entries(MODIF_I18N_MAP)) {
			const text = localeTranslations[i18nKey] || key;
			addRow(key, locale, text);
		}
	}

	return Array.from(rows.values());
}

module.exports = {
	getLabelTranslations
};
