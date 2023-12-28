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
});
