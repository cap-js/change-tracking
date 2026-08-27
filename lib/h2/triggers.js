const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getGrandParentCompositionInfo, getAncestorCompositionChain } = require('../utils/composition-helpers.js');
const { _generateJavaClass, _generateCreateBody, _generateUpdateBody, _generateDeleteBody, _generateDeleteBodyPreserve, _fqcnForEntity } = require('./java-codegen.js');

function generateH2Triggers(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
  const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
  const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
  const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

  // Check if this entity is a tracked composition target (composition-of-many)
  const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

  // Backwards-compatible grandparent info (single-level).
  const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField, ancestorChain } = grandParentContext;
  const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

  // Resolve the FULL ancestor levels chain (grandparent, great-grandparent, …)
  // so multi-level composition hierarchies produce a full chain of changelog
  // entries. Only applicable when we have an immediate parent (composition of
  // many).
  let ancestorLevels = [];
  if (compositionParentInfo && compositionParentInfo.parentKeyBinding?.type !== 'compositionOfOne' && ancestorChain && ancestorChain.length > 0) {
    ancestorLevels = getAncestorCompositionChain(rootEntity, ancestorChain, csn);
  }

  // Generate triggers if we have tracked columns OR if this is a composition target
  const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
  if (!shouldGenerateTriggers) return null;

  // Generate the Java code for each section
  const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo, ancestorChain) : '';
  const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo, ancestorChain) : '';
  let deleteBody = '';
  if (!config?.disableDeleteTracking) {
    deleteBody = config?.preserveDeletes
      ? _generateDeleteBodyPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo, ancestorChain)
      : _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo, ancestorChain);
  }

  const { className, source } = _generateJavaClass(createBody, updateBody, deleteBody, entity.name, compositionParentInfo, grandParentCompositionInfo, ancestorLevels);

  // H2 CREATE TRIGGER ... CALL '<fqcn>' references the compiled Java class on the JVM classpath
  const tableName = utils.transformName(entity.name);
  const fqcn = _fqcnForEntity(entity.name);
  const ddl = `CREATE TRIGGER ${tableName}_ct AFTER INSERT, UPDATE, DELETE ON ${tableName} FOR EACH ROW CALL '${fqcn}';`;

  return { ddl, java: { className, source, entityName: entity.name } };
}

module.exports = { generateH2Triggers };
