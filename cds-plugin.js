const cds = require('@sap/cds');

const { enhanceModel } = require('./lib/csn-enhancements');
const { registerSessionVariableHandlers } = require('./lib/skipHandlers.js');
const { registerSQLiteDeploymentHandler, deploySQLiteTriggers } = require('./lib/sqlite/register.js');
const { registerPostgresCompilerHook, deployPostgresLabels } = require('./lib/postgres/register.js');
const { registerH2CompilerHook } = require('./lib/h2/register.js');
const { registerHDICompilerHook } = require('./lib/hana/register.js');

cds.on('loaded', enhanceModel);
cds.on('compile.to.edmx', enhanceModel);
//cds.on('compile.to.runtime', enhanceModel);

// REVISIT: Remove once `compile.for.runtime` is reliably called for tenant-specific models
// enhance CSNs returned by cds.xt.ModelProviderService.getExtCsn
cds.on('serving', (srv) => {
  if (srv.name !== 'cds.xt.ModelProviderService') return;
  srv.after(['getCsn', 'getExtCsn'], (csn) => {
    if (!csn || typeof csn !== 'object' || !csn.definitions) return;
    enhanceModel(csn);
  });
});

cds.on('listening', registerSessionVariableHandlers);
cds.once('served', async () => {
  await deploySQLiteTriggers();
  await deployPostgresLabels();
});

registerSQLiteDeploymentHandler();
registerH2CompilerHook();
registerPostgresCompilerHook();
registerHDICompilerHook();

cds.add?.register?.('change-tracking-migration', require('./lib/addMigrationTable.js'));
