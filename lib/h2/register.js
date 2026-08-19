const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');

const { prepareCSNForTriggers, generateTriggersForEntities } = require('../utils/trigger-utils.js');
const { getLabelTranslations } = require('../localization.js');
const { fs } = cds.utils;

function registerH2CompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    const dialect = options?.dialect ?? options?.kind ?? options?.to;
    if (dialect !== 'h2') return ddl;

    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);
    const { generateH2Triggers } = require('./triggers.js');
    const triggers = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateH2Triggers);

    if (triggers.length === 0) return ddl;
    // REVISIT: does mvn:watch produce the same error?
    _writeLabelsCSV(entities, runtimeCSN);

    // H2 uses ";;" as SQL script statement separator when triggers are present
    // ensure every DDL statement is followed by an explicit ";;" so the Spring script initializer splits correctly
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
    } else {
      LOG.warn('H2 triggers could not be appended: unexpected DDL shape from compile.to.dbx (', typeof ddl, ')');
    }

    return ddl;
  });
}

/**
 * Write i18n labels CSV file for H2 deployments
 */
function _writeLabelsCSV(entities, model) {
  const labels = getLabelTranslations(entities, model);
  const header = 'ID;locale;text';
  const rows = labels.map((row) => `${row.ID};${row.locale};${row.text}`);
  const content = [header, ...rows].join('\n') + '\n';
  const dir = 'db/data';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(`${dir}/sap.changelog-i18nKeys.csv`, content);
}

module.exports = { registerH2CompilerHook };
