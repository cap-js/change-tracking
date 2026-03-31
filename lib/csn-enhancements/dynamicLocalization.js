const cds = require('@sap/cds');
const { isChangeTracked, getBaseEntity, getBaseElement } = require('../utils/entity-collector');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

/**
 * Dynamic localization, primarily for code list scenarios, where a status field is change tracked but its localized label should be shown.
 * @param {*} serviceName
 * @param {*} m
 */
function collectTrackedPropertiesWithDynamicLocalization(serviceName, m) {
	const dynamicLocalizationProperties = [];
	for (const name in m.definitions) {
		if (!name.startsWith(serviceName) || m.definitions[name].kind !== 'entity' || !isChangeTracked(m.definitions[name])) {
			continue;
		}
		const entity = m.definitions[name];
		const base = getBaseEntity(entity, m);
		if (!base) continue;
		for (const ele in entity.elements) {
			const element = entity.elements[ele];
			if (!Array.isArray(element['@changelog']) || element['@changelog'].length !== 1 || !element['@changelog'][0]?.['='] || element._foreignKey4) {
				DEBUG?.(`Skipped dynamic localization for '${ele}' on '${name}': Requires exactly one @changelog path entry (not an expression, not a FK).`);
				continue;
			}
			// Skip expression-based annotations (they have xpr property, and = is the source text)
			const changelogEntry = element['@changelog'][0];
			if (typeof changelogEntry['='] !== 'string' || changelogEntry.xpr?.length > 1 || !changelogEntry.xpr?.[0].ref) {
				DEBUG?.(`Skipped dynamic localization for '${ele}' on '${name}': Expression-based @changelog annotations are not eligible for dynamic localization.`);
				continue;
			}
			const segments = changelogEntry['=']?.split('.') || changelogEntry.xpr?.[0].ref;
			const baseEleInfo = getBaseElement(ele, entity, m);
			const basePropertyName = baseEleInfo?.baseElement ?? ele;
			// Managed association target or as fallback unmanaged association target
			const target = element.target ?? m.definitions[base.baseRef ?? name].elements[segments[0]].target;
			const basePropertyInUnmanagedOnCondition = m.definitions[base.baseRef ?? name].elements[segments[0]].on?.some((r) => r.ref && r.ref[0] === basePropertyName);
			const isLocalizedField = m.definitions[target].elements?.[segments[1]]?.localized;
			const amountOfKeys = Object.keys(m.definitions[target].elements).filter((e) => m.definitions[target].elements[e].key).length;
			if (!target || (segments[0] !== basePropertyName && !basePropertyInUnmanagedOnCondition) || segments.length !== 2 || !isLocalizedField || amountOfKeys > 1) {
				DEBUG?.(
					`Dynamic localization lookup is not performed on ${ele} of ${name} for the path "${element['@changelog'][0]['=']}". Only paths which follow the properties association, which only navigate one level deep and where the last property is localized are supported.`
				);
				continue;
			}

			if (!dynamicLocalizationProperties.some((prop) => prop.property === basePropertyName && prop.entity === base.baseRef) && m.definitions[target + '.texts']) {
				dynamicLocalizationProperties.push({
					property: basePropertyName,
					entity: base.baseRef,
					dynamicLabel: SELECT.from(target + '.texts')
						.alias('localizationSubSelect')
						.where('1 = 1')
						.columns(segments[1])
				});
			} else if (!m.definitions[target + '.texts']) {
				LOG.warn(`Cannot dynamically localize ${ele} of ${name} because ${target + '.texts'} is not defined in the CDS model. This might be because the CodeList is a projection.`);
				// Continue to avoid DEBUG log
				continue;
			}
			DEBUG?.(`${ele} of ${name} is change tracked and its logs are visualized using a dynamic localized label lookup targeting ${target + '.texts'} for the label ${segments[1]}.`);
		}
	}
	return dynamicLocalizationProperties;
}

function enhanceChangeViewWithLocalization(serviceName, changeViewName, m) {
	const changeView = m.definitions[changeViewName];
	if (changeView['@changelog.internal.localizationEnhanced']) return;
	DEBUG?.(`Enhance change view ${changeViewName} with dynamic localization setup.`);
	const localizationProperties = collectTrackedPropertiesWithDynamicLocalization(serviceName, m);
	if (!localizationProperties.length) return;
	const changeViewCqn = changeView.projection ?? changeView.query.SELECT;
	changeViewCqn.columns ??= ['*'];
	changeViewCqn.from.as ??= 'change';
	let valueChangedFromLabel = changeViewCqn.columns.find((c) => c.as && c.as === 'valueChangedFromLabel');
	if (!valueChangedFromLabel) {
		changeViewCqn.columns.push({
			cast: { type: 'cds.String' },
			xpr: [{ ref: ['valueChangedFromLabel'] }],
			as: 'valueChangedFromLabel'
		});
		valueChangedFromLabel = changeViewCqn.columns.at(-1);
	}
	let valueChangedToLabel = changeViewCqn.columns.find((c) => c.as && c.as === 'valueChangedToLabel');
	if (!valueChangedToLabel) {
		changeViewCqn.columns.push({
			cast: { type: 'cds.String' },
			xpr: [{ ref: ['valueChangedToLabel'] }],
			as: 'valueChangedToLabel'
		});
		valueChangedToLabel = changeViewCqn.columns.at(-1);
	}
	const originalValueChangedFrom = valueChangedFromLabel.xpr;
	const originalValueChangedTo = valueChangedToLabel.xpr;
	valueChangedFromLabel.xpr = ['case'];
	valueChangedToLabel.xpr = ['case'];
	for (const localizationProp of localizationProperties) {
		valueChangedFromLabel.xpr.push('when', { ref: ['attribute'] }, '=', { val: localizationProp.property }, 'and', { ref: ['entity'] }, '=', { val: localizationProp.entity }, 'then');
		const subSelect = structuredClone(localizationProp.dynamicLabel);
		const keys = Object.keys(m.definitions[localizationProp.dynamicLabel.SELECT.from.ref[0]].elements).filter((e) => e !== 'locale' && m.definitions[localizationProp.dynamicLabel.SELECT.from.ref[0]].elements[e].key);
		subSelect.SELECT.where = [{ ref: [changeViewCqn.from.as, 'valueChangedFrom'] }, '=', { ref: ['localizationSubSelect', keys[0]] }, 'and', { ref: ['localizationSubSelect', 'locale'] }, '=', { ref: ['$user', 'locale'] }];
		valueChangedFromLabel.xpr.push({ func: 'COALESCE', args: [subSelect, { xpr: originalValueChangedFrom }] });

		valueChangedToLabel.xpr.push('when', { ref: ['attribute'] }, '=', { val: localizationProp.property }, 'and', { ref: ['entity'] }, '=', { val: localizationProp.entity }, 'then');
		const subSelect2 = structuredClone(localizationProp.dynamicLabel);
		subSelect2.SELECT.where = [{ ref: [changeViewCqn.from.as, 'valueChangedTo'] }, '=', { ref: ['localizationSubSelect', keys[0]] }, 'and', { ref: ['localizationSubSelect', 'locale'] }, '=', { ref: ['$user', 'locale'] }];
		valueChangedToLabel.xpr.push({ func: 'COALESCE', args: [subSelect2, { xpr: originalValueChangedTo }] });
	}
	valueChangedFromLabel.xpr.push('else', { xpr: originalValueChangedFrom }, 'end');
	valueChangedToLabel.xpr.push('else', { xpr: originalValueChangedTo }, 'end');
	changeView['@changelog.internal.localizationEnhanced'] = true;
}

module.exports = {
	enhanceChangeViewWithLocalization
};
