#!/usr/bin/env node
/**
 * Generate the HCQL proxy CDS/JSON files (srv/db-proxy.json + srv/db-proxy.cds)
 * for a CAP application without launching the Java runtime.
 *
 * Usage:
 *   node lib/testing/generate-proxy.js [appDir]
 *
 * Defaults to `.` (current directory).
 */
const cds = require('@sap/cds');
const path = require('node:path');
const { generateProxy } = require('./java.js');

const LOG = cds.log('change-tracking');

const appDir = process.argv[2] || '.';

generateProxy(path.resolve(appDir)).catch((e) => {
  LOG.error(e);
  process.exit(1);
});
