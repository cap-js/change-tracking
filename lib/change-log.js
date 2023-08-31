const cds = require("@sap/cds")
const getTemplate = require("@sap/cds/libx/_runtime/common/utils/template") // REVISIT: bad usage of internal stuff
const templateProcessor = require("./template-processor")
const { big } = require("@sap/cds-foss") // REVISIT: Do we really need that?
const LOG = cds.log("change-log")
const {
  OBJECT_PATH_DELIMITER,
  TX_CONTEXT_PATH_DELIMITER,
  VALUE_DELIMITER,
} = require("./constants")
const CHANGE_LOG_ANNOTATION = "@changelog"

const {
  getNameFromPathVal,
  getUUIDFromPathVal,
  getCurObjFromReqData,
  getCurObjFromDbQuery,
  getObjectId,
  getDBEntity,
  getEntity,
  getEntityByContextPath,
  hasComposition,
  getObjIdElementNamesInArray,
  getAssociationCompositionEntity,
  getValueEntityType,
} = require("./entity-helper")
const { localizeLogFields } = require("./localization")


const _getRootEntityPathVals = function (txContext, entity, entityKey) {
  const serviceEntityPathVals = []
  const entityIDs = _getEntityIDs(txContext.params)

  let path = txContext.path.split(TX_CONTEXT_PATH_DELIMITER)

  if (txContext.event === "CREATE") {
    const curEntityPathVal = `${entity.name}(${entityKey})`
    serviceEntityPathVals.push(curEntityPathVal)
  } else {
    // When deleting Composition of one node via REST API in draft-disabled mode,
    // the child node ID would be missing in URI
    if (txContext.event === "DELETE" && !entityIDs.find((x) => x === entityKey)) {
      entityIDs.push(entityKey)
    }
    const curEntity = getEntityByContextPath(path)
    const curEntityID = entityIDs.pop()
    const curEntityPathVal = `${curEntity.name}(${curEntityID})`
    serviceEntityPathVals.push(curEntityPathVal)
  }


  while (_isCompositionContextPath(path)) {
    const hostEntity = getEntityByContextPath(path = path.slice(0, -1))
    const hostEntityID = entityIDs.pop()
    const hostEntityPathVal = `${hostEntity.name}(${hostEntityID})`
    serviceEntityPathVals.unshift(hostEntityPathVal)
  }

  return serviceEntityPathVals
}

const _getAllPathVals = function (txContext) {
  const pathVals = []
  const paths = txContext.path.split(TX_CONTEXT_PATH_DELIMITER)
  const entityIDs = _getEntityIDs(txContext.params)

  for (let idx = 0; idx < paths.length; idx++) {
    const entity = getEntityByContextPath(paths.slice(0, idx + 1))
    const entityID = entityIDs[idx]
    const entityPathVal = `${entity.name}(${entityID})`
    pathVals.push(entityPathVal)
  }

  return pathVals
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

const _pick = (element) => {
  return element[CHANGE_LOG_ANNOTATION]
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
const _formatAssociationContext = async function (changes) {
  for (const change of changes) {
    const a = getEntity(change.serviceEntity).elements[change.attribute]
    if (a?.type !== "cds.Association") continue

    const semkeys = getObjIdElementNamesInArray(a[CHANGE_LOG_ANNOTATION])
    if (!semkeys.length) continue

    const ID = a.keys[0].ref[0] || 'ID'
    const [ from, to ] = await cds.db.run ([
      SELECT.one.from(a.target).where({ [ID]: change.valueChangedFrom }),
      SELECT.one.from(a.target).where({ [ID]: change.valueChangedTo })
    ])

    const fromObjId = await getObjectId(a.target, semkeys, { curObjFromDbQuery: from || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
    if (fromObjId) change.valueChangedFrom = fromObjId

    const toObjId = await getObjectId(a.target, semkeys, { curObjFromDbQuery: to || undefined }) // Note: ... || undefined is important for subsequent object destructuring with defaults
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
  const composition = getAssociationCompositionEntity(change.serviceEntity, change.attribute )
  const objIdElements = composition ? composition[CHANGE_LOG_ANNOTATION] : null
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
        const path = childNodeChange._path.split(OBJECT_PATH_DELIMITER)
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
  const composition = getAssociationCompositionEntity(
    change.serviceEntity,
    change.attribute
  )
  const objIdElements = composition ? composition[CHANGE_LOG_ANNOTATION] : null

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
  return getObjectId(entityName, objIdElementNames, curObj)
}

const _formatObjectID = async function (changes, reqData) {
  const objectIdCache = new Map()
  for (const change of changes) {
    const path = change.serviceEntityPath.split(OBJECT_PATH_DELIMITER)
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

const _isCompositionContextPath = function (aPath) {
  if (!aPath) return
  if (typeof aPath === 'string') aPath = aPath.split('/')
  if (aPath.length < 2) return false
  const target = getEntityByContextPath(aPath)
  const parent = getEntityByContextPath(aPath.slice(0, -1))
  return hasComposition(parent, target)
}

const _formatChangeLog = async function (changes, req) {
  await _formatObjectID(changes, req.data)
  await _formatAssociationContext(changes)
  await _formatCompositionContext(changes, req.data)
  // _formatFromTo(req, changes)
}

// function _formatFromTo (req, changes) {
//   const contentType = req.context.req?.headers["content-type"] // the service API do not have a req header
//   const isExponentialDecimals = contentType?.includes("ExponentialDecimals=true")
//   for (const change of changes) {
//     if (!isExponentialDecimals)
//       _formatDecimalValue(change)
//   }
// }

// const _formatDecimalValue = function (change) {
//   const valueDataTypes = change.valueDataType.split(VALUE_DELIMITER)
//   const valueChangedFroms = change.valueChangedFrom.split(VALUE_DELIMITER)
//   const valueChangedTos = change.valueChangedTo.split(VALUE_DELIMITER)
//   for (const idx in valueDataTypes) {
//     if (valueDataTypes[idx] === "cds.Decimal") {
//       if (valueChangedFroms[idx]) {
//         const bigFrom = big(valueChangedFroms[idx])
//         valueChangedFroms[idx] = bigFrom.toFixed()
//       }

//       if (valueChangedTos[idx]) {
//         const bigTo = big(valueChangedTos[idx])
//         valueChangedTos[idx] = bigTo.toFixed()
//       }
//     }
//   }
//   change.valueChangedFrom = valueChangedFroms.join(VALUE_DELIMITER)
//   change.valueChangedTo = valueChangedTos.join(VALUE_DELIMITER)
// }

const _afterReadChangeView = async function (data, req) {
  if (!data) {
    return
  }

  localizeLogFields(Array.isArray(data) ? data : [data], req.user.locale)
}


function _trackedChanges4 (srv, target, diff) {
  const template = getTemplate("change-logging", srv, target, { pick: _pick })
  if (!template.elements.size) return

  const changes = []
  diff._path = `${target.name}(${diff.ID})`

  templateProcessor({
    template, row: diff, processFn: ({ row, key, element }) => {
      const from = row._old?.[key] ? row._old[key] : undefined
      const to = row[key] ? row[key] : undefined
      if (from === to)
        return

      const keys = Object.keys(element.parent.keys)
        .filter(k => k !== "IsActiveEntity")
        .map(k => `${k}=${row[k]}`)
        .join(', ')

      changes.push({
        serviceEntityPath: row._path,
        entity: getDBEntity(element.parent).name,
        serviceEntity: element.parent.name,
        attribute: element["@odata.foreignKey4"] || key,
        valueChangedFrom: from || '',
        valueChangedTo: to || '',
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
  const serviceEntityPath = rootEntityPathVals.join(OBJECT_PATH_DELIMITER)
  const parentServiceEntityPath = _getAllPathVals(req.context)
    .slice(0, rootEntityPathVals.length - 2)
    .join(OBJECT_PATH_DELIMITER)

  for (const change of changes) {
    change.parentEntityID = await _getObjectIdByPath(req.data, parentEntityPathVal, parentServiceEntityPath)
    change.parentKey = parentKey
    change.serviceEntityPath = serviceEntityPath
  }

  const rootEntity = getNameFromPathVal(rootEntityPathVals[0])
  const rootEntityID = getUUIDFromPathVal(rootEntityPathVals[0])
  return [ rootEntity, rootEntityID ]
}


async function track_changes (req) {
  let diff = await req.diff()
  if (!diff) return

  let target = req.target
  let isDraftEnabled = !!target.drafts
  let isComposition = _isCompositionContextPath(req.context.path)
  let entityKey = diff.ID

  if (req.event === "DELETE") {
    if (isDraftEnabled || !isComposition) {
      return await DELETE.from(`sap.changelog.ChangeLog`).where({ entityKey })
    }
  }

  let changes = _trackedChanges4(this, target, diff)
  if (!changes) return

  await _formatChangeLog(changes, req)
  if (isComposition && !isDraftEnabled) {
    [ target, entityKey ] = await _prepareChangeLogForComposition(target, entityKey, changes, this)
  }
  const dbEntity = getDBEntity(target)
  for (const change of changes) {
    await INSERT.into("sap.changelog.ChangeLog").entries({
      entity: dbEntity.name,
      entityKey: entityKey,
      serviceEntity: target.name,
      //TODO: Verify new schema
      valueChangedFrom: change.valueChangedFrom,
      valueChangedTo: change.valueChangedTo
      //changes: changes.filter(c => c.valueChangedFrom || c.valueChangedTo),
    })
  }
}

module.exports = { track_changes, _afterReadChangeView }
