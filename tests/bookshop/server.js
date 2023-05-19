const cds = require("@sap/cds");
const changeLog = require("../../index");

cds.once("served", (services) => {
    changeLog.setup(services);
});

if (process.env.NODE_ENV !== "production") {
    const cds_swagger = require("cds-swagger-ui-express");
    cds.on("bootstrap", (app) => app.use(cds_swagger()));
}

module.exports = cds.server;
