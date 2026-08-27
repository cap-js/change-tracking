const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');

const { prepareCSNForTriggers, generateTriggersForEntities } = require('../utils/trigger-utils.js');
const { getLabelTranslations } = require('../localization.js');
const { _generateAbstractBaseClass, TRIGGER_JAVA_PACKAGE } = require('./java-codegen.js');
const { fs, path } = cds.utils;

// Path where the per-entity trigger classes and shared abstract base class are written
const TRIGGER_JAVA_PACKAGE_PATH = TRIGGER_JAVA_PACKAGE.replace(/\./g, '/');

function registerH2CompilerHook() {
  cds.on('compile.to.dbx', (csn, options, next) => {
    const ddl = next();
    const dialect = options?.dialect ?? options?.kind ?? options?.to;
    if (dialect !== 'h2') return ddl;

    const { runtimeCSN, hierarchy, entities } = prepareCSNForTriggers(csn, true);
    const { generateH2Triggers } = require('./triggers.js');
    const results = generateTriggersForEntities(runtimeCSN, hierarchy, entities, generateH2Triggers);

    if (results.length === 0) return ddl;
    // REVISIT: does mvn:watch produce the same error?
    _writeLabelsCSV(entities, runtimeCSN);

    // Split the mixed result set into DDL strings + Java class sources.
    const triggerDDLs = results.map((r) => r.ddl);
    const javaClasses = results.map((r) => r.java);
    _writeTriggerJavaFiles(javaClasses);

    if (Array.isArray(ddl)) {
      ddl.push(...triggerDDLs);
    } else if (ddl?.createsAndAlters) {
      ddl.createsAndAlters.push(...triggerDDLs);
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

/**
 * Write one `.java` file per generated trigger into `srv/src/gen/java/<package>/`
 * The output directory is wiped first to cleanup stale trigger classes from a previous builds
 *
 * `cds:generate` (part of `cds-maven-plugin`) registers `srv/src/gen` as a
 * Maven compile source root, so these files are picked up automatically.
 */
function _writeTriggerJavaFiles(javaClasses) {
  const projectRoot = cds.root;
  const srvDir = _findSrvDir(projectRoot);
  const outputDir = path.join(srvDir, 'src', 'gen', 'java', TRIGGER_JAVA_PACKAGE_PATH);

  // Wipe stale generated triggers so a renamed / removed entity doesn't leave
  // a dangling class behind. Only touches our own package directory.
  if (fs.existsSync(outputDir)) {
    for (const file of fs.readdirSync(outputDir)) {
      if (file.endsWith('.java')) {
        fs.unlinkSync(path.join(outputDir, file));
      }
    }
  } else {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const base = _generateAbstractBaseClass();
  fs.writeFileSync(path.join(outputDir, `${base.className}.java`), base.source);

  for (const cls of javaClasses) {
    fs.writeFileSync(path.join(outputDir, `${cls.className}.java`), cls.source);
  }

  LOG.info(`Wrote ${javaClasses.length + 1} H2 trigger Java file(s) to ${outputDir}`);
}

/**
 * Locate the CAP Java service module directory. In the standard CAP Java
 * layout this is `<projectRoot>/srv`, but the plugin should still work if
 * the compile hook fires directly inside the service module (in which case
 * `cds.root` already points at `.../srv`).
 */
function _findSrvDir(projectRoot) {
  const candidate = path.join(projectRoot, 'srv');
  if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'pom.xml'))) return candidate;
  return projectRoot;
}

module.exports = { registerH2CompilerHook };
