const utils = require('../utils/change-tracking.js');
const config = require('@sap/cds').env.requires['change-tracking'];
const { getCompositionParentInfo, getGrandParentCompositionInfo } = require('../utils/composition-helpers.js');
const { _generateJavaMethod, _generateCreateBody, _generateUpdateBody, _generateDeleteBody, _generateDeleteBodyPreserve } = require('./java-codegen.js');

function generateH2Trigger(csn, entity, rootEntity, mergedAnnotations = null, rootMergedAnnotations = null, grandParentContext = {}) {
	const { columns: trackedColumns } = utils.extractTrackedColumns(entity, csn, mergedAnnotations);
	const objectIDs = utils.getObjectIDs(entity, csn, mergedAnnotations?.entityAnnotation);
	const rootObjectIDs = utils.getObjectIDs(rootEntity, csn, rootMergedAnnotations?.entityAnnotation);

	// Check if this entity is a tracked composition target (composition-of-many)
	const compositionParentInfo = getCompositionParentInfo(entity, rootEntity, rootMergedAnnotations);

	// Get grandparent info for deep linking (e.g., OrderItemNote -> OrderItem.notes -> Order.orderItems)
	const { grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField } = grandParentContext;
	const grandParentCompositionInfo = getGrandParentCompositionInfo(rootEntity, grandParentEntity, grandParentMergedAnnotations, grandParentCompositionField);

	// Generate triggers if we have tracked columns OR if this is a composition target
	const shouldGenerateTriggers = trackedColumns.length > 0 || compositionParentInfo;
	if (!shouldGenerateTriggers) return null;

	// Generate the Java code for each section
	const createBody = !config?.disableCreateTracking ? _generateCreateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo) : '';
	const updateBody = !config?.disableUpdateTracking ? _generateUpdateBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo) : '';
	let deleteBody = '';
	if (!config?.disableDeleteTracking) {
		deleteBody = config?.preserveDeletes
			? _generateDeleteBodyPreserve(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo)
			: _generateDeleteBody(entity, trackedColumns, objectIDs, rootEntity, rootObjectIDs, csn, compositionParentInfo, grandParentCompositionInfo);
	}

	// Define the full Create Trigger SQL
	return `CREATE TRIGGER ${utils.transformName(entity.name)}_ct
            AFTER INSERT, UPDATE, DELETE ON ${utils.transformName(entity.name)}
            FOR EACH ROW
            AS $$
            ${_generateJavaMethod(createBody, updateBody, deleteBody, entity.name, compositionParentInfo, grandParentCompositionInfo)}
            $$;;`;
}

module.exports = { generateH2Trigger };
