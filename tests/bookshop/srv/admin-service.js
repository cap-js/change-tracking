const cds = require("@sap/cds");

module.exports = cds.service.impl(async (srv) => {
    srv.before("CREATE", "BookStores", async (req) => {
        const newBookStores = req.data;
        newBookStores.lifecycleStatus_code = "IP";
    });
});
