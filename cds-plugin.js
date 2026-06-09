const cds = require('@sap/cds');

const { enhanceModel } = require('./lib/csn-enhancements');
const { registerSessionVariableHandlers } = require('./lib/skipHandlers.js');
const { registerSQLiteCompilerHook } = require('./lib/sqlite/register.js');
const { registerPostgresCompilerHook } = require('./lib/postgres/register.js');
const { registerH2CompilerHook } = require('./lib/h2/register.js');
const { registerHDICompilerHook } = require('./lib/hana/register.js');

cds.on('loaded', enhanceModel);
cds.on('compile.to.edmx', enhanceModel);
cds.on('listening', registerSessionVariableHandlers);

// Enhance CSNs returned by cds.xt.ModelProviderService.getExtCsn
cds.on('serving', (srv) => {
  if (srv.name !== 'cds.xt.ModelProviderService') return;
  srv.after(['getCsn', 'getExtCsn'], (csn) => {
    if (!csn || typeof csn !== 'object' || !csn.definitions) return;
    enhanceModel(csn);
  });
});

registerSQLiteCompilerHook();
registerPostgresCompilerHook();
registerH2CompilerHook();
registerHDICompilerHook();

cds.add?.register?.('change-tracking-migration', require('./lib/addMigrationTable.js'));
