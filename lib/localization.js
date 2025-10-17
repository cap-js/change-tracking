const cds = require("@sap/cds/lib");
const LOG = cds.log("change-log");
const { formatOptions } = require("./format-options");
const { getNameFromPathVal, getDBEntity, splitPath } = require("./entity-helper");

const MODIF_I18N_MAP = {
    create: "{i18n>ChangeLog.modification.create}",
    update: "{i18n>ChangeLog.modification.update}",
    delete: "{i18n>ChangeLog.modification.delete}",
};

const _getLocalization = function (locale, i18nKey) {
    //
    //
    //
    //
    //     REVISIT!
    //     REVISIT!
    //     REVISIT!
    //     REVISIT!
    //     REVISIT!
    //
    //
    //
    //
    return JSON.parse(cds.localize(cds.model, locale, JSON.stringify(i18nKey)));
};

const _localizeModification = function (change, locale) {
    if (change.modification && MODIF_I18N_MAP[change.modification]) {
        change.modification = _getLocalization(locale, MODIF_I18N_MAP[change.modification]);
    }
};

const _localizeDefaultObjectID = function (change, locale) {
    if (!change.objectID) {
        change.objectID = change.entity ? change.entity : "";
    }
    if (change.objectID && change.serviceEntityPath && !change.parentObjectID && change.parentKey) {
        const path = splitPath(change.serviceEntityPath);
        const parentNodePathVal = path[path.length - 2];
        const parentEntityName = getNameFromPathVal(parentNodePathVal);
        const dbEntity = getDBEntity(parentEntityName);
        try {
            const labelI18nKey = dbEntity['@Common.Label'] || dbEntity['@title'];
            const labelI18nValue = labelI18nKey ? _getLocalization(locale, labelI18nKey) : null;
            change.parentObjectID = labelI18nValue ? labelI18nValue : dbEntity.name;
        } catch (e) {
            LOG.error("Failed to localize parent object id", e);
            throw new Error("Failed to localize parent object id", e);
        }
    }
};

const _localizeEntityType = function (change, locale) {
    if (change.entity) {
        try {
            const labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity);
            const labelI18nValue = labelI18nKey ? _getLocalization(locale, labelI18nKey) : null;

            change.entity = labelI18nValue ? labelI18nValue : change.entity;
        } catch (e) {
            LOG.error("Failed to localize entity type", e);
            throw new Error("Failed to localize entity type", e);
        }
    }
    if (change.serviceEntity) {
        try {
            const labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity);
            const labelI18nValue = labelI18nKey ? _getLocalization(locale, labelI18nKey) : null;

            change.serviceEntity = labelI18nValue ? labelI18nValue : change.serviceEntity;
        } catch (e) {
            LOG.error("Failed to localize service entity", e);
            throw new Error("Failed to localize service entity", e);
        }
    }
};

const _localizeAttribute = function (change, locale) {
    if (change.attribute && change.serviceEntity) {
        try {
            const serviceEntity = cds.model.definitions[change.serviceEntity];
            let labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity, change.attribute);
            if (!labelI18nKey) {
                const element = serviceEntity.elements[change.attribute];
                if (element.isAssociation) labelI18nKey = _getLabelI18nKeyOnEntity(element.target);
            }
            const labelI18nValue = labelI18nKey ? _getLocalization(locale, labelI18nKey) : null;
            change.attribute = labelI18nValue ? labelI18nValue : change.attribute;
        } catch (e) {
            LOG.error("Failed to localize change attribute", e);
            throw new Error("Failed to localize change attribute", e);
        }
    }
};

const _getLabelI18nKeyOnEntity = function (entityName, /** optinal */ attribute) {
    let def = cds.model.definitions[entityName];
    if (attribute) def = def?.elements[attribute]
    if (!def) return "";
    return def['@Common.Label'] || def['@title'] || def['@UI.HeaderInfo.TypeName'];
};

const parseTime = (time, locale, options) => {
    const timeParts = time.split(':');
    const date = new Date();
    date.setHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), parseInt(timeParts[2], 10));
    return date.toLocaleTimeString(locale, options);
};

const _localizeValue = (change, locale) => {
    if (change.valueDataType !== 'cds.Date' && change.valueDataType !== 'cds.DateTime' && change.valueDataType !== 'cds.Timestamp' && change.valueDataType !== 'cds.Time') {
        return;
    }
    const normalizedLocale = locale.replaceAll('_', '-');
    const options = formatOptions[change.valueDataType]?.[normalizedLocale] 
        ?? formatOptions[change.valueDataType]?.['en']

    if (change.valueDataType === 'cds.Time') {
        if (change.valueChangedFrom) change.valueChangedFrom = parseTime(change.valueChangedFrom, normalizedLocale, options);
        if (change.valueChangedTo) change.valueChangedTo = parseTime(change.valueChangedTo, normalizedLocale, options);
    } else {
        const formatter = change.valueDataType === 'cds.Date' ? 'toLocaleDateString' : 'toLocaleString';
        if (change.valueChangedFrom) change.valueChangedFrom = new Date(change.valueChangedFrom)[formatter](normalizedLocale, options);
        if (change.valueChangedTo) change.valueChangedTo = new Date(change.valueChangedTo)[formatter](normalizedLocale, options);
    }

};

const localizeLogFields = function (data, locale) {
    if (!locale) return
    for (const change of data) {
        _localizeModification(change, locale);
        _localizeAttribute(change, locale);
        _localizeEntityType(change, locale);
        _localizeDefaultObjectID(change, locale);
        _localizeValue(change, locale);
    }
};
module.exports = {
    localizeLogFields,
};
