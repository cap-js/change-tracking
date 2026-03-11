const cds = require('@sap/cds');

const { enhanceModel } = require('./lib/model-enhancer.js');
const { registerSessionVariableHandlers } = require('./lib/skipHandlers.js');
const { deploySQLiteTriggers } = require('./lib/sqlite/register.js');
const { registerPostgresCompilerHook, deployPostgresLabels } = require('./lib/postgres/register.js');
const { registerH2CompilerHook } = require('./lib/h2/register.js');
const { registerHDICompilerHook } = require('./lib/hana/register.js');

cds.on('loaded', enhanceModel);
cds.on('listening', registerSessionVariableHandlers);
cds.once('served', async () => {
    await deploySQLiteTriggers();
    await deployPostgresLabels();
});

registerH2CompilerHook();
registerPostgresCompilerHook();
registerHDICompilerHook();
