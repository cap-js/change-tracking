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
const { localizeLogFields } = require("./localization")


const _getRootEntityPathVals = function (txContext, entity, entityKey) {
  const serviceEntityPathVals = []
  const entityIDs = _getEntityIDs(txContext.params)

  let path = txContext.path.split('/')

  if (txContext.event === "CREATE") {
    const curEntityPathVal = `${entity.name}(${entityKey})`
    serviceEntityPathVals.push(curEntityPathVal)
  } else {
    // When deleting Composition of one node via REST API in draft-disabled mode,
    // the child node ID would be missing in URI
    if (txContext.event === "DELETE" && !entityIDs.find((x) => x === entityKey)) {
      entityIDs.push(entityKey)
    }
    const curEntity = getEntityByContextPath(path, txContext.flag)
    const curEntityID = entityIDs.pop()
    const curEntityPathVal = `${curEntity.name}(${curEntityID})`
    serviceEntityPathVals.push(curEntityPathVal)
  }


  while (_isCompositionContextPath(path, txContext.flag)) {
    const hostEntity = getEntityByContextPath(path = path.slice(0, -1), txContext.flag)
    const hostEntityID = entityIDs.pop()
    const hostEntityPathVal = `${hostEntity.name}(${hostEntityID})`
    serviceEntityPathVals.unshift(hostEntityPathVal)
  }

  return serviceEntityPathVals
}

const _getAllPathVals = function (txContext) {
  const pathVals = []
  const paths = txContext.path.split('/')
  const entityIDs = _getEntityIDs(txContext.params)

  for (let idx = 0; idx < paths.length; idx++) {
    const entity = getEntityByContextPath(paths.slice(0, idx + 1), txContext.flag)
    const entityID = entityIDs[idx]
    const entityPathVal = `${entity.name}(${entityID})`
    pathVals.push(entityPathVal)
  }

  return pathVals
}

function convertSubjectToParams(subject) {
  let params = [];
  let subjectRef = [];
  subject?.ref?.forEach((item)=>{
    // const keys = {}
    // let subjectRef = []
    // if (subject.length === 1 && typeof item === 'string') {
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

const _getEntityIDs = function (txParams) {
  const entityIDs = []
  for (const param of txParams) {
    let id = ""
    if (typeof param === "object" && !Array.isArray(param)) {
      id = param.ID
    }
    if (typeof param === "string") {
      id = param
    }
    if (id) {
      entityIDs.push(id)
    }
  }
  return entityIDs
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
const _formatAssociationContext = async function (changes, reqData) {
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

    const fromObjId = await getObjectId(reqData, a.target, semkeys, { curObjFromDbQuery: from || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
    if (fromObjId) change.valueChangedFrom = fromObjId

    const toObjId = await getObjectId(reqData, a.target, semkeys, { curObjFromDbQuery: to || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
    if (toObjId) change.valueChangedTo = toObjId

    const isVLvA = a["@Common.ValueList.viaAssociation"]
    if (!isVLvA) change.valueDataType = getValueEntityType(a.target, semkeys)
  }
}

const _getChildChangeObjId = async function (
  change,
  childNodeChange,
  curNodePathVal,
  reqData
) {
  const composition = cds.model.definitions[change.serviceEntity].elements[change.attribute]
  const objIdElements = composition ? composition["@changelog"] : null
  const objIdElementNames = getObjIdElementNamesInArray(objIdElements)

  return _getObjectIdByPath(
    reqData,
    curNodePathVal,
    childNodeChange._path,
    objIdElementNames
  )
}

const _formatCompositionContext = async function (changes, reqData) {
  const childNodeChanges = []

  for (const change of changes) {
    if (typeof change.valueChangedTo === "object") {
      if (!Array.isArray(change.valueChangedTo)) {
        change.valueChangedTo = [change.valueChangedTo]
      }
      for (const childNodeChange of change.valueChangedTo) {
        const curChange = Object.assign({}, change)
        const path = childNodeChange._path.split('/')
        const curNodePathVal = path.pop()
        curChange.modification = childNodeChange._op
        const objId = await _getChildChangeObjId(
          change,
          childNodeChange,
          curNodePathVal,
          reqData
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
  nodePathVal,
  serviceEntityPath,
  /**optional*/ objIdElementNames
) {
  const curObjFromReqData = getCurObjFromReqData(reqData, nodePathVal, serviceEntityPath)
  const entityName = getNameFromPathVal(nodePathVal)
  const entityUUID = getUUIDFromPathVal(nodePathVal)
  const obj = await getCurObjFromDbQuery(entityName, entityUUID)
  const curObj = { curObjFromReqData, curObjFromDbQuery: obj }
  return getObjectId(reqData, entityName, objIdElementNames, curObj)
}

const _formatObjectID = async function (changes, reqData) {
  const objectIdCache = new Map()
  for (const change of changes) {
    const path = change.serviceEntityPath.split('/')
    const curNodePathVal = path.pop()
    const parentNodePathVal = path.pop()

    let curNodeObjId = objectIdCache.get(curNodePathVal)
    if (!curNodeObjId) {
      curNodeObjId = await _getObjectIdByPath(
        reqData,
        curNodePathVal,
        change.serviceEntityPath
      )
      objectIdCache.set(curNodePathVal, curNodeObjId)
    }

    let parentNodeObjId = objectIdCache.get(parentNodePathVal)
    if (!parentNodeObjId && parentNodePathVal) {
      parentNodeObjId = await _getObjectIdByPath(
        reqData,
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

const _isCompositionContextPath = function (aPath, flag) {
  if (!aPath) return
  if (typeof aPath === 'string') aPath = aPath.split('/')
  if (aPath.length < 2) return false
  const target = getEntityByContextPath(aPath, flag)
  const parent = getEntityByContextPath(aPath.slice(0, -1), flag)
  if (!parent.compositions) return false
  return Object.values(parent.compositions).some(c => c._target === target)
}

const _formatChangeLog = async function (changes, req) {
  await _formatObjectID(changes, req.data)
  await _formatAssociationContext(changes, req.data)
  await _formatCompositionContext(changes, req.data)
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
  diff._path = `${target.name}(${diff.ID})`

  templateProcessor({
    template, row: diff, processFn: ({ row, key, element }) => {
      const from = row._old?.[key]
      const to = row[key]
      if (from === to) return

      const keys = Object.keys(element.parent.keys)
        .filter(k => k !== "IsActiveEntity")
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
  const serviceEntityPath = rootEntityPathVals.join('/')
  const parentServiceEntityPath = _getAllPathVals(req.context)
    .slice(0, rootEntityPathVals.length - 2)
    .join('/')

  for (const change of changes) {
    change.parentEntityID = await _getObjectIdByPath(req.data, parentEntityPathVal, parentServiceEntityPath)
    change.parentKey = parentKey
    change.serviceEntityPath = serviceEntityPath
  }

  const rootEntity = getNameFromPathVal(rootEntityPathVals[0])
  const rootEntityID = getUUIDFromPathVal(rootEntityPathVals[0])
  return [ rootEntity, rootEntityID ]
}

async function generatePathAndParams(req, entityKey) {
  const { target, event } = req;
  const { assoc, ID, foreignKey } = getAssociationDetails(target);
  const parentEntity = assoc?._target;
  const isCreateEvent = event === 'CREATE';

  let compContext = {
    path: isCreateEvent ? `${parentEntity.name}/${target.name}` : `${target.name}`,
    params: [{ [ID]: entityKey }]
  };
  
  if (isCreateEvent && req.data[foreignKey]) {
    compContext.params.push({ [ID]: req.data[foreignKey] });
  }
  
  if (isCreateEvent && parentEntity && parentEntity['change-tracking-isRootEntity']) {
    return compContext;
  }

  let parentAssociation = await processEntity(target, entityKey, compContext);
  while (parentAssociation && !parentAssociation.entity['change-tracking-isRootEntity']) {
    compContext.path = `${parentAssociation.entity.name}/${compContext.path}`;
    parentAssociation = await processEntity(parentAssociation.entity, parentAssociation.ID, compContext);
  }
  compContext.path = `${parentAssociation.entity.name}/${compContext.path}`;
  return compContext;
}

async function processEntity(entity, entityKey, compContext) {
  const { assoc, ID, foreignKey } = getAssociationDetails(entity);
  const parentEntity = assoc?._target;

  if (parentEntity) {
    const parentResult = await SELECT.one.from(entity.name).where({ [ID]: entityKey }).columns(foreignKey) || {};
    compContext.params.unshift({ [ID]: parentResult[foreignKey] });
    return {
      entity: parentEntity,
      [ID]: parentResult?.[foreignKey]
    };
  }
  return {};
}

function getAssociationDetails(entity) {
  const assocName = entity['change-tracking-parentEntity'].associationName;
  const assoc = entity.elements[assocName];
  const foreignKey = assoc.keys?.[0]?.$generatedFieldName;
  const ID = assoc?.keys?.[0]?.ref[0] || 'ID';
  return { assoc, ID, foreignKey };
}


async function track_changes (req) {
  let diff = await req.diff()
  if (!diff) return

  let target = req.target
  let compContext = null;
  let entityKey = diff.ID
  const params = convertSubjectToParams(req.subject);
  if (req.subject.ref.length === 1 && params.length === 1 && !target['change-tracking-isRootEntity']) {
    compContext = await generatePathAndParams(req, entityKey);
  }
  let isComposition = compContext?.path ? true : _isCompositionContextPath(req.path, compContext?.flag)
  // let isComposition = _isCompositionContextPath(req.path)
  // const resParent = await SELECT.from(target.name).where({ID: entityKey}).columns(target.associationName)
  // const resParentOne = await SELECT.one.from(target.name).where({ID: entityKey}).columns(target['change-tracking-parentEntity'].associationName)
  // const resParent1 = await SELECT.one.from(target.name).where({ID: entityKey}).columns('order_ID')

  // const resParent123 = await cds.run(SELECT.from(target.name).where({ID: entityKey}).columns(target.associationName));
  // const resParentOne1 = await cds.run(SELECT.one.from(target.name).where({ID: entityKey}).columns(target['change-tracking-parentEntity'].associationName));
  // const resParent11 = await cds.run(SELECT.one.from(target.name).where({ID: entityKey}).columns('order_ID'));
  if (
    req.event === "DELETE" &&
    target["change-tracking-isRootEntity"] &&
    !cds.env.requires["change-tracking"]?.preserveDeletes
  ) {
    return await DELETE.from(`sap.changelog.ChangeLog`).where({ entityKey });
  }

  let changes = _trackedChanges4(this, target, diff)
  if (!changes) return

  await _formatChangeLog(changes, req)
  if (isComposition) {
    let reqInfo = {
      data:req.data,
      context:{
        path: compContext?.path || req.path,
        params: compContext?.params || params, 
        event: req.event,
        flag: !!compContext
      }
    };
    // [ target, entityKey ] = await _prepareChangeLogForComposition(target, entityKey, changes, this)
    [ target, entityKey ] = await _prepareChangeLogForComposition(target, entityKey, changes, reqInfo)
    // [ target, entityKey ] = await _prepareChangeLogForComposition(target, entityKey, changes, {data:req.data,context:{path: compContext.path,params:compContext.params, event: req.event}})
  }
  const dbEntity = getDBEntity(target)
  await INSERT.into("sap.changelog.ChangeLog").entries({
    entity: dbEntity.name,
    entityKey: entityKey,
    serviceEntity: target.name || target,
    changes: changes.filter(c => c.valueChangedFrom || c.valueChangedTo).map((c) => ({
      ...c,
      valueChangedFrom: `${c.valueChangedFrom ?? ''}`,
      valueChangedTo: `${c.valueChangedTo ?? ''}`,
    })),
  })
}

module.exports = { track_changes, _afterReadChangeView }
