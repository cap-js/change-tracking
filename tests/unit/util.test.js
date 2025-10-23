const cds = require("@sap/cds");
const { expect } = cds.test
const { templateProcessor } = require("../../lib/template-processor");
const { getEntityByContextPath } = require("../../lib/entity-helper");

// Enable locale fallback to simulate end user requests
cds.env.features.locale_fallback = true

const _processorFn = (changeMap) => {
    return ({ row, key, element }) => {
        if (!row || !key || !element) {
            return;
        }

        changeMap.get("test-entity").push({});
    };
};

describe("templateProcessor", () => {
    it("should return undefined if template processor get null sub rows (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        const changeMap = new Map();
        const elements = new Map();
        const diff = { _op: "Delete", test: "test", subRow: [{ _op: "Delete", test: "test" }] };
        elements.set("test", {
            template: { elements: [], target: { elements: elements, keys: [] } },
            picked: (element) => {
                return element["@changelog"];
            },
        });
        const template = { elements: elements, target: { elements: elements, keys: [] } };
        const pathOptions = {
            segments: [{ includeKeyValues: true }],
            includeKeyValues: true,
            rowKeysGenerator: () => {
                return;
            },
        };
        const args = { processFn: _processorFn(changeMap), row: diff, template, isRoot: true, pathOptions };
        expect(templateProcessor(args)).to.equal(undefined);
    });
});

describe("entityHelper", () => {
    cds.model = { definitions: {} }

    it("1.0 should return null if content path not exist (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        expect(getEntityByContextPath("".split('/'))).to.not.exist;
    });

    it("1.2 should return false if composition not found (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        const parentEntity = { compositions: [{ target: "child_entity1" }] };
        const subEntity = { name: "child_entity2" };
        let hasComposition = Object.values(parentEntity.compositions).some(c => c._target === subEntity)
        expect(hasComposition).to.equal(false);
    });
});
