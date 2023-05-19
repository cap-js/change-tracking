const chai = require("chai");
const { expect } = require("chai");
const templateProcessor = require("../../srv/utils/template-processor");
const { getEntityByContextPath, getEntity, hasComposition } = require("../../srv/utils/entityHelper");

// Configure chai
chai.should();
chai.expect();

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
                return element["@changehistory"];
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
    it("1.0 should return null if content path not exist (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        expect(getEntityByContextPath("")).to.equal(null);
    });

    it("1.1 should return null if entityName not provided (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        expect(getEntity("")).to.equal(null);
    });

    it("1.2 should return false if composition not found (ERP4SMEPREPWORKAPPPLAT-32)", async () => {
        const parentEntity = { compositions: [{ target: "child_entity1" }] };
        const subEntity = { name: "child_entity2" };
        expect(hasComposition(parentEntity, subEntity)).to.equal(false);
    });
});
