const { isChangeTracked } = require('../utils/entity-collector');

function collectTrackedPropertiesWithTimezone(m) {
	const timezoneProperties = [];
	for (const name in m.definitions) {
		const entity = m.definitions[name];
		if (entity.kind !== 'entity' || entity.query || entity.projection || !isChangeTracked(entity)) {
			continue;
		}
		for (const ele in entity.elements) {
			const element = entity.elements[ele];
			if (!element['@Common.Timezone'] || element._foreignKey4) {
				continue;
			}
			timezoneProperties.push({
				property: ele,
				entity: name,
				timezone: element['@Common.Timezone']?.['=']
					? // Where condition is replaced when select is inserted into ChangeView
						SELECT.from(name).alias('timezoneSubSelect').where('1 = 1').columns(element['@Common.Timezone']['='])
					: element['@Common.Timezone']
			});
		}
	}
	return timezoneProperties;
}

function enhanceChangeViewWithTimeZones(changeView, m) {
	const timezoneProperties = collectTrackedPropertiesWithTimezone(m);
	const timezoneColumn = changeView.query.SELECT.columns.find((c) => c.as && c.as === 'valueTimeZone');
	if (timezoneProperties.length === 0) return;
	delete timezoneColumn.val;
	timezoneColumn.xpr = ['case'];
	for (const timezoneProp of timezoneProperties) {
		timezoneColumn.xpr.push('when', { ref: ['attribute'] }, '=', { val: timezoneProp.property }, 'and', { ref: ['entity'] }, '=', { val: timezoneProp.entity }, 'then');
		if (timezoneProp.timezone.SELECT) {
			const subSelect = structuredClone(timezoneProp.timezone);
			const keys = Object.keys(m.definitions[timezoneProp.entity].elements).filter((e) => m.definitions[timezoneProp.entity].elements[e].key);
			subSelect.SELECT.where = [
				{ ref: ['change', 'entityKey'] },
				'=',
				...keys.reduce((acc, k) => {
					if (acc.length) {
						acc.push('||');
					}
					acc.push({ ref: ['timezoneSubSelect', k] });
					return acc;
				}, [])
			];
			timezoneColumn.xpr.push(subSelect);
		} else {
			timezoneColumn.xpr.push({ val: timezoneProp.timezone });
		}
	}
	timezoneColumn.xpr.push('else', { val: null }, 'end');
}

module.exports = {
	collectTrackedPropertiesWithTimezone,
	enhanceChangeViewWithTimeZones
};
