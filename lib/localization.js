const cds = require("@sap/cds/lib");
const LOG = cds.log("change-log");
const { getNameFromPathVal, getDBEntity } = require("./entity-helper");

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
        const path = change.serviceEntityPath.split('/');
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

const _localizeDates = (change, locale) => {
    if (change.valueDataType === 'cds.Date') {
        const defaultLocale = 'en';
        const normalizedLocale = locale ? locale.replaceAll('_', '-') : defaultLocale;

        const formatOptions = {
            'de': { day: '2-digit', month: '2-digit', year: 'numeric' }, // 15.07.2025
            'en': { day: 'numeric', month: 'short', year: 'numeric' },  // Jul 15, 2025
            'es': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 jul 2025
            'fr': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 juil. 2025
            'it': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 lug 2025
            'ja': { year: 'numeric', month: '2-digit', day: '2-digit' }, // 2025/07/15
            'pl': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 lip 2025
            'pt': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 de jul. de 2025
            'ru': { day: '2-digit', month: 'short', year: 'numeric' },  // 15 июл. 2025 г.
            'zh-CN': { year: 'numeric', month: 'long', day: 'numeric' } // 2025年7月15日
        };

        const options = formatOptions[normalizedLocale] || formatOptions[defaultLocale];

        if (change.valueChangedFrom) {
            change.valueChangedFrom = new Date(change.valueChangedFrom).toLocaleDateString(normalizedLocale, options);
        }
        if (change.valueChangedTo) {
            change.valueChangedTo = new Date(change.valueChangedTo).toLocaleDateString(normalizedLocale, options);
        }
    }
};

const localizeLogFields = function (data, locale) {
    if (!locale) return
    for (const change of data) {
        _localizeModification(change, locale);
        _localizeAttribute(change, locale);
        _localizeEntityType(change, locale);
        _localizeDefaultObjectID(change, locale);
        _localizeDates(change, locale);
    }
};
module.exports = {
    localizeLogFields,
};
