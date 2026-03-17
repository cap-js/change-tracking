const cds = require('@sap/cds');
const { isChangeTracked, getBaseEntity, getBaseElement } = require('../utils/entity-collector');
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
				continue;
			}
			const segments = element['@changelog'][0]['='].split('.');
			const baseEleInfo = getBaseElement(ele, entity, m);
			const basePropertyName = baseEleInfo?.baseElement ?? ele;
			// Managed association target or as fallback unmanaged association target
			const target = element.target ?? m.definitions[base.baseRef ?? name].elements[segments[0]].target;
			if (
				(segments[0] !== basePropertyName && !m.definitions[base.baseRef ?? name].elements[segments[0]].on?.some((r) => r.ref && r.ref[0] === basePropertyName)) ||
				segments.length !== 2 ||
				!m.definitions[target].elements?.[segments[1]].localized ||
				Object.keys(m.definitions[target].elements).filter((e) => m.definitions[target].elements[e].key).length > 1
			) {
				DEBUG &&
					DEBUG(
						`Dynamic localization lookup is not performed on ${ele} of ${name} for the path "${element['@changelog'][0]['=']}". Only paths which follow the properties association, which only navigate one level deep and where the last property is localized are supported.`
					);
				continue;
			}

			dynamicLocalizationProperties.push({
				property: basePropertyName,
				entity: base.baseRef,
				dynamicLabel: SELECT.from(target + '.texts')
					.alias('localizationSubSelect')
					.where('1 = 1')
					.columns(segments[1])
			});
			DEBUG && DEBUG(`${ele} of ${name} is change tracked and its logs are visualized using a dynamic localized label lookup targeting ${target + '.texts'} for the label ${segments[1]}.`);
		}
	}
	return dynamicLocalizationProperties;
}

function enhanceChangeViewWithLocalization(serviceName, changeViewName, m) {
	const changeView = m.definitions[changeViewName];
	if (changeView['@changelog.internal.localizationEnhanced']) return;
	DEBUG && DEBUG(`Enhance change view ${changeViewName} with dynamic localization setup.`);
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
