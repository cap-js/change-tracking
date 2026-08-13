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

    // Workaround: Olingo's JSON MetadataDocumentJsonSerializer (as shipped with
    // CAP Java 5.0.2) throws EdmException("Comparison Or Logical expression
    // MUST have a left and right expression.") on certain deeply-nested
    // logical annotations that we generate correctly in EDMX. The XML
    // serializer accepts the same annotations. Force `Accept: application/xml`
    // whenever a test requests `$metadata` to sidestep the runtime bug —
    // tests only inspect `status` and text fragments, so XML is a fully
    // compatible substitute for JSON.
    const _get = cds_test.get.bind(cds_test);
    cds_test.get = (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : String.raw(...args);
      if (/\/\$metadata(?:$|\?)/.test(url)) {
        const config = args[args.length - 1];
        const isConfig = config && typeof config === 'object' && !config.raw;
        const merged = { ...(isConfig ? config : {}), headers: { ...(isConfig ? config.headers : {}), Accept: 'application/xml' } };
        return isConfig ? _get(...args.slice(0, -1), merged) : _get(...args, merged);
      }
      return _get(...args);
    };

    // Node's OData V4 parser is permissive about key literals: `Entity(ID=<uuid>)`
    // is accepted regardless of whether the key's EDM type is `Edm.Guid` or
    // `Edm.String`. CAP Java's Olingo is strict and rejects unquoted values on
    // `Edm.String` keys with HTTP 400 "The key value 'ID' is invalid.".
    //
    // Wrap the request methods so that any `(key=value[,...])` segment where
    // `key` refers to an `Edm.String` element of the addressed entity gets its
    // value auto-quoted. Tests that already quote their keys are unaffected.
    //
    // Also translate the Node-only `?sap-locale=<x>` query parameter into an
    // `Accept-Language: <x>` header, which is what CAP Java honors, so
    // shared tests that rely on per-request locale overrides keep working.
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const original = cds_test[method].bind(cds_test);
      cds_test[method] = (...args) => {
        args = _quoteStringKeys(args);
        args = _translateSapLocale(args);
        return original(...args);
      };
      // Preserve the uppercase aliases (GET, POST, ...) that just bind to lowercase.
      const upper = method.toUpperCase();
      Object.defineProperty(cds_test, upper, {
        configurable: true,
        get() { return cds_test[method].bind(cds_test); }
      });
    }

    // CAP Java mock users have no password by default. Tests configured with a
    // Node-style `defaults.auth = { username: 'alice', password: 'admin' }` would
    // therefore receive HTTP 401. Force an empty password whenever a Java test
    // supplies `admin`/`support`/... as password, keeping the same username so the
    // user's role mapping still applies.
    //
    // Additionally, seed a default `alice` auth so test files that never set
    // `defaults.auth` themselves (e.g. annotation-interpretation.test.js) still
    // authenticate correctly instead of receiving 401.
    const _defaults = cds_test.defaults;
    const _authDescriptor = Object.getOwnPropertyDescriptor(_defaults, 'auth');
    let _auth = _authDescriptor?.value ?? _defaults.auth ?? { username: 'alice', password: '' };
    Object.defineProperty(_defaults, 'auth', {
      configurable: true,
      enumerable: true,
      get() { return _auth; },
      set(v) {
        if (v && typeof v === 'object' && v.username) {
          _auth = { ...v, password: '' };
        } else {
          _auth = v;
        }
      }
    });

    // Node tests routinely do `cds.connect.to('VariantTesting')` etc. to obtain a
    // service object whose `.entities` shorthand they use in `SELECT.from(...)`.
    // Only the Java runtime actually implements those services here; Node-side
    // `cds.env.requires` has no config for them, so `cds.connect.to` throws
    // "Didn't find a configuration for cds.requires.<Service>".
    //
    // Provide a lightweight shim: for any service present in the compiled CDS
    // model, return an object exposing the service definition's entities. The
    // actual DB traffic goes through `cds.db` (HCQL over HTTP) regardless of
    // which "service" the caller thought they were talking to.
    const _origConnectTo = cds.connect.to.bind(cds.connect);
    cds.connect.to = function (datasource, options) {
      const name = typeof datasource === 'string' ? datasource : datasource?.name;
      if (name && !cds.env.requires?.[name] && cds.model?.definitions?.[name]?.kind === 'service') {
        const model = cds.model;
        return Promise.resolve(_buildJavaServiceShim(name, model));
      }
      return _origConnectTo(datasource, options);
    };

    // Node's runtime auto-flattens managed associations into `<assoc>_<key>`
    // FK scalars on service entity element maps. Tests inspect these through
    // `cds.entities('MyService').X.elements.<assoc>_<key>` — which uses
    // `cds.model.definitions` directly, bypassing the `cds.connect.to` shim
    // above. Trigger the FK expansion for *every* service in the model
    // proactively so `cds.entities()` returns the flattened form.
    //
    // Deferred until first accessed so we don't interfere with the app-startup
    // compile that already ran when the model was loaded.
    before(async () => {
      if (!cds.model?.definitions) return;
      for (const [name, def] of Object.entries(cds.model.definitions)) {
        if (def?.kind !== 'service') continue;
        _buildJavaServiceShim(name, cds.model);
      }
    });

    return cds_test;
  };

  /**
   * Build a minimal ApplicationService-like object for a CDS service that lives
   * only on the Java side. Exposes `.entities` (service-scoped) and `.name`,
   * which is all the integration tests actually consume.
   *
   * Also expands each returned entity's `elements` map to include the
   * flattened `<assoc>_<key>` FK scalars for managed associations. Node's
   * runtime does this automatically via `cds.compile.for.nodejs`; the raw
   * `cds.model` used by the Java-test setup does not, and some tests rely
   * on inspecting these FKs (e.g. `entities.X.elements.assoc_ID`).
   */
  function _buildJavaServiceShim(name, model) {
    const cds = require('@sap/cds');
    const prefix = `${name}.`;
    const entities = {};
    for (const [defName, def] of Object.entries(model.definitions)) {
      if (!defName.startsWith(prefix)) continue;
      if (def.kind !== 'entity') continue;
      const shortName = defName.slice(prefix.length);
      _addFlattenedFKs(def, model);
      entities[shortName] = def;
    }
    return {
      name,
      entities,
      model,
      // Tests occasionally do `await srv.run(SELECT...)` — delegate to cds.db.
      run: (...args) => cds.db.run(...args),
      tx: (...args) => cds.db.tx(...args)
    };
  }

  function _addFlattenedFKs(def, model) {
    if (!def?.elements) return;
    for (const [name, el] of Object.entries(def.elements)) {
      if (el?.type !== 'cds.Association' && el?.type !== 'cds.Composition') continue;
      if (!Array.isArray(el.keys) || el.keys.length === 0) continue;
      const targetName = typeof el.target === 'string' ? el.target : el.target?.name;
      const target = targetName && model.definitions[targetName];
      if (!target?.elements) continue;
      for (const k of el.keys) {
        const fk = typeof k === 'string' ? k : k.ref?.[0] ?? k.as;
        if (!fk) continue;
        const flatName = `${name}_${fk}`;
        if (def.elements[flatName]) continue;
        const targetElem = target.elements[fk];
        if (!targetElem) continue;
        def.elements[flatName] = { type: targetElem.type };
        if (targetElem.length) def.elements[flatName].length = targetElem.length;
      }
    }
  }

  /**
   * Rewrites a URL of the form `/odata/v4/<svc>/<Entity>(key1=v1,key2=v2)/...`
   * so that each `keyN=vN` whose EDM type is `Edm.String` (i.e. the CDS
   * element is a `String`/`UUID` typed key) becomes `keyN='vN'`. Values that
   * are already quoted, boolean, or numeric are left untouched. This
   * compensates for CAP Java's strict Olingo parser rejecting unquoted string
   * key literals that Node's OData parser tolerates.
   */
  function _quoteStringKeys(args) {
    const cds = require('@sap/cds');
    const url = typeof args[0] === 'string' ? args[0] : null;
    if (!url) return args;
    if (!/[\(,][^)]*=/.test(url)) return args; // no key predicates

    // Match `/odata/v4/<svc>/<Entity>(<keys>)` and rewrite the keys segment.
    // We only touch the first key predicate — nested `(k=v)` on navigation
    // segments follow the same rules but tests here never use them.
    const rewritten = url.replace(/(\/odata\/v4\/([^/?#]+)\/([A-Za-z_][\w.]*))\(([^)]+)\)/, (match, prefix, servicePath, entityName, keysStr) => {
      const entity = _resolveEntityByServicePath(cds.model, servicePath, entityName);
      if (!entity?.elements) return match;

      const parts = keysStr.split(',').map((part) => {
        const eq = part.indexOf('=');
        if (eq < 0) return part;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (!key || !value) return part;
        // Already quoted / boolean / numeric / null — leave as-is.
        if (/^'.*'$/.test(value)) return part;
        if (/^(true|false|null)$/i.test(value)) return part;
        if (/^-?\d+(?:\.\d+)?$/.test(value)) return part;

        const element = entity.elements[key];
        if (!element) return part;
        // CDS `UUID` maps to `Edm.Guid` (unquoted). Only quote for `Edm.String`.
        const type = element.type;
        if (type === 'cds.String' || type === 'cds.LargeString') {
          const escaped = value.replace(/'/g, "''");
          return `${key}='${escaped}'`;
        }
        return part;
      });
      return `${prefix}(${parts.join(',')})`;
    });
    if (rewritten === url) return args;
    return [rewritten, ...args.slice(1)];
  }

  function _resolveEntityByServicePath(model, servicePath, shortName) {
    if (!model) return null;
    for (const [name, def] of Object.entries(model.definitions)) {
      if (def?.kind !== 'service') continue;
      const path = def['@path'] || _defaultServicePath(name);
      if (path === servicePath || path === `/${servicePath}`) {
        return model.definitions[`${name}.${shortName}`];
      }
    }
    return null;
  }

  function _defaultServicePath(serviceName) {
    // Mirrors the OData V4 default path derivation: drop trailing 'Service' and
    // kebab-case the remainder. This is only a fallback for services that omit
    // `@path`; explicit `@path` takes precedence.
    let base = serviceName.split('.').pop();
    if (base.endsWith('Service')) base = base.slice(0, -'Service'.length);
    return base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Node's CDS runtime honors `?sap-locale=<x>` as a query-parameter locale
   * override for a single request. CAP Java only reads the `Accept-Language`
   * header. Translate the query parameter into a header on-the-fly so shared
   * tests that use `?sap-locale=de` on `PATCH`/`POST` get the expected
   * per-request locale in Java as well. The parameter is stripped from the
   * URL to avoid Olingo rejecting the (to it) unknown query option.
   */
  function _translateSapLocale(args) {
    if (typeof args[0] !== 'string') return args;
    let url = args[0];
    const m = url.match(/[?&]sap-locale=([^&]+)/);
    if (!m) return args;
    const locale = decodeURIComponent(m[1]);
    // Remove `sap-locale=…` (and its leading separator) from the URL.
    url = url.replace(/([?&])sap-locale=[^&]*(&?)/, (match, sep, trailer) => {
      if (sep === '?' && trailer === '&') return '?';
      if (sep === '?' && !trailer) return '';
      if (sep === '&' && !trailer) return '';
      if (sep === '&' && trailer === '&') return '&';
      return '';
    });
    // Determine which arg slot carries the axios `config` object. For `get`
    // and `delete` it's `args[1]`; for `post`/`patch`/`put` it's `args[2]`.
    // We heuristically pick the last arg that looks like a plain config obj.
    const rest = args.slice(1);
    let configIdx = -1;
    for (let i = rest.length - 1; i >= 0; i--) {
      const v = rest[i];
      if (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && (v.headers || v.params || v.timeout || v.baseURL || v.auth)) {
        configIdx = i + 1;
        break;
      }
    }
    const patched = [url, ...rest];
    const patchHeaders = (cfg) => ({
      ...cfg,
      headers: { ...(cfg?.headers ?? {}), 'Accept-Language': locale }
    });
    if (configIdx > 0) {
      patched[configIdx] = patchHeaders(patched[configIdx]);
    } else {
      // No explicit config — append one. axios `.get`/`.delete`/`.head`/
      // `.options` take `(url, config?)`; `.post`/`.put`/`.patch` take
      // `(url, data?, config?)`. We can't reliably tell which shape we're
      // in from the args alone, so append at the end. Both shapes tolerate
      // a trailing config object.
      patched.push(patchHeaders());
    }
    return patched;
  }

  // Re-export cds.test's static helpers so existing usage keeps working
  Object.setPrototypeOf(cds.test, _cdsTest);
  for (const key of Object.keys(_cdsTest)) cds.test[key] = _cdsTest[key];
}
