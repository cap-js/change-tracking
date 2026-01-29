const cds = require('@sap/cds');
const { templateProcessor } = require('../../lib/template-processor');
const { getEntityByContextPath } = require('../../lib/entity-helper');

cds.env.features.locale_fallback = true;

const _processorFn = (changeMap) => {
    return ({ row, key, element }) => {
        if (!row || !key || !element) {
            return;
        }
        changeMap.get('test-entity').push({});
    };
};

describe('Template Processor', () => {
    it('should return undefined when template processor receives null sub rows', async () => {
        const changeMap = new Map();
        const elements = new Map();
        const diff = { _op: 'Delete', test: 'test', subRow: [{ _op: 'Delete', test: 'test' }] };
        elements.set('test', {
            template: { elements: [], target: { elements: elements, keys: [] } },
            picked: (element) => {
                return element['@changelog'];
            }
        });
        const template = { elements: elements, target: { elements: elements, keys: [] } };
        const pathOptions = {
            segments: [{ includeKeyValues: true }],
            includeKeyValues: true,
            rowKeysGenerator: () => {
                return;
            }
        };
        const args = { processFn: _processorFn(changeMap), row: diff, template, isRoot: true, pathOptions };

        expect(templateProcessor(args)).toBeUndefined();
    });
});

describe('Entity Helper', () => {
    cds.model = { definitions: {} };

    it('should return undefined when context path is empty', async () => {
        expect(getEntityByContextPath(''.split('/'))).toBeUndefined();
    });

    it('should return false when composition is not found in parent entity', async () => {
        const parentEntity = { compositions: [{ target: 'child_entity1' }] };
        const subEntity = { name: 'child_entity2' };
        const hasComposition = Object.values(parentEntity.compositions).some((c) => c._target === subEntity);

        expect(hasComposition).toBe(false);
    });
});
