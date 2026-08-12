/**
 * Vitest setup file that switches the CAP Node.js `cds.test()` helper into a mode where
 * it launches a CAP Java application and routes all `cds.db` queries against the Java
 * runtime over HCQL.
 */

const isJavaEnv = /java/i.test(process.env.CDS_ENV || '');

if (isJavaEnv) {
  const cds = require('@sap/cds');

  // touch cds.test to trigger the lazy getter -> makes it writable
  const _cdsTest = cds.test;

  cds.test = function (...args) {
    let cds_test;

    // Install Java launcher *before* @cap-js/cds-test's internal `before()` hook fires
    // its cds.exec() invocation. Because `before(...)` in vitest maps to `beforeAll`,
    // hooks run in registration order -> we must register ours first.
    before(async () => {
      const localJava = require('../lib/testing/java.js');
      cds.exec;
      cds.exec = localJava.bind(cds_test);
    });

    cds_test = _cdsTest(...args);

    // Ensure axios never throws on >=400 responses so tests can inspect status themselves (mirror cap-js/cds-test)
    cds_test.defaults.validateStatus = () => true;
    cds_test.defaults.headers.Accept = 'application/json';

    return cds_test;
  };

  // Re-export cds.test's static helpers so existing usage keeps working
  Object.setPrototypeOf(cds.test, _cdsTest);
  for (const key of Object.keys(_cdsTest)) cds.test[key] = _cdsTest[key];
}
