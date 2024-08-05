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
        const entityID = "dd1fdd7d-da2a-4600-940b-0baf2946c9bf";
        await UPDATE.entity(entity, { ID: entityID })
          .set({ ActivationStatus_code: "VALID" });
        // const noteEntity = "AdminService.OrderItemNote";
        // const noteEntityID = "a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc";
        //   await UPDATE.entity(noteEntity, { ID: noteEntityID })
        //   .set({ ActivationStatus_code: "VALID" });
        // await UPDATE.entity(entity)
        //   .where({ ID: entityID })
        //   .set({ ActivationStatus_code: "VALID" });
    };

    const onActivateOrderItemNote = async (req) => {
        const entity = req.entity;
        const entityID = "a40a9fd8-573d-4f41-1111-fa8ea0d8b1bc";
        await UPDATE.entity(entity)
          .where({ ID: entityID })
          .set({ ActivationStatus_code: "VALID" });
    };

    srv.on("activate", "Volumns", onActivateVolumns);
    // srv.on("activate", "*", onActivateVolumns);
    srv.on("activate", "OrderItemNote", onActivateOrderItemNote);
});
