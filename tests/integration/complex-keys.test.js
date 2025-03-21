const cds = require("@sap/cds");
const complexkeys = require("path").resolve(__dirname, "./complex-keys/");
const { expect, data, POST, DELETE } = cds.test(complexkeys);

let ChangeView = null;
let db = null;

describe("change log with complex keys", () => {
    beforeAll(async () => {
        data.reset();
        db = await cds.connect.to("sql:my.db");
        ChangeView = db.model.definitions["sap.changelog.ChangeView"];
    });

    beforeEach(async () => {
        await data.reset();
    });

    it("logs many-to-many composition create with complex keys correctly", async () => {

        const root = await POST(`/complex-keys/Root`, {
            MySecondId: "asdasd",
            name: "Root"
        });
        expect(root.status).to.equal(201)

        const linked1 = await POST(`/complex-keys/Linked`, {
            name: "Linked 1"
        });
        expect(linked1.status).to.equal(201)

        const linked2 = await POST(`/complex-keys/Linked`, {
            name: "Linked 2"
        });
        expect(linked2.status).to.equal(201)

        const link1 = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/links`, {
            linked_ID: linked1.data.ID
        });
        expect(link1.status).to.equal(201)

        const link2 = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/links`, {
            linked_ID: linked2.data.ID
        });
        expect(link2.status).to.equal(201)

        const save = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/complexkeys.ComplexKeys.draftActivate`, { preserveChanges: false })
        expect(save.status).to.equal(201)

        const changes = await SELECT.from(ChangeView);
        expect(changes).to.have.length(3);
        expect(changes.map(change => ({
            modification: change.modification,
            attribute: change.attribute,
            valueChangedTo: change.valueChangedTo,
        }))).to.have.deep.members([
            {
                attribute: 'name',
                modification: 'create',
                valueChangedTo:
                    'Root'
            }, {
                attribute: 'links',
                modification: 'create',
                valueChangedTo:
                    'Linked 1'
            }, {
                attribute: 'links',
                modification: 'create',
                valueChangedTo:
                    'Linked 2'
            }])
    })


    it("logs many-to-many composition create+delete with complex keys correctly", async () => {
        const root = await POST(`/complex-keys/Root`, {
            MySecondId: "asdasd",
            name: "Root"
        });
        expect(root.status).to.equal(201)

        const linked1 = await POST(`/complex-keys/Linked`, {
            name: "Linked 1"
        });
        expect(linked1.status).to.equal(201)

        const link = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/links`, {
            linked_ID: linked1.data.ID,
            root_ID: root.ID
        });
        expect(link.status).to.equal(201)

        const save = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/complexkeys.ComplexKeys.draftActivate`, { preserveChanges: false })
        expect(save.status).to.equal(201)

        const edit = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=true)/complexkeys.ComplexKeys.draftEdit`, { preserveChanges: false })
        expect(edit.status).to.equal(201)

        const link1delete = await DELETE(`/complex-keys/Link(root_MyId=${root.data.MyId},root_MySecondId='asdasd',linked_ID=${linked1.data.ID},IsActiveEntity=false)`);
        expect(link1delete.status).to.equal(204)

        const save2 = await POST(`/complex-keys/Root(MyId=${root.data.MyId},MySecondId='asdasd',IsActiveEntity=false)/complexkeys.ComplexKeys.draftActivate`, { preserveChanges: false })
        expect(save2.status).to.equal(200)

        const changes = await SELECT.from(ChangeView);
        expect(changes).to.have.length(3);
        expect(changes.map(change => ({
            modification: change.modification,
            attribute: change.attribute,
            valueChangedFrom: change.valueChangedFrom,
            valueChangedTo: change.valueChangedTo,
        }))).to.have.deep.members([
            {
                attribute: 'name',
                modification: 'create',
                valueChangedFrom:
                    '',
                valueChangedTo:
                    'Root'
            }, {
                attribute: 'links',
                modification: 'create',
                valueChangedFrom:
                    '',
                valueChangedTo:
                    'Linked 1'
            }, {
                attribute: 'links',
                modification: 'delete',
                valueChangedFrom:
                    'Linked 1',
                valueChangedTo:
                    ''
            }])
    })
});
