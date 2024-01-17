const cds = require("@sap/cds");

module.exports = cds.service.impl(async (srv) => {
    srv.before("CREATE", "BookStores.drafts", async (req) => {
        const newBookStores = req.data;
        newBookStores.lifecycleStatus_code = "IP";
    });
    srv.before("CREATE", "RootEntity.drafts", async (req) => {
        const newRootEntity = req.data;
        newRootEntity.lifecycleStatus_code = "IP";
    });

    const onActivateVolumns = async (req) => {
        const entity = req.entity;
        const entityID = req._params[req._params.length - 1].ID;
        await UPDATE.entity(entity)
          .where({ ID: entityID })
          .set({ ActivationStatus_code: "VALID" });
    };

    const onActivateOrderItemNote = async (req) => {
        const entity = req.entity;
        const entityID = req._params[req._params.length - 1];
        await UPDATE.entity(entity)
          .where({ ID: entityID })
          .set({ ActivationStatus_code: "VALID" });
    };

    srv.on("activate", "Volumns", onActivateVolumns);
    srv.on("activate", "OrderItemNote", onActivateOrderItemNote);
});
