const cds = require("@sap/cds");
const getTemplate = require("@sap/cds/libx/_runtime/common/utils/template");
const templateProcessor = require("./utils/template-processor");
const { big } = require("@sap/cds-foss");
const LOG = cds.log("change-history");
const {
    OBJECT_PATH_DELIMITER,
    TX_CONTEXT_PATH_DELIMITER,
    CHANGE_HISTORY_ANNOTATION,
    VALUE_DELIMITER,
} = require("./utils/const");
const {
    getNameFromPathVal,
    getUUIDFromPathVal,
    getCurObjFromReqData,
    getCurObjFromDbQuery,
    getObjectId,
    getDBEntityName,
    isEntityDraftEnabled,
    getEntityByContextPath,
    hasComposition,
    getObjIdElementNamesInArray,
    getAssociationCompositionEntity,
    getValueEntityType,
} = require("./utils/entityHelper");
const { localizeLogFields } = require("./utils/localization");

const _createChangeLog = async function (tx, serviceEntity, entityKey, changes) {
    changes = changes.filter((change) => change.valueChangedFrom || change.valueChangedTo);
    const dbEntity = getDBEntityName(serviceEntity);
    try {
        await tx.run(
            INSERT.into("sap.sme.changelog.ChangeLog").entries({
                entity: dbEntity,
                entityKey: entityKey,
                serviceEntity: serviceEntity,
                changes: changes,
            })
        );
    } catch (e) {
        LOG.error("Failed to create change log", e);
        throw new Error("Failed to create change log", e);
    }
};

const _getRootEntityPathVals = function (txContext, serviceEntity, entityKey) {
    const serviceEntityPathVals = [];
    const entityIDs = _getEntityIDs(txContext.params);

    if (txContext.event === "CREATE") {
        const curEntityPathVal = `${serviceEntity}(${entityKey})`;
        serviceEntityPathVals.push(curEntityPathVal);
    } else {
        // When deleting Composition of one node via REST API in draft-disabled mode,
        // the child node ID would be missing in URI
        if (txContext.event === "DELETE" && !entityIDs.find((x) => x === entityKey)) {
            entityIDs.push(entityKey);
        }
        const curEntity = getEntityByContextPath(txContext.path);
        const curEntityID = entityIDs.pop();
        const curEntityPathVal = `${curEntity.name}(${curEntityID})`;
        serviceEntityPathVals.push(curEntityPathVal);
    }

    let path = txContext.path;

    while (_isCompositionContextPath(path)) {
        const aPath = path.split(TX_CONTEXT_PATH_DELIMITER);
        const hostPath = aPath.slice(0, aPath.length - 1).join(TX_CONTEXT_PATH_DELIMITER);
        const hostEntity = getEntityByContextPath(hostPath);
        const hostEntityID = entityIDs.pop();
        const hostEntityPathVal = `${hostEntity.name}(${hostEntityID})`;

        serviceEntityPathVals.unshift(hostEntityPathVal);
        path = hostPath;
    }

    return serviceEntityPathVals;
};

const _getAllPathVals = function (txContext) {
    const pathVals = [];
    const paths = txContext.path.split(TX_CONTEXT_PATH_DELIMITER);
    const entityIDs = _getEntityIDs(txContext.params);

    for (let idx = 0; idx < paths.length; idx++) {
        const path = paths.slice(0, idx + 1).join(TX_CONTEXT_PATH_DELIMITER);
        const entity = getEntityByContextPath(path);
        const entityID = entityIDs[idx];
        const entityPathVal = `${entity.name}(${entityID})`;

        pathVals.push(entityPathVal);
    }

    return pathVals;
};

const _getEntityIDs = function (txParams) {
    const entityIDs = [];
    for (const param of txParams) {
        let id = "";
        if (typeof param === "object" && !Array.isArray(param)) {
            id = param.ID;
        }
        if (typeof param === "string") {
            id = param;
        }
        if (id) {
            entityIDs.push(id);
        }
    }
    return entityIDs;
};

const _createChangeLogOnEntity = async function (tx, serviceEntity, entityKey, changes) {
    if (!isEntityDraftEnabled(serviceEntity) && _isCompositionContextPath(tx.context.path)) {
        await _createChangeLogForComposition(tx, serviceEntity, entityKey, changes);
        return;
    }

    await _createChangeLog(tx, serviceEntity, entityKey, changes);
};

const _createChangeLogForComposition = async function (tx, serviceEntity, entityKey, changes) {
    const rootEntityPathVals = _getRootEntityPathVals(tx.context, serviceEntity, entityKey);

    if (rootEntityPathVals.length < 2) {
        LOG.info("Parent entity doesn't exist.");
        return;
    }

    const parentEntityPathVal = rootEntityPathVals[rootEntityPathVals.length - 2];
    const parentKey = getUUIDFromPathVal(parentEntityPathVal);
    const serviceEntityPath = rootEntityPathVals.join(OBJECT_PATH_DELIMITER);
    const parentServiceEntityPath = _getAllPathVals(tx.context)
        .slice(0, rootEntityPathVals.length - 2)
        .join(OBJECT_PATH_DELIMITER);

    for (const change of changes) {
        change.parentEntityID = await _getObjectIdByPath(
            tx,
            tx.context.data,
            parentEntityPathVal,
            parentServiceEntityPath
        );
        change.parentKey = parentKey;
        change.serviceEntityPath = serviceEntityPath;
    }

    const rootEntity = getNameFromPathVal(rootEntityPathVals[0]);
    const rootEntityID = getUUIDFromPathVal(rootEntityPathVals[0]);

    await _createChangeLog(tx, rootEntity, rootEntityID, changes);
};

const _deleteTargetObjChangeLog = async function (tx, entityKey) {
    try {
        await tx.run(DELETE.from(`sap.sme.changelog.ChangeLog`).where({ entityKey: entityKey }));
    } catch (e) {
        LOG.error("Failed to delete target object log", e);
        throw new Error("Failed to delete target object log", e);
    }
};

const _pick = (element) => {
    return element[CHANGE_HISTORY_ANNOTATION];
};

/**
 *
 * @param {*} tx
 * @param {*} changes
 *
 * When consuming app implement '@changehistory' on an association element,
 * change history will use attribute on associated entity which are specified instead of default technical foreign key.
 *
 * eg:
 * entity PurchasedProductFootprints    @(cds.autoexpose): cuid, managed {
 * ...
 * '@changehistory': [Plant.identifier]
 * '@mandatory' Plant : Association to one Plant;
 * ...
 * }
 */
const _formatAssociationContext = async function (tx, changes) {
    for (const change of changes) {
        const association = getAssociationCompositionEntity(change.serviceEntity, change.attribute);

        if (association && association.type === "cds.Association") {
            const objIdElements = association[CHANGE_HISTORY_ANNOTATION];
            let objIdElementNames = [];
            if (Array.isArray(objIdElements)) {
                objIdElementNames = getObjIdElementNamesInArray(objIdElements);
            }
            const queryKey = association["@Common.ValueList.viaAssociation"] ? association["keys"][0]["ref"][0] : null;
            await _formatAssociationValue(tx, change, association, objIdElementNames, queryKey);
        }
    }
};

const _formatAssociationValue = async function (tx, change, association, objIdElementNames, queryKey) {
    const curObjFromReqData = {};
    // association entity data from
    let curObjFromDbQuery = await getCurObjFromDbQuery(tx, association.target, change.valueChangedFrom, queryKey);
    const fromObjId = await getObjectId(
        tx,
        association.target,
        { curObjFromReqData, curObjFromDbQuery },
        objIdElementNames
    );

    // association entity data to
    curObjFromDbQuery = await getCurObjFromDbQuery(tx, association.target, change.valueChangedTo, queryKey);
    const toObjId = await getObjectId(
        tx,
        association.target,
        { curObjFromReqData, curObjFromDbQuery },
        objIdElementNames
    );
    change.valueDataType = queryKey ? change.valueDataType : getValueEntityType(association.target, objIdElementNames);
    change.valueChangedFrom = fromObjId ? fromObjId : change.valueChangedFrom;
    change.valueChangedTo = toObjId ? toObjId : change.valueChangedTo;
};

const _getChildChangeObjId = async function (tx, change, childNodeChange, curNodePathVal, reqData) {
    const composition = getAssociationCompositionEntity(change.serviceEntity, change.attribute);

    const objIdElements = composition ? composition[CHANGE_HISTORY_ANNOTATION] : null;
    let objIdElementNames = [];

    if (Array.isArray(objIdElements)) {
        // In this case, the attribute is a composition
        objIdElementNames = getObjIdElementNamesInArray(objIdElements);
    }

    return _getObjectIdByPath(tx, reqData, curNodePathVal, childNodeChange._path, objIdElementNames);
};

const _formatCompositionContext = async function (tx, changes, reqData) {
    const childNodeChanges = [];

    for (const change of changes) {
        if (typeof change.valueChangedTo === "object") {
            if (!Array.isArray(change.valueChangedTo)) {
                change.valueChangedTo = [change.valueChangedTo];
            }
            for (const childNodeChange of change.valueChangedTo) {
                const curChange = Object.assign({}, change);
                const path = childNodeChange._path.split(OBJECT_PATH_DELIMITER);
                const curNodePathVal = path.pop();
                curChange.modification = childNodeChange._op;
                const objId = await _getChildChangeObjId(tx, change, childNodeChange, curNodePathVal, reqData);
                _formatCompositionValue(curChange, objId, childNodeChange, childNodeChanges);
            }
            change.valueChangedTo = undefined;
        }
    }
    changes.push(...childNodeChanges);
};

const _formatCompositionValue = function (curChange, objId, childNodeChange, childNodeChanges) {
    if (curChange.modification === "delete") {
        curChange.valueChangedFrom = objId;
        curChange.valueChangedTo = "";
    } else if (curChange.modification === "update") {
        curChange.valueChangedFrom = objId;
        curChange.valueChangedTo = objId;
    } else {
        curChange.valueChangedFrom = "";
        curChange.valueChangedTo = objId;
    }
    curChange.valueDataType = _formatCompositionEntityType(curChange);
    // Since req.diff() will record the managed data, change history will filter those logs only be changed managed data
    const managedAttrs = ["modifiedAt", "modifiedBy"];
    if (curChange.modification === "update") {
        const rowOldAttrs = Object.keys(childNodeChange._old);
        const diffAttrs = rowOldAttrs.filter((attr) => managedAttrs.indexOf(attr) === -1);
        if (!diffAttrs.length) {
            return;
        }
    }
    childNodeChanges.push(curChange);
};

const _formatCompositionEntityType = function (change) {
    const composition = getAssociationCompositionEntity(change.serviceEntity, change.attribute);
    const objIdElements = composition ? composition[CHANGE_HISTORY_ANNOTATION] : null;
    let objIdElementNames = [];

    if (Array.isArray(objIdElements)) {
        // In this case, the attribute is a composition
        objIdElementNames = getObjIdElementNamesInArray(objIdElements);
        return getValueEntityType(composition.target, objIdElementNames);
    }
    return "";
};

const _processorFn = (changeMap) => {
    return ({ row, key, element }) => {
        if (!row) {
            return;
        }

        const from = row._old && row._old[key] ? row._old[key] : undefined;
        const to = row[key] ? row[key] : undefined;

        if (from === to) {
            return;
        }

        if (element["@odata.foreignKey4"]) {
            key = element["@odata.foreignKey4"];
        }

        const entityName = getDBEntityName(element.parent.name);
        if (!changeMap.has(entityName)) {
            changeMap.set(entityName, []);
        }

        const keys = Object.keys(element.parent.keys)
            .filter((k) => k !== "IsActiveEntity")
            .reduce((acc, cur) => {
                const kval = `${cur}=${row[cur]}`;
                return acc.length === 0 ? kval : `${acc}, ${kval}`;
            }, "");

        changeMap.get(entityName).push({
            serviceEntityPath: row._path,
            entity: entityName,
            serviceEntity: element.parent.name,
            attribute: key,
            valueChangedFrom: from,
            valueChangedTo: to,
            valueDataType: element["type"],
            modification: row._op,
            keys: keys,
        });
    };
};

const _getObjectIdByPath = async function (
    tx,
    reqData,
    nodePathVal,
    serviceEntityPath,
    /**optional*/ objIdElementNames
) {
    const curObjFromReqData = getCurObjFromReqData(reqData, nodePathVal, serviceEntityPath);
    const entityName = getNameFromPathVal(nodePathVal);
    const entityUUID = getUUIDFromPathVal(nodePathVal);
    const curObjFromDbQuery = await getCurObjFromDbQuery(tx, entityName, entityUUID);
    const curObj = { curObjFromReqData, curObjFromDbQuery };
    return getObjectId(tx, entityName, curObj, objIdElementNames);
};

const _formatObjectID = async function (tx, changes, reqData) {
    const objectIdCache = new Map();
    for (const change of changes) {
        const path = change.serviceEntityPath.split(OBJECT_PATH_DELIMITER);
        const curNodePathVal = path.pop();
        const parentNodePathVal = path.pop();

        let curNodeObjId = objectIdCache.get(curNodePathVal);
        if (!curNodeObjId) {
            curNodeObjId = await _getObjectIdByPath(tx, reqData, curNodePathVal, change.serviceEntityPath);
            objectIdCache.set(curNodePathVal, curNodeObjId);
        }

        let parentNodeObjId = objectIdCache.get(parentNodePathVal);
        if (!parentNodeObjId && parentNodePathVal) {
            parentNodeObjId = await _getObjectIdByPath(tx, reqData, parentNodePathVal, change.serviceEntityPath);
            objectIdCache.set(parentNodePathVal, parentNodeObjId);
        }

        change.entityID = curNodeObjId;
        change.parentEntityID = parentNodeObjId;
        change.parentKey = getUUIDFromPathVal(parentNodePathVal);
    }
};

const _isCompositionContextPath = function (contextPath) {
    if (!contextPath) {
        LOG.warn("Failed to get context path");
        return false;
    }
    const aPath = contextPath.split(TX_CONTEXT_PATH_DELIMITER);

    if (aPath.length < 2) {
        return false;
    }

    const parentEntityContextPath = aPath.slice(0, aPath.length - 1).join(TX_CONTEXT_PATH_DELIMITER);
    const curEntity = getEntityByContextPath(contextPath);
    const parentEntity = getEntityByContextPath(parentEntityContextPath);

    return hasComposition(parentEntity, curEntity);
};

const _formatChangeLog = async function (tx, changes, reqData, isExponentialDecimals) {
    await _formatObjectID(tx, changes, reqData);
    await _formatAssociationContext(tx, changes);
    await _formatCompositionContext(tx, changes, reqData);
    _formatChangeValues(changes, isExponentialDecimals);
};

const _formatDecimalValue = function (change) {
    const valueDataTypes = change.valueDataType.split(VALUE_DELIMITER);
    const valueChangedFroms = change.valueChangedFrom.split(VALUE_DELIMITER);
    const valueChangedTos = change.valueChangedTo.split(VALUE_DELIMITER);
    for (const idx in valueDataTypes) {
        if (valueDataTypes[idx] === "cds.Decimal") {
            if (valueChangedFroms[idx]) {
                const bigFrom = big(valueChangedFroms[idx]);
                valueChangedFroms[idx] = bigFrom.toFixed();
            }

            if (valueChangedTos[idx]) {
                const bigTo = big(valueChangedTos[idx]);
                valueChangedTos[idx] = bigTo.toFixed();
            }
        }
    }
    change.valueChangedFrom = valueChangedFroms.join(VALUE_DELIMITER);
    change.valueChangedTo = valueChangedTos.join(VALUE_DELIMITER);
};

const _formatChangeValues = function (changes, isExponentialDecimals) {
    for (const change of changes) {
        change.valueChangedFrom = change.valueChangedFrom ? change.valueChangedFrom + "" : "";
        change.valueChangedTo = change.valueChangedTo ? change.valueChangedTo + "" : "";
        if (!isExponentialDecimals) {
            _formatDecimalValue(change);
        }
    }
};

const _afterReadChangeView = async function (data, req) {
    if (!data) {
        return;
    }

    localizeLogFields(Array.isArray(data) ? data : [data], req.user.locale);
};

const _isExponentialDecimals = function (req) {
    // the service API do not have a req header
    if (req.context.req) {
        const contentType = req.context.req.headers["content-type"];
        if (contentType && contentType.includes("ExponentialDecimals=true")) {
            return true;
        }
    }
    return false;
};

const _logChanges = async function (req) {
    try {
        const tx = cds.transaction(req);
        const serviceEntity = req.target.name;
        const template = getTemplate("change-logging", this, req.target, { pick: _pick });
        const diff = await req.diff();

        if (diff) {
            if (tx.context.event === "DELETE") {
                if (isEntityDraftEnabled(serviceEntity) || !_isCompositionContextPath(tx.context.path)) {
                    await _deleteTargetObjChangeLog(tx, diff.ID);
                    return;
                }
            }

            if (template.elements.size > 0) {
                diff._path = `${req.target.name}(${diff.ID})`;
                const changeMap = new Map();
                const args = { processFn: _processorFn(changeMap), row: diff, template };
                templateProcessor(args);
                for (const value of changeMap.values()) {
                    await _formatChangeLog(tx, value, req.data, _isExponentialDecimals(req));
                    await _createChangeLogOnEntity(tx, serviceEntity, diff.ID, value);
                }
            }
        } else {
            LOG.warn("Failed to get diff");
        }
    } catch (e) {
        LOG.error("Failed to log changes", e);
        throw new Error("Failed to log changes", e);
    }
};

const setup = (services) => {
    for (const srv of services) {
        if (srv instanceof cds.ApplicationService) {
            let hasElementEnabled = false;
            for (const entity of Object.values(srv.entities)) {
                if (Object.values(entity.elements).some((ele) => ele[CHANGE_HISTORY_ANNOTATION])) {
                    cds.db.before("CREATE", entity, _logChanges);
                    cds.db.before("UPDATE", entity, _logChanges);
                    cds.db.before("DELETE", entity, _logChanges);
                    hasElementEnabled = true;
                }
            }
            if (hasElementEnabled && srv.entities.ChangeView) {
                srv.after("READ", srv.entities.ChangeView, _afterReadChangeView);
            }
        }
    }
};

module.exports = {
    setup,
};
