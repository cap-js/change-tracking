const cds = require('@sap/cds');

const { prepareCSNForTriggers, generateTriggersForEntities, writeLabelsCSV } = require('../utils/trigger-utils.js');

function registerH2CompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    const dialect = options?.dialect ?? options?.kind ?? options?.to;
    if (dialect !== 'h2') return ddl;

    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);
    const { generateH2Triggers } = require('./triggers.js');
    const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateH2Triggers);

    if (triggers.length === 0) return ddl;

    // For CAP Java (H2), CSV data is loaded from `db/data/`. Write the i18n keys there
    // so the sap.changelog.i18nKeys table is populated during application startup.
    writeLabelsCSV(entities, runtimeCSN, 'db/data');

    // H2 uses ";;" as SQL script statement separator when triggers are present
    // (see application.yaml: sql.init.separator: ";;"). Ensure every DDL statement
    // is followed by an explicit ";;" so the Spring script initializer splits correctly.
    const terminate = (s) => {
      const t = s.trimEnd();
      if (t.endsWith(';;')) return s;
      if (t.endsWith(';')) return s + ';';
      return s + ';;';
    };

    if (Array.isArray(ddl)) {
      for (let i = 0; i < ddl.length; i++) ddl[i] = terminate(ddl[i]);
      ddl.push(...triggers);
    } else if (ddl?.createsAndAlters) {
      for (let i = 0; i < ddl.createsAndAlters.length; i++) ddl.createsAndAlters[i] = terminate(ddl.createsAndAlters[i]);
      ddl.createsAndAlters.push(...triggers);
    }

    return ddl;
  });
}

module.exports = { registerH2CompilerHook };
