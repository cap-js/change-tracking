const InsertResults = require('@cap-js/db-service/lib/InsertResults.js');
const cds = require('@sap/cds');

// `validateStatus: () => true` makes all HTTP responses resolve (never throw), so the
// status/error checks below can run for both HCQL-format errors and raw HTTP errors.
const HCQL_REQ_CONFIG = {
  headers: { 'content-type': 'application/json' },
  validateStatus: () => true
};

class JavaHcqlService extends cds.Service {
  async init() {
    const { axios, proxyMap } = this.options;

    this.on('*', async (req) => {
      // Determine the ORIGINAL target entity (service-level, pre proxy rewrite).
      // We use its projection/query columns to translate aliases back to the
      // underlying DB column names before dispatching to Java, which only sees
      // the DB schema through the proxy.
      const originalTarget = req.query.INSERT?.into?.ref?.[0] ?? req.query.UPSERT?.into?.ref?.[0] ?? req.query.UPDATE?.entity?.ref?.[0] ?? null;
      const originalDef = (typeof originalTarget === 'string' && cds.model.definitions[originalTarget]) || null;
      const projectionColumns = originalDef?.projection?.columns ?? originalDef?.query?.SELECT?.columns ?? null;

      let json = JSON.stringify(req.query);

      // CQN JSON can include (fully qualified) db-entity-names in only two places:
      //   As the first element of a `ref` array, always preceeded by '['
      //   > e.g.: ["db.bookshop.Books"...]
      //   As an id in a navigation segment, always preceeded by '"id":'
      //   > e.g.: {"id":"bookshop.Books",...}
      // -> Use replace instead of parsing the CQN, to inject proxy-entity-refs
      for (const [from, to] of Object.entries(proxyMap)) json = json.replace(new RegExp(`(?<=\\[|"id":)"${from.replace(/\./g, '\\.')}"`, 'g'), `"${to}"`);

      // Java HCQL rejects `= /!= {"val":null}`:
      // -> globally convert to `is / is not "null"`
      json = json.replace(/"(?:(=)|(!=))",{"val":null}/g, (_, is, isNot) => {
        if (is) return '"is","null"';
        if (isNot) return '"is not","null"';
      });

      const query = JSON.parse(json);

      if (query.INSERT?.columns) {
        const ins = query.INSERT;
        const toEntry = (row) =>
          ins.columns.reduce((e, col, i) => {
            e[col] = row[i];
            return e;
          }, {});
        if (ins.rows) {
          ins.entries = ins.rows.map(toEntry);
          delete ins.rows;
        }
        if (ins.values) {
          ins.entries = [toEntry(ins.values)];
          delete ins.values;
        }
      }

      // Node CDS/SQLite silently ignores columns that are not declared on the
      // target entity, e.g. tests that write `customer_ID` onto an `Order`
      // entity which has no `customer` association. CAP Java's HCQL layer is
      // strict and rejects those requests with `CdsElementNotFoundException`.
      // -> Drop unknown top-level entries so the Java runtime matches the
      //    node-side behavior. Only applied to INSERT/UPSERT/UPDATE; SELECT
      //    columns are left untouched because their semantics differ.
      //
      // In addition, service projections often *rename* base entity columns
      // (`ID, srvRenamedDateTimeWDTZ as renamedDateTime`). The dbProxy carries
      // the underlying column names (`srvRenamedDateTimeWDTZ`) because it
      // mirrors the DB table, so we need to translate the projection aliases
      // back to their source column name before dispatch. `originalElements`
      // (captured above from `req.query`) still points at the service-level
      // definition and contains the alias -> source-ref mapping.
      const mutation = query.INSERT ?? query.UPSERT ?? query.UPDATE;
      if (mutation) {
        // Target has already been proxy-mapped above, so look it up directly
        // in the (proxy-augmented) cds model.
        const targetName = mutation.into?.ref?.[0] ?? mutation.entity?.ref?.[0];
        const elements = targetName && cds.model.definitions[targetName]?.elements;
        // Build alias -> dbColumn map from the ORIGINAL (service) entity, if
        // it aliased any columns. Only aliases whose source is a single-ref
        // scalar are safe to rewrite here.
        const aliasMap = {};
        if (projectionColumns) {
          for (const col of projectionColumns) {
            const alias = col?.as;
            const sourceRef = col?.ref;
            if (alias && Array.isArray(sourceRef) && sourceRef.length === 1 && sourceRef[0] !== alias) {
              aliasMap[alias] = sourceRef[0];
            }
          }
        }
        // Also rewrite UPDATE's `data` object (from `.set({ ... })`).
        const rewriteObject = (obj) => {
          for (const key of Object.keys(obj)) {
            if (aliasMap[key]) {
              obj[aliasMap[key]] = obj[key];
              delete obj[key];
              continue;
            }
            if (elements && !(key in elements)) delete obj[key];
          }
        };
        if (mutation.entries && elements) {
          for (const entry of mutation.entries) rewriteObject(entry);
        }
        if (mutation.data && elements) {
          rewriteObject(mutation.data);
        }
      }

      const res = await axios.post('/hcql/dbProxy', query, HCQL_REQ_CONFIG);

      if (res.data.errors?.length) {
        for (const { message } of res.data.errors) req.error(message);
        throw req.reject();
      }

      if (res.status >= 400) {
        req.error(res.data?.message ?? res.data?.error ?? `HCQL request failed with HTTP ${res.status}`);
        try {
          req.reject();
        } catch (err) {
          err.proxyError = true;
          err.httpStatus = res.status;
          throw err;
        }
      }

      if (req.query.SELECT) return req.query.SELECT.one ? res.data.data[0] : res.data.data;
      if (req.query.INSERT) return new InsertResults(req.query, res.data.data);

      return res.data.rowCounts?.reduce((l, c) => l + c) ?? res.data.data?.length ?? res.data.data;
    });
  }

  // Overrides parent URL derivation — this service has no URL; the string is for display only.
  url4() {
    return 'Java Proxy';
  }
}

module.exports = JavaHcqlService;
