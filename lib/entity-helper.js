const cds = require("@sap/cds");
const LOG = cds.log("change-log")

const { getAssociationKey, getKey } = require('./keys')

const getNameFromPathVal = function (pathVal) {
  return pathVal?.target;
}

const getUUIDFromPathVal = function (pathVal) {
  return pathVal?.key ?? "";
}

const getEntityByContextPath = function (aPath, hasComp = false) {
  if (hasComp) return cds.model.definitions[aPath[aPath.length - 1].target]
  let entity = cds.model.definitions[aPath[0].target]
  for (let each of aPath.slice(1)) {
    entity = entity.elements[each.target]?._target
  }
  return entity
}

const getObjIdElementNamesInArray = function (elements, shift=true) {
  if (Array.isArray(elements)) return elements.map(e => {
    const splitted = (e["="]||e).split('.')
    if(shift) {
      splitted.shift()
    }
    return splitted.join('.')
  })
  else return []
}

const getCurObjFromDbQuery = async function (entityName, key) {
  if (!key) return {}
  // REVISIT: This always reads all elements -> should read required ones only!
  const obj = await SELECT.one.from(entityName).where(key)
  return obj || {}
}

const getCurObjFromReqData = function (reqData, nodePathVal, pathVals) {
  pathVals = [...pathVals]
  const rootNodePathVal = pathVals[0]
  let curReqObj = reqData || {}

  if (nodePathVal === rootNodePathVal) return curReqObj
  else pathVals.shift()

  let parentSrvObjName = getNameFromPathVal(rootNodePathVal)

  for (const subNodePathVal of pathVals) {
    const srvObjName = getNameFromPathVal(subNodePathVal)
    const associationName = _getAssociationName(parentSrvObjName, srvObjName)
    if (curReqObj) {
      let associationData = curReqObj[associationName]
      if (!Array.isArray(associationData)) associationData = [associationData]
      curReqObj = associationData?.find(x =>
        Object.entries(subNodePathVal.key)
          .every(([k, v]) => 
            x?.[k] === v
        )) || {}
    }
    if (subNodePathVal === nodePathVal) return curReqObj || {}
    parentSrvObjName = srvObjName
  }

  return curReqObj

  function _getAssociationName(entity, target) {
    const source = cds.model.definitions[entity]
    const assocs = source.associations
    for (const each in assocs) {
      if (assocs[each].target === target) return each
    }
  }
}


async function getObjectId (reqData, reqTarget, entityName, fields, curObj) {
  let all = [], { curObjFromReqData: req_data={}, curObjFromDbQuery: db_data={} } = curObj
  let entity = cds.model.definitions[entityName]
  if (!fields?.length) fields = entity["@changelog"]?.map?.(k => k['='] || k) || []
  for (let field of fields) {
    let path = field.split('.')
    if (path.length > 1) {
      let current = entity, _db_data = db_data
      while (path.length > 1) {
        let assoc = current.elements[path[0]]; if (!assoc?.isAssociation) break
        let IDval = null;
        if (current.name === entityName) {
          // try req_data first
          IDval = getAssociationKey(assoc, req_data)
        } 
        if(!IDval) {
          // try db_data otherwise
          IDval = getAssociationKey(assoc, _db_data)
        }

        if (!IDval) {
          _db_data = {};
        } else try {
          // REVISIT: This always reads all elements -> should read required ones only!
          const isComposition = hasComposition(assoc._target, current)
          // Peer association and composition are distinguished by the value of isComposition.
          if (isComposition) {
            // This function can recursively retrieve the desired information from reqData without having to read it from db.
            _db_data = _getCompositionObjFromReq(reqTarget, reqData, IDval)
            // When multiple layers of child nodes are deleted at the same time, the deep layer of child nodes will lose the information of the upper nodes, so data needs to be extracted from the db.
            const entityKeys = reqData ? Object.keys(reqData).filter(item => !Object.keys(assoc._target.keys).some(ele => item === ele)) : [];
            if (!_db_data || JSON.stringify(_db_data) === '{}' || entityKeys.length === 0) {
              _db_data = await getCurObjFromDbQuery(assoc._target, IDval);
            }
          } else {
            _db_data = await getCurObjFromDbQuery(assoc._target, IDval);
          }
        } catch (e) {
          LOG.error("Failed to generate object Id for an association entity.", e)
          throw new Error("Failed to generate object Id for an association entity.", e)
        }
        current = assoc._target
        path.shift()
      }
      field = path.join('_')
      let obj = current.name === entityName && req_data[field] ? req_data[field] : _db_data[field]
      if (obj) all.push(obj)
    } else {
      let e = entity.elements[field]
      if (e?.isAssociation) field = e.keys?.[0]?.$generatedFieldName
      let obj = req_data[field] || db_data[field]
      if (obj) all.push(obj)
    }
  }
  return all.join(', ')
}



const getDBEntity = (entity) => {
  if (typeof entity === 'string') entity = cds.model.definitions[entity]
  let proto = Reflect.getPrototypeOf(entity)
  if (proto instanceof cds.entity) return proto
}

const getValueEntityType = function (entityName, fields) {
  const types=[], entity = cds.model.definitions[entityName]
  for (let field of fields) {
    let current = entity, path = field.split('.')
    if (path.length > 1) {
      for (;;) {
        let target = current.elements[path[0]]?._target
        if (target) current = target; else break
        path.shift()
      }
      field = path.join('_')
    }
    let e = current.elements[field]
    if (e) types.push(e.type)
  }
  return types.join(', ')
}

const hasComposition = function (parentEntity, subEntity) {
  if (!parentEntity.compositions) {
    return false
  }

  const compositions = Object.values(parentEntity.compositions);

  for (const composition of compositions) {
    if (composition.target === subEntity.name) {
      return true;
    }
  }

  return false
}

const _getCompositionObjFromReq = function (entity, obj, objkey) {
    if (JSON.stringify(getKey(entity, obj)) === JSON.stringify(objkey)) {
        return obj;
    }


    for (const key in obj) {
      const subobj = obj[key];
        if (typeof subobj === "object" && subobj !== null) {
            if(Array.isArray(subobj)) {
              for(let subobjobj of subobj) {
                const result = _getCompositionObjFromReq(entity.elements[key]._target, subobjobj, objkey);
                if (result) {
                    return result;
                }  
              }
            } else {
              const result = _getCompositionObjFromReq(entity.elements[key]._target, obj[key], objkey);
              if (result) {
                  return result;
              }
            }
        }
    }

    return null;
};

module.exports = {
  getCurObjFromReqData,
  getCurObjFromDbQuery,
  getObjectId,
  getNameFromPathVal,
  getUUIDFromPathVal,
  getDBEntity,
  getEntityByContextPath,
  getObjIdElementNamesInArray,
  getValueEntityType,
}
