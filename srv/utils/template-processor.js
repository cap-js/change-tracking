//  Enhanced class based on cds v5.5.5 @sap/cds/libx/_runtime/common/utils/templateProcessor

const DELIMITER = require("@sap/cds/libx/_runtime/common/utils/templateDelimiter");
const { OBJECT_PATH_DELIMITER } = require("./const");

const _formatRowContext = (tKey, keyNames, row) => {
    const keyValuePairs = keyNames.map((key) => `${key}=${row[key]}`);
    const keyValuePairsSerialized = keyValuePairs.join(",");
    return `${tKey}(${keyValuePairsSerialized})`;
};

const _processElement = (processFn, row, key, elements, isRoot, pathSegments, picked = {}) => {
    const element = elements[key];
    const { plain } = picked;

    if (plain) {
        /**
         * @type import('../../types/api').templateProcessorProcessFnArgs
         */
        const elementInfo = { row, key, element, plain, isRoot, pathSegments };
        processFn(elementInfo);
    }
};

const _processRow = (processFn, row, template, tKey, tValue, isRoot, pathOptions) => {
    const { template: subTemplate, picked } = tValue;
    const key = tKey.split(DELIMITER).pop();
    const { segments: pathSegments } = pathOptions;

    if (!subTemplate && pathSegments) {
        pathSegments.push(key);
    }

    _processElement(processFn, row, key, template.target.elements, isRoot, pathSegments, picked);

    // process deep
    if (subTemplate) {
        let subRows = row && row[key];

        subRows = Array.isArray(subRows) ? subRows : [subRows];

        // Build entity path
        subRows.forEach((subRow) => {
            if (subRow && row && row._path) {
                /** Enhancement by SME: Support CAP Change Histroy
                 *  Construct path from root entity to current entity.
                 */
                const serviceNodeName = template.target.elements[key].target;
                subRow._path = `${row._path}${OBJECT_PATH_DELIMITER}${serviceNodeName}(${subRow.ID})`;
            }
        });

        _processComplex(processFn, subRows, subTemplate, key, pathOptions);
    }
};

const _processComplex = (processFn, rows, template, tKey, pathOptions) => {
    if (rows.length === 0) {
        return;
    }

    const segments = pathOptions.segments;
    let keyNames;

    for (const row of rows) {
        if (row == null) {
            continue;
        }

        const args = { processFn, row, template, isRoot: false, pathOptions };

        if (pathOptions.includeKeyValues) {
            keyNames = keyNames || (template.target.keys && Object.keys(template.target.keys)) || [];
            pathOptions.rowKeysGenerator(keyNames, row, template);
            const pathSegment = _formatRowContext(tKey, keyNames, { ...row, ...pathOptions.extraKeys });
            args.pathOptions.segments = segments ? [...segments, pathSegment] : [pathSegment];
        }

        templateProcessor(args);
    }
};

/**
 * @param {import("../../types/api").TemplateProcessor} args
 */
const templateProcessor = ({ processFn, row, template, isRoot = true, pathOptions = {} }) => {
    const segments = pathOptions.segments && [...pathOptions.segments];

    for (const [tKey, tValue] of template.elements) {
        if (segments) {
            pathOptions.segments = [...segments];
        }
        _processRow(processFn, row, template, tKey, tValue, isRoot, pathOptions);
    }
};

module.exports = templateProcessor;
