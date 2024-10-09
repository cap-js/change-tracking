const cds = require("@sap/cds")
const getTemplate = require("@sap/cds/libx/_runtime/common/utils/template") // REVISIT: bad usage of internal stuff
const templateProcessor = require("./template-processor")
const LOG = cds.log("change-log")

const {
  getNameFromPathVal,
  getUUIDFromPathVal,
  getCurObjFromReqData,
  getCurObjFromDbQuery,
  getObjectId,
  getDBEntity,
  getEntityByContextPath,
  getObjIdElementNamesInArray,
  getValueEntityType,
} = require("./entity-helper")

const {
  getKey,
  stringifyKey,
  stringifyPath,
  getAssociationKey,
} = require("./keys")
const { localizeLogFields } = require("./localization")
const isRoot = "change-tracking-isRootEntity"


const _getRootEntityPathVals = function (txContext, entity, entityKey) {
  const serviceEntityPathVals = []
  const entityIDs = [...txContext.params]

  let path = [...txContext.path]

  if (txContext.event === "CREATE") {
    const curEntityPathVal = {target: entity.name, key: entityKey};
    serviceEntityPathVals.push(curEntityPathVal)
    txContext.hasComp && entityIDs.pop();
  } else {
    // When deleting Composition of one node via REST API in draft-disabled mode,
    // the child node ID would be missing in URI
    if (txContext.event === "DELETE" && !entityIDs.find(p => JSON.stringify(p) === JSON.stringify(entityKey))) {
      entityIDs.push(entityKey)
    }
    const curEntity = getEntityByContextPath(path, txContext.hasComp)
    const curEntityID = entityIDs.pop()
    const curEntityPathVal = {target: curEntity.name, key: curEntityID}
    serviceEntityPathVals.push(curEntityPathVal)
  }


  while (_isCompositionContextPath(path, txContext.hasComp)) {
    const hostEntity = getEntityByContextPath(path = path.slice(0, -1), txContext.hasComp)
    const hostEntityID = entityIDs.pop()
    const hostEntityPathVal = {target: hostEntity.name, key: hostEntityID}
    serviceEntityPathVals.unshift(hostEntityPathVal)
  }

  return serviceEntityPathVals
}

const _getAllPathVals = function (txContext) {
  const pathVals = []
  const paths = [...txContext.path]
  const entityIDs = [...txContext.params]

  for (let idx = 0; idx < paths.length; idx++) {
    const entity = getEntityByContextPath(paths.slice(0, idx + 1), txContext.hasComp)
    const entityID = entityIDs[idx]
    const entityPathVal = {target: entity.name, key: entityID};
    pathVals.push(entityPathVal)
  }

  return pathVals
}

function convertSubjectToParams(subject) {
  let params = [];
  let subjectRef = [];
  subject?.ref?.forEach((item)=>{
    if (typeof item === 'string') {
      subjectRef.push(item)
      return
    }

    const keys = {}
    let id = item.id
    if (!id) return
    for (let j = 0; j < item?.where?.length; j = j + 4) {
      const key = item.where[j].ref[0]
      const value = item.where[j + 2].val
      if (key !== 'IsActiveEntity') keys[key] = value
    }
    params.push(keys);
  })
  return params.length > 0 ? params : subjectRef;
}

/**
 *
 * @param {*} tx
 * @param {*} changes
 *
 * When consuming app implement '@changelog' on an property element,
 * change history can use attribute on associated entity which are specified instead of property value.
 *
 * eg:
 * entity BookStore    @(cds.autoexpose): cuid, managed {
 * ...
 * '@changelog': [bookOfTheMonth.title]
 * bookOfTheMonthID: UUID;
 * bookOfTheMonth : Association to one Book on bookOfTheMonth.ID = bookOfTheMonthID;
 * ...
 * }
 */
const _formatPropertyContext = async function (changes, reqData, reqTarget) {
  for (const change of changes) {
    const p = cds.model.definitions[change.serviceEntity].elements[change.attribute]
    if (p?.type === "cds.Association" || typeof change.valueChangedTo === "object" || typeof p["@changelog"] !== "object") continue

    const semkeys = getObjIdElementNamesInArray(p["@changelog"], false)
    if (!semkeys.length) continue

    const isAssociatedEntityProperty = semkeys[0].split(".").length > 1

    if (isAssociatedEntityProperty) {
      const associationsUsed = Object.keys(semkeys.reduce((a, semkey) => {
        a[semkey.split(".")[0]] = true;
        return a;
      }, {}));
  
      if(associationsUsed.length > 1) {
        throw new Error(`@changelog ${change.entity}.${change.attribute}: only one navigation property can be used in the annotation, found multiple: ${associationsUsed}`)
      }
  
      const a = cds.model.definitions[change.serviceEntity].elements[associationsUsed[0]]
      if(!a) continue;
  
      const condition = a.on.reduce((conditions, e, i) => {
        if (e === "=") {
          const targetProperty = [...a.on[i - 1].ref];
          targetProperty.shift();
          const sourceProperty = a.on[i + 1].ref.join(".");
          if(sourceProperty !== change.attribute) {
            throw new Error(`@changlog ${change.entity}.${change.attribute}: association ${a.name} is required to only use conditions based on the annotated property, but uses ${sourceProperty}`)
          }
          conditions.changedFrom[targetProperty.join(".")] = change.valueChangedFrom;
          conditions.changedTo[targetProperty.join(".")] = change.valueChangedTo;
        } return conditions;
      }, {changedFrom: {}, changedTo: {}})
  
      const from = (change.modification === 'create') ? '' : await cds.db.run(SELECT.one.from(a.target).where(condition.changedFrom));
      const to = (change.modification === 'delete') ? '' :  await cds.db.run(SELECT.one.from(a.target).where(condition.changedTo));
      
      const semkeysForObjectId = getObjIdElementNamesInArray(p["@changelog"])

      const fromObjId = await getObjectId(reqData, reqTarget, a.target, semkeysForObjectId, { curObjFromDbQuery: from || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
      if (fromObjId) change.valueChangedFrom = fromObjId
  
      const toObjId = await getObjectId(reqData, reqTarget, a.target, semkeysForObjectId, { curObjFromDbQuery: to || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
      if (toObjId) change.valueChangedTo = toObjId
  
      const isVLvA = a["@Common.ValueList.viaAssociation"]
      if (!isVLvA) change.valueDataType = getValueEntityType(a.target, semkeysForObjectId)
    }
  }
}

/**
 *
 * @param {*} tx
 * @param {*} changes
 *
 * When consuming app implement '@changelog' on an association element,
 * change history will use attribute on associated entity which are specified instead of default technical foreign key.
 *
 * eg:
 * entity PurchasedProductFootprints    @(cds.autoexpose): cuid, managed {
 * ...
 * '@changelog': [Plant.identifier]
 * '@mandatory' Plant : Association to one Plant;
 * ...
 * }
 */
const _formatAssociationContext = async function (changes, reqData, reqTarget) {
  for (const change of changes) {
    const a = cds.model.definitions[change.serviceEntity].elements[change.attribute]
    if (a?.type !== "cds.Association") continue

    const semkeys = getObjIdElementNamesInArray(a["@changelog"])
    if (!semkeys.length) continue

    const ID = a.keys[0].ref[0] || 'ID'
    const [ from, to ] = await cds.db.run ([
      SELECT.one.from(a.target).where({ [ID]: change.valueChangedFrom }),
      SELECT.one.from(a.target).where({ [ID]: change.valueChangedTo })
    ])

    const fromObjId = await getObjectId(reqData, reqTarget, a.target, semkeys, { curObjFromDbQuery: from || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
    if (fromObjId) change.valueChangedFrom = fromObjId

    const toObjId = await getObjectId(reqData, reqTarget, a.target, semkeys, { curObjFromDbQuery: to || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
    if (toObjId) change.valueChangedTo = toObjId

    const isVLvA = a["@Common.ValueList.viaAssociation"]
    if (!isVLvA) change.valueDataType = getValueEntityType(a.target, semkeys)
  }
}

const _getChildChangeObjId = async function (
  change,
  childNodeChange,
  curNodePathVal,
  reqData,
  reqTarget
) {
  const composition = cds.model.definitions[change.serviceEntity].elements[change.attribute]
  const objIdElements = composition ? composition["@changelog"] : null
  const objIdElementNames = getObjIdElementNamesInArray(objIdElements)

  return _getObjectIdByPath(
    reqData,
    reqTarget,
    curNodePathVal,
    childNodeChange._path,
    objIdElementNames
  )
}

const _formatCompositionContext = async function (changes, reqData, reqTarget) {
  const childNodeChanges = []

  for (const change of changes) {
    if (typeof change.valueChangedTo === "object" && !(change.valueChangedTo instanceof Date)) {
      if (!Array.isArray(change.valueChangedTo)) {
        change.valueChangedTo = [change.valueChangedTo]
      }
      for (const childNodeChange of change.valueChangedTo) {
        if(!childNodeChange._op) {
          continue
        }
        const curChange = Object.assign({}, change)
        const path = [...childNodeChange._path]
        const curNodePathVal = path.pop()
        curChange.modification = childNodeChange._op
        const objId = await _getChildChangeObjId(
          change,
          childNodeChange,
          curNodePathVal,
          reqData,
          reqTarget
        )
        _formatCompositionValue(curChange, objId, childNodeChange, childNodeChanges)
      }
      change.valueChangedTo = undefined
    }
  }
  changes.push(...childNodeChanges)
}

const _formatCompositionValue = function (
  curChange,
  objId,
  childNodeChange,
  childNodeChanges
) {
  if (curChange.modification === "delete") {
    curChange.valueChangedFrom = objId
    curChange.valueChangedTo = ""
  } else if (curChange.modification === "update") {
    curChange.valueChangedFrom = objId
    curChange.valueChangedTo = objId
  } else {
    curChange.valueChangedFrom = ""
    curChange.valueChangedTo = objId
  }
  curChange.valueDataType = _formatCompositionEntityType(curChange)
  // Since req.diff() will record the managed data, change history will filter those logs only be changed managed data
  const managedAttrs = ["modifiedAt", "modifiedBy"]
  if (curChange.modification === "update") {
    const rowOldAttrs = Object.keys(childNodeChange._old)
    const diffAttrs = rowOldAttrs.filter((attr) => managedAttrs.indexOf(attr) === -1)
    if (!diffAttrs.length) {
      return
    }
  }
  childNodeChanges.push(curChange)
}

const _formatCompositionEntityType = function (change) {
  const composition = cds.model.definitions[change.serviceEntity].elements[change.attribute]
  const objIdElements = composition ? composition['@changelog'] : null

  if (Array.isArray(objIdElements)) {
    // In this case, the attribute is a composition
    const objIdElementNames = getObjIdElementNamesInArray(objIdElements)
    return getValueEntityType(composition.target, objIdElementNames)
  }
  return ""
}

const _getObjectIdByPath = async function (
  reqData,
  reqTarget,
  nodePathVal,
  serviceEntityPath,
  /**optional*/ objIdElementNames
) {
  const curObjFromReqData = getCurObjFromReqData(reqData, nodePathVal, serviceEntityPath)
  const entityName = getNameFromPathVal(nodePathVal)
  const entityUUID = getUUIDFromPathVal(nodePathVal)
  const obj = await getCurObjFromDbQuery(entityName, entityUUID)
  const curObj = { curObjFromReqData, curObjFromDbQuery: obj }
  return getObjectId(reqData, reqTarget, entityName, objIdElementNames, curObj)
}

const _formatObjectID = async function (changes, reqData, reqTarget) {
  const objectIdCache = new Map()
  for (const change of changes) {
    const path = [...change.serviceEntityPath];
    const curNodePathVal = path.pop()
    const parentNodePathVal = path.pop()

    let curNodeObjId = objectIdCache.get(curNodePathVal)
    if (!curNodeObjId) {
      curNodeObjId = await _getObjectIdByPath(
        reqData,
        reqTarget,
        curNodePathVal,
        change.serviceEntityPath
      )
      objectIdCache.set(curNodePathVal, curNodeObjId)
    }

    let parentNodeObjId = objectIdCache.get(parentNodePathVal)
    if (!parentNodeObjId && parentNodePathVal) {
      parentNodeObjId = await _getObjectIdByPath(
        reqData,
        reqTarget,
        parentNodePathVal,
        change.serviceEntityPath
      )
      objectIdCache.set(parentNodePathVal, parentNodeObjId)
    }

    change.entityID = curNodeObjId
    change.parentEntityID = parentNodeObjId
    change.parentKey = getUUIDFromPathVal(parentNodePathVal)
  }
}

const _isCompositionContextPath = function (aPath, hasComp) {
  if (!aPath) return
  if (typeof aPath === 'string') aPath = JSON.parse(aPath)
  if (aPath.length < 2) return false
  const target = getEntityByContextPath(aPath, hasComp)
  const parent = getEntityByContextPath(aPath.slice(0, -1), hasComp)
  if (!parent.compositions) return false
  return Object.values(parent.compositions).some(c => c._target === target)
}

const _formatChangeLog = async function (changes, req) {
  await _formatObjectID(changes, req.data, req.target)
  await _formatPropertyContext(changes, req.data, req.target)
  await _formatAssociationContext(changes, req.data, req.target)
  await _formatCompositionContext(changes, req.data, req.target)
}

const _afterReadChangeView = function (data, req) {
  if (!data) return
  if (!Array.isArray(data)) data = [data]
  localizeLogFields(data, req.locale)
}


function _trackedChanges4 (srv, target, diff) {
  const template = getTemplate("change-logging", srv, target, { pick: e => e['@changelog'] })
  if (!template.elements.size) return

  const changes = []
  diff._path = [{target: target.name, key: getKey(target, diff)}];

  templateProcessor({
    template, row: diff, processFn: ({ row, key, element }) => {
      const from = row._old?.[key]
      const to = row[key]
      const eleParentKeys = element.parent.keys
      if (from === to) return

      /**
       * 
       * For the Inline entity such as Items, 
       * further filtering is required on the keys 
       * within the 'association' and 'foreign key' to ultimately retain the keys of the entity itself.
       * entity Order : cuid {
       *   title      : String;
       *   Items      : Composition of many {
       *     key ID   : UUID;
       *     quantity : Integer;
       *   }
       * }
       */
      const keys = Object.keys(eleParentKeys)
        .filter(k => k !== "IsActiveEntity")
        .filter(k => eleParentKeys[k]?.type !== "cds.Association") // Skip association
        .filter(k => !eleParentKeys[k]?.["@odata.foreignKey4"]) // Skip foreign key
        .map(k => `${k}=${row[k]}`)
        .join(', ')

      changes.push({
        serviceEntityPath: row._path,
        entity: getDBEntity(element.parent).name,
        serviceEntity: element.parent.name,
        attribute: element["@odata.foreignKey4"] || key,
        valueChangedFrom: from?? '',
        valueChangedTo: to?? '',
        valueDataType: element.type,
        modification: row._op,
        keys,
      })
    }
  })

  return changes.length && changes
}

const _prepareChangeLogForComposition = async function (entity, entityKey, changes, req) {
  const rootEntityPathVals = _getRootEntityPathVals(req.context, entity, entityKey)

  if (rootEntityPathVals.length < 2) {
    LOG.info("Parent entity doesn't exist.")
    return
  }

  const parentEntityPathVal = rootEntityPathVals[rootEntityPathVals.length - 2]
  const parentKey = getUUIDFromPathVal(parentEntityPathVal)
  const serviceEntityPath = [...rootEntityPathVals]
  const parentServiceEntityPath = _getAllPathVals(req.context)
    .slice(0, rootEntityPathVals.length - 2)

  for (const change of changes) {
    change.parentEntityID = await _getObjectIdByPath(req.data, req.target, parentEntityPathVal, parentServiceEntityPath)
    change.parentKey = parentKey
    change.serviceEntityPath = serviceEntityPath
  }

  const rootEntity = getNameFromPathVal(rootEntityPathVals[0])
  const rootEntityID = getUUIDFromPathVal(rootEntityPathVals[0])
  return [ rootEntity, rootEntityID ]
}

async function generatePathAndParams (req, entityKey) {
  const { target, data } = req;
  const { foreignKey, parentEntity, assoc } = getAssociationDetails(target);
  const hasParentAndForeignKey = parentEntity && data[foreignKey];
  const targetEntity = hasParentAndForeignKey ? parentEntity : target;
  const targetKey = hasParentAndForeignKey ? {ID: data[foreignKey]} : entityKey;

  let compContext = {
    path: hasParentAndForeignKey
      ? [{target: parentEntity.name}, {target: target.name}]
      : [{target: target.name}],
    params: hasParentAndForeignKey
      ? [ getAssociationKey(assoc, data), entityKey]
      : [ entityKey],
    hasComp: true
  };

  if (hasParentAndForeignKey && parentEntity[isRoot]) {
    return compContext;
  }

  let parentAssoc = await processEntity(targetEntity, targetKey, compContext);
  while (parentAssoc && !parentAssoc.entity[isRoot]) {
    parentAssoc = await processEntity(
      parentAssoc.entity,
      parentAssoc.key,
      compContext
    );
  }
  return compContext;
}

async function processEntity (entity, entityKey, compContext) {
  const { foreignKey, parentEntity, assoc } = getAssociationDetails(entity);

  if (foreignKey && parentEntity) {
    const parentResult =
      (await SELECT.one
        .from(entity.name)
        .where(entityKey)
        .columns(foreignKey)) || {};
    const key = getAssociationKey(assoc, parentResult)
    if (!key) return;
    compContext.path = [{target: parentEntity.name, key}, ...compContext.path];
    compContext.params.unshift(key);
    return {
      entity: parentEntity,
      key
    };
  }
}

function getAssociationDetails (entity) {
  if (!entity) return {};
  const assocName = entity['change-tracking-parentEntity']?.associationName;
  const assoc = entity.elements[assocName];
  const parentEntity = assoc?._target;
  const foreignKey = assoc?.keys?.[0]?.$generatedFieldName;
  return { foreignKey, parentEntity, assoc };
}

async function track_changes (req) {
  let diff = await req.diff()
  if (!diff) return

  let target = req.target
  let compContext = null;
  let entityKey = getKey(req.target, diff)
  const params = convertSubjectToParams(req.subject);
  if (req.subject.ref.length === 1 && params.length === 1 && !target[isRoot]) {
    compContext = await generatePathAndParams(req, entityKey);
  }
  let isComposition = _isCompositionContextPath(
    compContext?.path || req.path.split("/").map(p => ({target: p})),
    compContext?.hasComp
  );
  if (
    req.event === "DELETE" &&
    target[isRoot] &&
    !cds.env.requires["change-tracking"]?.preserveDeletes
  ) {
    return await DELETE.from(`sap.changelog.ChangeLog`).where({entityKey: stringifyKey(entityKey)});
  }

  let changes = _trackedChanges4(this, target, diff)
  if (!changes) return

  await _formatChangeLog(changes, req)
  if (isComposition) {
    let reqInfo = {
      target: req.target,
      data: req.data,
      context: {
        path: compContext?.path || req.path.split("/").map(p => ({target: p})),
        params: compContext?.params || params,
        event: req.event,
        hasComp: compContext?.hasComp
      }
    };
    [ target, entityKey ] = await _prepareChangeLogForComposition(target, entityKey, changes, reqInfo)
  }
  const dbEntity = getDBEntity(target)


  await INSERT.into("sap.changelog.ChangeLog").entries({
    entity: dbEntity.name,
    entityKey: stringifyKey(entityKey),
    serviceEntity: target.name || target,
    changes: changes.filter(c => (c.valueChangedFrom || c.valueChangedTo) && (c.valueChangedFrom != c.valueChangedTo)).map((c) => ({
      ...c,
      serviceEntityPath: stringifyPath(c.serviceEntityPath),
      parentKey: stringifyKey(c.parentKey),
      valueChangedFrom: `${c.valueChangedFrom ?? ''}`,
      valueChangedTo: `${c.valueChangedTo ?? ''}`,
    })),
  })
}

module.exports = { track_changes, _afterReadChangeView }
