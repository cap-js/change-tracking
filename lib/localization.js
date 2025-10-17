const cds = require("@sap/cds/lib");
const LOG = cds.log("change-log");
const { formatOptions } = require("./format-options");
const { getNameFromPathVal, getDBEntity, splitPath } = require("./entity-helper");

const MODIF_I18N_MAP = {
    create: "ChangeLog.modification.create",
    update: "ChangeLog.modification.update",
    delete: "ChangeLog.modification.delete",
};

const _localizeModification = function (change) {
    if (change.modification && MODIF_I18N_MAP[change.modification]) {
        change.modification = cds.i18n.labels.for(MODIF_I18N_MAP[change.modification]);
    }
};

const _localizeDefaultObjectID = function (change) {
    if (!change.objectID) {
        change.objectID = change.entity ? change.entity : "";
    }
    if (change.objectID && change.serviceEntityPath && !change.parentObjectID && change.parentKey) {
        const path = splitPath(change.serviceEntityPath);
        const parentNodePathVal = path[path.length - 2];
        const parentEntityName = getNameFromPathVal(parentNodePathVal);
        const dbEntity = getDBEntity(parentEntityName);
        try {
            const labelI18nKey = getTranslationKey(dbEntity['@Common.Label'] || dbEntity['@title']);
            change.parentObjectID = cds.i18n.labels.for(labelI18nKey) || labelI18nKey || dbEntity.name;
        } catch (e) {
            LOG.error("Failed to localize parent object id", e);
            throw new Error("Failed to localize parent object id", e);
        }
    }
};

const _localizeEntityType = function (change) {
    if (change.entity) {
        try {
            const labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity);
            change.entity = labelI18nKey || change.entity;
        } catch (e) {
            LOG.error("Failed to localize entity type", e);
            throw new Error("Failed to localize entity type", e);
        }
    }
    if (change.serviceEntity) {
        try {
            const labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity);
            change.serviceEntity = labelI18nKey || change.serviceEntity;
        } catch (e) {
            LOG.error("Failed to localize service entity", e);
            throw new Error("Failed to localize service entity", e);
        }
    }
};

const getTranslationKey = (value) => {
    if (typeof value != 'string') return value;
    const result = value.match(/(?<=\{@?(i18n>)).*(?=\})/g) //REVISIT, what is allowed for i18n as key?
    return result ? result[0] : value
}

const _localizeAttribute = function (change) {
    if (change.attribute && change.serviceEntity) {
        try {
            const serviceEntity = cds.model.definitions[change.serviceEntity];
            let labelI18nKey = _getLabelI18nKeyOnEntity(change.serviceEntity, change.attribute);
            if (!labelI18nKey) {
                const element = serviceEntity.elements[change.attribute];
                if (element.isAssociation) labelI18nKey = _getLabelI18nKeyOnEntity(element.target);
            }
            change.attribute = labelI18nKey || change.attribute;
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
    const i18nKey = getTranslationKey(def['@Common.Label'] || def['@title'] || def['@UI.HeaderInfo.TypeName']);
    return cds.i18n.labels.for(i18nKey) || i18nKey;
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
        _localizeModification(change);
        _localizeAttribute(change);
        _localizeEntityType(change);
        _localizeDefaultObjectID(change);
        _localizeValue(change, locale);
    }
};
module.exports = {
    localizeLogFields,
};
