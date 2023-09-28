const cds = require("@sap/cds")
const LOG = cds.log("change-log")
const {
  TX_CONTEXT_PATH_DELIMITER,
  OBJECT_PATH_DELIMITER,
  VALUE_DELIMITER,
} = require("./constants")
const REF_OBJECT_ID_DELIMITER = "."
const COMPLEX_DATA_TYPE_DELIMITER = "_"

const _getNextChainedObj = async function (currentEntityName, firstAttrInChain, curObj, associationTargetName) {
  let { curObjFromReqData={}, curObjFromDbQuery={} } = curObj
  const foreignKey = _getForeignKey(currentEntityName, firstAttrInChain)
  const queryKey = foreignKey.split(COMPLEX_DATA_TYPE_DELIMITER).pop()
  const associationID = curObjFromReqData[foreignKey] ? curObjFromReqData[foreignKey] : curObjFromDbQuery[foreignKey]
  try {
    curObjFromDbQuery = await getCurObjFromDbQuery(associationTargetName, associationID, queryKey)
  } catch (e) {
    LOG.error("Failed to generate object Id for an association entity.", e)
    throw new Error("Failed to generate object Id for an association entity.", e)
  }
  return { curObjFromReqData, curObjFromDbQuery }
}

const _getChainedObjValMap = async function (curObj, entityName, objIdElementName) {
  let currentEntityName = entityName
  let isAssociation = true
  const chainAttributesArr = objIdElementName.split(REF_OBJECT_ID_DELIMITER)
  while (chainAttributesArr.length > 1 && isAssociation) {
    const firstAttrInChain = chainAttributesArr[0]
    const associationTargetName = _getAssociationTargetName(currentEntityName, firstAttrInChain)
    if (associationTargetName) {
      curObj = await _getNextChainedObj(currentEntityName, firstAttrInChain, curObj, associationTargetName)
      currentEntityName = associationTargetName
      chainAttributesArr.shift()
    } else {
      isAssociation = false
    }
  }
  const { curObjFromReqData={}, curObjFromDbQuery={} } = curObj
  const attribute =
    chainAttributesArr.length === 1 ? chainAttributesArr[0] : chainAttributesArr.join(COMPLEX_DATA_TYPE_DELIMITER)
  const currentEntity =
    currentEntityName === entityName && curObjFromReqData[attribute] ? curObjFromReqData : curObjFromDbQuery
  return [currentEntity, attribute]
}

const _getLastChainedEntity = function (objIdElementName, srvObjName) {
  let currentEntityName = srvObjName
  let isAssociation = true

  const chainAttributesArr = objIdElementName.split(REF_OBJECT_ID_DELIMITER)
  while (chainAttributesArr.length > 1 && isAssociation) {
    const firstChainAttr = chainAttributesArr[0]
    const associationTargetName = _getAssociationTargetName(currentEntityName, firstChainAttr)
    if (associationTargetName) {
      currentEntityName = associationTargetName
      chainAttributesArr.shift()
    } else {
      isAssociation = false
    }
  }
  return { chainAttributesArr, currentEntityName }
}

/**
 *
 * @param {*} parentSrvObjName
 * @param {*} srvObjName
 * @returns
 *
 * CASE: author is an attribute for association entity Authors on entity Books
 * parentSrvObjName = 'AuthorService.Books', srvObjName = 'AuthorService.Authors'
 * return result 'author'
 */
const _getAssociationName = function (parentSrvObjName, srvObjName) {
  const parentEntity = getEntity(parentSrvObjName)
  const associations = parentEntity.associations ? parentEntity.associations : {}

  for (const associationName of Object.keys(associations)) {
    const association = associations[associationName]
    if (association.target === srvObjName) {
      return associationName
    }
  }

  const compositions = parentEntity.compositions ? parentEntity.compositions : {}

  for (const compositionName of Object.keys(compositions)) {
    const composition = associations[compositionName]
    if (composition.target === srvObjName) {
      return compositionName
    }
  }

  return null
}

/**
 *
 * @param {*} srvObjName
 * @param {*} associationName
 * @returns
 *
 * CASE: author is an attribute for association entity Authors on entity Books
 * srvObjName = 'AuthorService.Books', associationName = 'author'
 * return 'AuthorService.Authors'
 */
const _getAssociationTargetName = function (srvObjName, associationName) {
  const association = getAssociationCompositionEntity(srvObjName, associationName)
  return association ? association.target : ""
}

/**
 *
 * @param {*} srvObjName
 * @returns
 *
 * srvObjName 'CategoryService.Books', all object ID columns could be found.
 * return ['title', 'author.firstName', 'author.lastName']
 */
const _getObjIdElementNames = function (srvObjName) {
  const objIdElementNames = []
  const obj = getEntity(srvObjName)
  const objIdElements = obj["@changelog.keys"] ? obj["@changelog.keys"] : []
  for (const objIdEle of objIdElements) {
    const ele = objIdEle["="]
    objIdElementNames.push(ele)
  }
  return objIdElementNames
}

/**
 *
 * @param {*} obj
 * @param {*} objIdElementName
 * @returns
 *
 * This function intends to generating object ID by object itself and the column names of object ID.
 */
const _genObjectIdByElementName = function (obj, objIdElementName) {
  if (!obj) {
    return ""
  }
  const objIDs = []
  if (obj[objIdElementName]) {
    objIDs.push(obj[objIdElementName])
  }
  return objIDs.length ? objIDs.join(VALUE_DELIMITER) : ""
}

const _getForeignKey = function (entityName, associationName) {
  const associationEntity = getAssociationCompositionEntity(entityName, associationName)
  if (associationEntity["keys"] && associationEntity["keys"].length) {
    return associationEntity["keys"][0]["$generatedFieldName"]
  }
  return ""
}

const _getCurObjValMap = function (entityName, curObj, value) {
  let obj = {}
  const { curObjFromReqData={}, curObjFromDbQuery={} } = curObj
  const association = getAssociationCompositionEntity(entityName, value)
  // if annotate association without any sub attributes as object id
  if (association && association.type === "cds.Association") {
    const generatedFieldName = _getForeignKey(entityName, value)
    obj = curObjFromReqData[generatedFieldName] ? curObjFromReqData : curObjFromDbQuery
    return [obj, generatedFieldName]
  }
  obj = curObjFromReqData[value] ? curObjFromReqData : curObjFromDbQuery
  return [obj, value]
}

/**
 *
 * @param {*} tx
 * @param {*} curObj
 * @param {*} entityName
 * @param {*} objIdElementNames
 * @returns
 *
 * Generate object id by entity name. Chained association entity will be queried to obtain its own object id.
 */
const _genObjectIdByEntityName = async function (curObj, entityName, objIdElementNames) {
  let objId = ""
  const objIds = []

  for (const objIdElementName of objIdElementNames) {
    const isOriginalAttribute = objIdElementName.indexOf(REF_OBJECT_ID_DELIMITER) === -1
    if (isOriginalAttribute) {
      const [obj, val] = _getCurObjValMap(entityName, curObj, objIdElementName)
      objId = _genObjectIdByElementName(obj, val)
    } else {
      const [obj, val] = await _getChainedObjValMap(curObj, entityName, objIdElementName)
      objId = _genObjectIdByElementName(obj, val)
    }
    if (objId) {
      objIds.push(objId)
    }
  }
  return objIds.join(VALUE_DELIMITER)
}

/**
 *
 * @param {*} curObj
 * @param {*} associationName
 * @param {*} curSrvObjUUID
 * @returns
 *
 */
const _getCurObjFromAssociation = function (curReqObj, associationName, curSrvObjUUID) {
  let associationData = null
  if (curReqObj) {
    if (Array.isArray(curReqObj[associationName])) {
      associationData = curReqObj[associationName]
    } else {
      associationData = [curReqObj[associationName]]
    }
  }
  curReqObj = associationData ? associationData.find((x) => x && x.ID === curSrvObjUUID) : {}
  return curReqObj
}

const getAssociationCompositionEntity = function (entityName, elementName) {
  const entity = getEntity(entityName)
  return entity.associations?.[elementName]
  || entity.compositions?.[elementName]
}

const getNameFromPathVal = function (pathVal) {
  const regRes = /^(.+?)\(/.exec(pathVal)
  return regRes ? regRes[1] : ""
}

const getUUIDFromPathVal = function (pathVal) {
  const regRes = /\((.+?)\)/.exec(pathVal)
  return regRes ? regRes[1] : ""
}

const getEntity = function (entityName) {
  return cds.model.definitions [entityName]
  // REVISIT: Former implementation looks extremely expensive:
  if (!entityName) return
  for (const srv of cds.services) {
    if (entityName.startsWith(srv.name)) {
      for (const entity of srv.entities) {
        if (entity.name === entityName) {
          return entity
        }
      }
    }
  }
  for (const entity of cds.db.entities) {
    if (entity.name === entityName) {
      return entity
    }
  }
  return null
}

const getEntityByContextPath = function (aPath) {
  let entity = getEntity(aPath[0])
  for (let idx = 1; entity && idx < aPath.length; idx++) {
    entity = entity.elements[aPath[idx]]?._target
  }
  return entity
}

const getObjIdElementNamesInArray = function (elements) {
  if (Array.isArray(elements)) return elements.map(e => {
    const splitted = (e["="]||e).split(REF_OBJECT_ID_DELIMITER)
    splitted.shift()
    return splitted.join(REF_OBJECT_ID_DELIMITER)
  })
  else return []
}

const getCurObjFromDbQuery = async function (entityName, queryVal, /**optional*/ queryKey='ID') {
  if (!queryVal) return {}
  // REVISIT: This always reads all elements -> should read required ones only!
  const obj = await SELECT.one.from(entityName).where({[queryKey]: queryVal})
  return obj || {}
}

const getCurObjFromReqData = function (reqData, nodePathVal, pathVal) {
  const pathVals = pathVal.split(OBJECT_PATH_DELIMITER)
  const rootNodePathVal = pathVals[0]
  let curReqObj = reqData ? reqData : {}

  if (nodePathVal === rootNodePathVal) {
    return curReqObj
  } else {
    pathVals.shift()
  }

  let parentSrvObjName = getNameFromPathVal(rootNodePathVal)

  for (const subNodePathVal of pathVals) {
    const srvObjName = getNameFromPathVal(subNodePathVal)
    const associationName = _getAssociationName(parentSrvObjName, srvObjName)
    const curSrvObjUUID = getUUIDFromPathVal(subNodePathVal)
    curReqObj = _getCurObjFromAssociation(curReqObj, associationName, curSrvObjUUID)

    if (subNodePathVal === nodePathVal) {
      return curReqObj ? curReqObj : {}
    }

    parentSrvObjName = srvObjName
  }

  return curReqObj
}

const getObjectId = async function (entityName, objIdElementNames, curObj) {
  if (!objIdElementNames || !objIdElementNames.length) {
    objIdElementNames = _getObjIdElementNames(entityName)
  }

  if (objIdElementNames) {
    return await _genObjectIdByEntityName(curObj, entityName, objIdElementNames)
  }
  return ""
}

const getDBEntity = function (serviceEntity) {
  if (typeof serviceEntity === 'string') serviceEntity = getEntity(serviceEntity)
  for (const dbEntity of cds.db.entities) {
    if (dbEntity.isPrototypeOf(serviceEntity)) {
      return dbEntity
    }
  }
}

const hasComposition = (parent, target) => {
  if (!parent.compositions) return false
  return Object.values(parent.compositions).some(c => c._target === target)
}

const getValueEntityType = function (srvObjName, objIdElementNames) {
  const entityTypes = []

  for (const objIdElementName of objIdElementNames) {
    const associationEntity = getEntity(srvObjName)
    const isOriginalAttribute = objIdElementName.indexOf(REF_OBJECT_ID_DELIMITER) === -1
    if (isOriginalAttribute) {
      entityTypes.push(associationEntity.elements[objIdElementName]["type"])
    } else {
      const { chainAttributesArr, currentEntityName } = _getLastChainedEntity(objIdElementName, srvObjName)
      const attribute =
        chainAttributesArr.length === 1
          ? chainAttributesArr[0]
          : chainAttributesArr.join(COMPLEX_DATA_TYPE_DELIMITER)
      const currentEntity = getEntity(currentEntityName)
      if (currentEntity.elements[attribute]) {
        entityTypes.push(currentEntity.elements[attribute]["type"])
      }
    }
  }
  return entityTypes.join(VALUE_DELIMITER)
}

module.exports = {
  getCurObjFromReqData,
  getCurObjFromDbQuery,
  getObjectId,
  getNameFromPathVal,
  getUUIDFromPathVal,
  getDBEntity,
  getEntity,
  getEntityByContextPath,
  hasComposition,
  getObjIdElementNamesInArray,
  getAssociationCompositionEntity,
  getValueEntityType,
}
