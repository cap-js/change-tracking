const childProcess = require('node:child_process');
const { promises: fs } = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const PROXY_PREFIX = 'dbProxy.';
const MVN_LOCK_TIMEOUT = 120; // s
const SKIP_AWAIT_SHUTDOWN = !!process.env.CDS_ENV_TEST_SKIP_AWAIT_SHUTDOWN;
const VERBOSE = !!process.env.CDS_ENV_TEST_VERBOSE;
const LOG_TAIL_BYTES = 64 * 1024;

/**
 * Attach bounded stdout/stderr capture to a spawned child process. Returns an
 * object with `.tail()` (returns the last ~64KB of interleaved output as a
 * string) and `.stop()` (detaches the listeners and releases the buffer).
 * Safe to call `.tail()` after `.stop()` — it just returns whatever was
 * captured up to that point.
 */
function _captureOutput(child) {
  let buf = Buffer.alloc(0);
  const append = (chunk) => {
    if (!chunk || !chunk.length) return;
    if (chunk.length >= LOG_TAIL_BYTES) {
      buf = chunk.slice(chunk.length - LOG_TAIL_BYTES);
      return;
    }
    const combined = Buffer.concat([buf, chunk], buf.length + chunk.length);
    buf = combined.length > LOG_TAIL_BYTES ? combined.slice(combined.length - LOG_TAIL_BYTES) : combined;
  };
  const onOut = (c) => append(c);
  const onErr = (c) => append(c);
  child.stdout?.on('data', onOut);
  child.stderr?.on('data', onErr);
  return {
    tail() {
      return buf.toString('utf8');
    },
    stop() {
      child.stdout?.removeListener('data', onOut);
      child.stderr?.removeListener('data', onErr);
      // Drain any remaining data without buffering it, so the child doesn't
      // block on a full pipe. `resume()` puts the streams into flowing mode
      // with no listeners, effectively discarding data.
      child.stdout?.resume();
      child.stderr?.resume();
      buf = Buffer.alloc(0);
    }
  };
}

const proxyNameOf = (entityName) => PROXY_PREFIX + entityName.replace(/\./g, '_');
const databaseNameOf = (entityName) => entityName.replace(/\./g, '_').toUpperCase();

const buildDatabaseProxy = async (cds, from) => {
  const servicesPath = path.resolve(cds.root, cds.env.folders.srv);
  const proxyJsonPath = path.join(servicesPath, 'db-proxy.json');
  const proxyCdsPath = path.join(servicesPath, 'db-proxy.cds');

  const existingContent = await fs.readFile(proxyJsonPath, 'utf8').catch(() => null);

  const linked = cds.linked(await cds.load(from));

  try {
    const { enhanceModel } = require('../csn-enhancements');
    enhanceModel(linked);
  } catch {
    /* best-effort */
  }

  let flattenedModel = null;
  try {
    flattenedModel = cds.compile.for.nodejs(structuredClone(linked));
  } catch {
    /* best-effort */
  }

  const hcqlDatabaseProxy = {
    $version: '2.0',
    definitions: {
      dbProxy: { kind: 'service', '@path': 'dbProxy', '@protocol': ['hcql'], '@requires': 'any' }
    }
  };

  const isDatabaseEntity = (entityName) => {
    const def = linked.definitions[entityName];
    if (!def || def.kind !== 'entity') return false;
    if (def.projection || def.query) return false;
    if (def['@cds.persistence.exists']) return false;
    if (def['@cds.persistence.skip'] === true) return false;
    return true;
  };

  const isDbView = (entityName) => {
    const def = linked.definitions[entityName];
    if (!def || def.kind !== 'entity') return false;
    if (!def.projection && !def.query) return false;
    if (def['@cds.persistence.skip'] === true) return false;
    if (def['@cds.persistence.exists']) return false;

    // skip service projections
    const parts = entityName.split('.');
    for (let i = 1; i < parts.length; i++)
      if (linked.definitions[parts.slice(0, i).join('.')]?.kind === 'service') return false;

    return true;
  };

  const determineProjectionTarget = (entityName) => {
    if (isDatabaseEntity(entityName)) return entityName;
    if (isDbView(entityName)) return entityName;
    const def = linked.definitions[entityName];
    const fromRef = def?.query?.SELECT?.from?.ref ?? def?.projection?.from?.ref;
    if (fromRef?.length) return determineProjectionTarget(fromRef[0]);
    return null;
  };

  const determineProxyTarget = (entityName, forDraft = false) => {
    if (forDraft && draftEntityNames.has(entityName)) return proxyNameOf(`${entityName}.drafts`);
    const targetName = determineProjectionTarget(entityName);
    return targetName ? proxyNameOf(targetName) : entityName;
  };

  const collectComposedDescendants = (entityName, descendants = new Set(), visited = new Set()) => {
    if (visited.has(entityName)) return descendants;

    visited.add(entityName);

    for (const [, el] of Object.entries(linked.definitions[entityName]?.elements ?? {})) {
      if (el.type !== 'cds.Composition' || !el.target) continue;
      if (el.target.endsWith('.texts')) continue; // no Java drafts for .texts
      descendants.add(el.target);
      collectComposedDescendants(el.target, descendants, visited);
    }

    return descendants;
  };

  // pre-collect for draft composition wiring
  const draftEntityNames = new Set();
  for (const [name, def] of Object.entries(linked.definitions)) {
    if (def.kind === 'entity' && def['@odata.draft.enabled']) {
      draftEntityNames.add(name);
      for (const targetName of collectComposedDescendants(name)) {
        if (linked.definitions[targetName]?.kind === 'entity') draftEntityNames.add(targetName);
      }
    }
  }

  const resolvedTypeOf = (el) => {
    let p = el;
    while (p && p !== Object.prototype) {
      if (typeof p.type === 'string') return p.type;
      p = Object.getPrototypeOf(p);
    }
    return el.type;
  };

  const buildProxyElements = (elements = {}, forDraft = false, forView = false) => {
    const proxyElements = {};

    for (const [name, el] of Object.entries(elements)) {
      if (forDraft && el.virtual) continue;

      if (el.type === 'cds.Composition') {
        if (forDraft && !draftEntityNames.has(el.target)) continue;
        if (!forDraft && !isDatabaseEntity(el.target)) continue;

        // Skip backlink compositions on views: `on` clauses reference associations whose
        // target is the underlying table (not the view), which the CDS compiler rejects as
        // "target of the backlink association is unrelated to the current entity".
        // The Java runtime resolves this correctly through the projection; the proxy view
        // doesn't need to expose it.
        if (forView && el.on) continue;

        const targetName = `${el.target}${forDraft ? '.drafts' : ''}`;

        const compositionElement = {
          type: 'cds.Composition',
          target: proxyNameOf(targetName)
        };
        if (el.cardinality) compositionElement.cardinality = el.cardinality;
        if (el.on) compositionElement.on = el.on;
        if (el.keys) compositionElement.keys = el.keys;

        // Same collision-avoidance as for Associations: if the flattened elements
        // already include the FK scalar for a Composition-of-one (`<comp>_<key>`),
        // switch the composition from managed (`keys`) to unmanaged (`on`) so the
        // CDS compiler doesn't try to auto-generate the FK a second time.
        if (el.keys?.length) {
          const clashes = el.keys.some((k) => {
            const kRef = k.ref?.[0];
            return kRef && Object.prototype.hasOwnProperty.call(elements, `${name}_${kRef}`);
          });
          if (clashes) {
            delete compositionElement.keys;
            const onClause = [];
            el.keys.forEach((k, i) => {
              if (i > 0) onClause.push('and');
              const kRef = k.ref?.[0];
              onClause.push({ ref: [name, kRef] }, '=', { ref: [`${name}_${kRef}`] });
            });
            compositionElement.on = onClause;
          }
        }

        proxyElements[name] = compositionElement;
        continue;
      }

      if (el.type === 'cds.Association') {
        if (!el.keys && !el.on) continue;

        // Same reasoning as for compositions above: backlink associations on views
        // reference `$self` which is unrelated to the view's proxy identity.
        if (forView && el.on && !el.keys) continue;

        const associationElement = { type: 'cds.Association' };
        if (el.target) associationElement.target = determineProxyTarget(el.target, forDraft);
        if (el.keys) associationElement.keys = el.keys;
        if (el.on) associationElement.on = el.on;
        if (el.cardinality) associationElement.cardinality = el.cardinality;

        // If the (already-flattened) elements map already carries the FK scalar
        // (`<assoc>_<key>`, ...), rewrite the association from managed (via
        // `keys`) to unmanaged (via `on`) so the CDS compiler doesn't try to
        // auto-generate the FK a second time and complain about a duplicate
        // element.
        if (el.keys?.length) {
          const clashes = el.keys.some((k) => {
            const kRef = k.ref?.[0];
            return kRef && Object.prototype.hasOwnProperty.call(elements, `${name}_${kRef}`);
          });
          if (clashes) {
            delete associationElement.keys;
            const onClause = [];
            el.keys.forEach((k, i) => {
              if (i > 0) onClause.push('and');
              const kRef = k.ref?.[0];
              onClause.push({ ref: [name, kRef] }, '=', { ref: [`${name}_${kRef}`] });
            });
            associationElement.on = onClause;
          }
        }

        proxyElements[name] = associationElement;
        continue;
      }
      const scalarElement = {};
      if (el.key) scalarElement.key = true;
      if (el.type) scalarElement.type = resolvedTypeOf(el);
      if (el.items) scalarElement.items = el.items;
      if (el.length && resolvedTypeOf(el) !== 'cds.UUID') scalarElement.length = el.length;

      proxyElements[name] = scalarElement;
    }

    if (forDraft)
      Object.assign(proxyElements, {
        IsActiveEntity: { type: 'cds.Boolean' },
        HasActiveEntity: { type: 'cds.Boolean' },
        HasDraftEntity: { type: 'cds.Boolean' },
        DraftAdministrativeData: {
          type: 'cds.Composition',
          cardinality: { max: 1 },
          target: proxyNameOf('DRAFT.DraftAdministrativeData')
        }
      });

    return proxyElements;
  };

  const proxyEntityDef = (entityName, elements) => ({
    '@cds.test.java.db.proxy': true,
    '@cds.external': true,
    kind: 'entity',
    '@requires': 'any',
    '@cds.persistence.exists': true,
    '@cds.persistence.name': databaseNameOf(entityName),
    elements
  });

  // Use the flattened element map for a given definition when available. Node's
  // `cds.compile.for.nodejs` expands managed associations into `<assoc>_<key>`
  // FK scalars and expands struct types into `<field>_<sub>` scalars — both are
  // needed by tests that use flat column names (e.g. `countryName_name`), while
  // the raw model only exposes the nested/associated form.
  const flatElementsOf = (name, def) => flattenedModel?.definitions?.[name]?.elements ?? def.elements;

  for (const [name, def] of Object.entries(linked.definitions)) {
    if (isDatabaseEntity(name)) {
      const entityName = proxyNameOf(name);
      const entityElements = buildProxyElements(flatElementsOf(name, def));
      const entity = proxyEntityDef(name, entityElements);

      hcqlDatabaseProxy.definitions[entityName] = entity;
    }

    if (isDbView(name)) {
      const entityName = proxyNameOf(name);
      const entityElements = buildProxyElements(flatElementsOf(name, def), false, true);
      const entity = proxyEntityDef(name, entityElements);

      hcqlDatabaseProxy.definitions[entityName] = entity;
    }

    if (def.kind === 'entity' && def['@odata.draft.enabled']) {
      const draftEntityName = proxyNameOf(`${name}.drafts`);
      const draftEntityElements = buildProxyElements(flatElementsOf(name, def), true);
      const draftEntity = proxyEntityDef(`${name}.drafts`, draftEntityElements);

      hcqlDatabaseProxy.definitions[draftEntityName] = draftEntity;

      for (const targetName of collectComposedDescendants(name)) {
        const childDraftEntityName = proxyNameOf(`${targetName}.drafts`);
        if (hcqlDatabaseProxy.definitions[childDraftEntityName]) continue;

        const targetDef = linked.definitions[targetName];
        if (!targetDef || targetDef.kind !== 'entity') continue;

        const childDraftEntityElements = buildProxyElements(flatElementsOf(targetName, targetDef), true);
        const childDraftEntity = proxyEntityDef(`${targetName}.drafts`, childDraftEntityElements);

        hcqlDatabaseProxy.definitions[childDraftEntityName] = childDraftEntity;
      }
    }
  }

  // Java-only entity; not in app model
  if (draftEntityNames.size > 0) {
    hcqlDatabaseProxy.definitions[proxyNameOf('DRAFT.DraftAdministrativeData')] = proxyEntityDef('DRAFT.DraftAdministrativeData', {
      DraftUUID: { key: true, type: 'cds.UUID' },
      CreationDateTime: { type: 'cds.Timestamp' },
      CreatedByUser: { type: 'cds.String', length: 256 },
      CreatedByUserDescription: { type: 'cds.String', length: 256 },
      DraftIsCreatedByMe: { type: 'cds.Boolean' },
      LastChangeDateTime: { type: 'cds.Timestamp' },
      LastChangedByUser: { type: 'cds.String', length: 256 },
      LastChangedByUserDescription: { type: 'cds.String', length: 256 },
      InProcessByUser: { type: 'cds.String', length: 256 },
      InProcessByUserDescription: { type: 'cds.String', length: 256 },
      DraftIsProcessedByMe: { type: 'cds.Boolean' },
      DraftMessages: { type: 'cds.LargeString' }
    });
  }

  // Expose a `changes` navigation on every DB-entity proxy whose corresponding
  // service projection is change-tracked. Node's runtime resolves navigations
  // like `SELECT.from({ ref: [{ id: 'sap.change_tracking.Foo', ... }, 'changes'] })`
  // through the enhanced service-level model automatically; CAP Java requires
  // the association to be declared on the *proxy* entity that HCQL queries hit.
  //
  // The association is unmanaged (`on entityKey = ID and entity = '<DB name>'`)
  // and targets the ChangeView proxy — matching the shape of the aspect that
  // change-tracking adds to service entities on the Node side.
  const changeViewProxyKeyForDb = proxyNameOf('sap.changelog.ChangeView');
  if (hcqlDatabaseProxy.definitions[changeViewProxyKeyForDb]) {
    // Collect all DB entity names that back a change-tracked service entity.
    const changeTrackedDbNames = new Set();
    for (const [name, def] of Object.entries(linked.definitions)) {
      if (def?.kind !== 'entity') continue;
      if (!(def.query || def.projection)) continue;
      if (!def.elements?.changes) continue;
      const target = determineProjectionTarget(name);
      if (target) changeTrackedDbNames.add(target);
    }

    for (const dbName of changeTrackedDbNames) {
      const proxyName = proxyNameOf(dbName);
      const proxyEntity = hcqlDatabaseProxy.definitions[proxyName];
      if (!proxyEntity?.elements) continue;
      if (proxyEntity.elements.changes) continue;
      const keys = Object.entries(proxyEntity.elements).filter(([, e]) => e.key);
      if (keys.length === 0) continue;
      let keyExpr;
      if (keys.length === 1) {
        // Single-key entity: entityKey column is the raw key value.
        const [keyName] = keys[0];
        keyExpr = [{ ref: [keyName] }];
      } else {
        // Composite key: the trigger stores entityKey as
        //   `<len(k1)>,<k1>;<len(k2)>,<k2>;…`
        // Reproduce that concatenation as a CDS xpr so the association ON
        // clause resolves navigations correctly. Each key is cast to string
        // via CQN's inline `cast:` marker, then concatenated with the length
        // prefix. Emits SQL like:
        //   length(cast("k1" as varchar)) || ',' || cast("k1" as varchar) || ';' || …
        keyExpr = [];
        keys.forEach(([keyName], i) => {
          if (i > 0) keyExpr.push('||', { val: ';' }, '||');
          const castToStr = { ref: [keyName], cast: { type: 'cds.String' } };
          keyExpr.push({ func: 'length', args: [castToStr] }, '||', { val: ',' }, '||', castToStr);
        });
      }
      proxyEntity.elements.changes = {
        type: 'cds.Association',
        cardinality: { max: '*' },
        target: changeViewProxyKeyForDb,
        on: [
          { ref: ['changes', 'entityKey'] },
          '=',
          keyExpr.length === 1 ? keyExpr[0] : { xpr: keyExpr },
          'and',
          { ref: ['changes', 'entity'] },
          '=',
          { val: dbName }
        ]
      };
    }
  }

  const newContent = JSON.stringify(hcqlDatabaseProxy);

  // skip write if unchanged
  if (newContent !== existingContent) {
    await Promise.all([fs.writeFile(proxyCdsPath, `using from './db-proxy.json';`), fs.writeFile(proxyJsonPath, newContent)]);
  }

  return { changed: newContent !== existingContent };
};

const isPidAlive = (pid) => {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    // signal 0 = existence probe; throws ESRCH if the process is gone,
    // EPERM if it exists but we can't signal it (still counts as alive).
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const acquireBuildLock = async (lockFile, cds) => {
  const deadline = Date.now() + MVN_LOCK_TIMEOUT * 1_000;
  const ownerPid = String(process.pid);

  while (true) {
    // Atomic create-if-not-exists. Winning worker writes its pid so others can
    // detect an abandoned lock (previous run killed / crashed before releasing).
    const lock = await fs.open(lockFile, 'wx').catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
    if (lock) {
      await lock.writeFile(ownerPid).catch(() => {});
      await lock.close();
      return;
    }

    // Lock exists. Check whether the owner is still alive; if not, steal it.
    const rawPid = await fs.readFile(lockFile, 'utf8').catch(() => '');
    const pid = parseInt(rawPid.trim(), 10);
    if (rawPid && !isPidAlive(pid)) {
      cds.log?.('cds')?.warn?.(`Removing stale Maven build lock left behind by PID ${pid}`);
      await fs.unlink(lockFile).catch(() => {});
      continue; // retry immediately
    }

    if (Date.now() > deadline) cds.error(`Timed out waiting for Maven build lock after ${MVN_LOCK_TIMEOUT}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

async function java(...args) {
  const { cds, axios } = this;

  // Java requires OData-Version: 4.0
  this.defaults.headers['Odata-Version'] = '4.0';

  const fromIdx = args.indexOf('--from');
  const from = fromIdx !== -1 ? String(args[fromIdx + 1]).split(',') : ['*'];

  const srvDir = path.resolve(cds.root, cds.env.folders.srv);
  const proxyFile = path.join(srvDir, 'db-proxy.cds');

  const pomFile = path.resolve(cds.root, cds.env.folders.srv, 'pom.xml');
  const appName = await fs
    .readFile(pomFile, 'utf8')
    .then((xml) => xml.replace(/<parent>[\s\S]*?<\/parent>/, '').match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? 'app')
    .catch(() => 'app');

  const jarFile = path.resolve(cds.root, cds.env.folders.srv, `target/${appName}-exec.jar`);

  // serialize concurrent workers
  const lockFile = path.join(srvDir, '.mvn-build.lock');
  await acquireBuildLock(lockFile, cds);

  // Best-effort cleanup on process-level termination so the lock doesn't
  // outlive its owner (vitest may SIGKILL/SIGTERM a worker on timeout).
  const unlinkLockSync = () => {
    try {
      require('node:fs').unlinkSync(lockFile);
    } catch {}
  };
  const signalHandler = (sig) => {
    unlinkLockSync();
    process.removeListener(sig, signalHandler);
    process.kill(process.pid, sig);
  };
  process.once('exit', unlinkLockSync);
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  try {
    const jarExists = await fs
      .access(jarFile)
      .then(() => true)
      .catch(() => false);
    const { changed } = await buildDatabaseProxy(cds, from);

    if (changed || !jarExists) {
      await new Promise((resolve, reject) => {
        const stdio = VERBOSE ? 'inherit' : ['ignore', 'pipe', 'pipe'];
        const mvnBuild = childProcess.spawn('mvn', ['package', '-DskipTests'], {
          cwd: cds.root,
          stdio,
          env: process.env
        });
        const capture = VERBOSE ? null : _captureOutput(mvnBuild);
        mvnBuild.on('error', (err) => {
          if (capture) process.stderr.write(capture.tail());
          reject(err);
        });
        mvnBuild.on('exit', (code, signal) => {
          if (code === 0) {
            capture?.stop();
            return resolve();
          }
          if (capture) process.stderr.write(capture.tail());
          const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`;
          reject(new cds.error(`Maven build failed — ${reason}. Check the output above for details.`));
        });
      });
    }
  } finally {
    fs.unlink(lockFile).catch(() => {});
  }

  // reserve port after build (TOCTOU)
  const p = await port();
  const url = `http://localhost:${p}`;

  cds.model = await cds.load([...from, proxyFile]);
  // Apply this plugin's model enhancement to the Node-side model *after* loading,
  // *without* going through the global `cds.on('loaded', enhanceModel)` listener
  // (which would also fire during buildDatabaseProxy's own `cds.load` and pollute
  // the generated db-proxy.json with plugin-added `<Service>.ChangeView` entities).
  //
  // The enhancement adds `<Service>.ChangeView` service projections and a `changes`
  // association on every change-tracked service entity — these are what tests
  // consume via `cds.connect.to('<Service>').entities.ChangeView`.
  try {
    const { enhanceModel } = require('../csn-enhancements');
    enhanceModel(cds.model);
  } catch (e) {
    /* enhancement is best-effort on the Node side; Java owns the runtime model */
  }
  cds.model = cds.linked(cds.model);

  const proxyMap = {};
  for (const [name] of Object.entries(cds.model.definitions)) {
    if (name.startsWith(PROXY_PREFIX)) continue;
    const key = proxyNameOf(name);
    if (cds.model.definitions[key]) proxyMap[name] = key;
    const draftKey = proxyNameOf(`${name}.drafts`);
    if (cds.model.definitions[draftKey]) proxyMap[`${name}.drafts`] = draftKey;
  }

  // Service projections that don't have their own proxy entry (i.e. entities
  // exposed only by the CDS service layer, no dedicated table) must be routed
  // to the *underlying* DB entity's proxy. Walk each service projection down
  // through `query.SELECT.from.ref` / `projection.from.ref` until we find one
  // whose proxy name exists in the model, then map the service name to it.
  const _resolveDbProxy = (name, seen = new Set()) => {
    if (seen.has(name)) return null;
    seen.add(name);
    const proxy = proxyNameOf(name);
    if (cds.model.definitions[proxy]) return proxy;
    const def = cds.model.definitions[name];
    const fromRef = def?.query?.SELECT?.from?.ref ?? def?.projection?.from?.ref;
    if (fromRef?.length) return _resolveDbProxy(fromRef[0], seen);
    return null;
  };
  for (const [name, def] of Object.entries(cds.model.definitions)) {
    if (name.startsWith(PROXY_PREFIX)) continue;
    if (proxyMap[name]) continue;
    if (def?.kind !== 'entity') continue;
    if (!def.query && !def.projection) continue;
    const proxy = _resolveDbProxy(name);
    if (proxy) proxyMap[name] = proxy;
  }

  // Plugin-added `<Service>.ChangeView` projections (produced by the
  // change-tracking model enhancement) are pure Node-side conveniences — the
  // Java runtime only knows the underlying DB entity `sap.changelog.ChangeView`.
  // Route SELECTs against `<Service>.ChangeView` to the DB proxy of the base
  // entity so `SELECT.from(admin.entities.ChangeView)` works in tests.
  const changeViewProxyKey = proxyNameOf('sap.changelog.ChangeView');
  if (cds.model.definitions[changeViewProxyKey]) {
    for (const [name, def] of Object.entries(cds.model.definitions)) {
      if (!name.endsWith('.ChangeView') || name === 'sap.changelog.ChangeView') continue;
      if (def?.kind !== 'entity') continue;
      if (proxyMap[name]) continue;
      proxyMap[name] = changeViewProxyKey;
    }
  }

  const draftAdminName = 'DRAFT.DraftAdministrativeData';
  const draftAdminProxyKey = proxyNameOf(draftAdminName);
  if (cds.model.definitions[draftAdminProxyKey]) {
    proxyMap[draftAdminName] = draftAdminProxyKey;
    // Aliases for tests that reference the underscore variant
    // `DRAFT_DraftAdministrativeData`. Node's CQN builder resolves the bare
    // name against the current namespace context, producing several possible
    // fully-qualified names — map each of them to the same proxy so the HCQL
    // adapter can rewrite them uniformly. CAP Java only knows the dotted CDS
    // name, which is what the proxy carries.
    proxyMap['DRAFT_DraftAdministrativeData'] = draftAdminProxyKey;
    for (const namespace of new Set(Array.from(Object.keys(cds.model.definitions), (n) => n.split('.').slice(0, -1).join('.')).filter(Boolean))) {
      proxyMap[`${namespace}.DRAFT_DraftAdministrativeData`] = draftAdminProxyKey;
    }
  }

  // propagate .drafts to db entities
  for (const [draftName, proxyKey] of Object.entries(proxyMap)) {
    if (!draftName.endsWith('.drafts')) continue;
    const activeName = draftName.slice(0, -'.drafts'.length);
    const activeDef = cds.model.definitions[activeName];
    const fromRef = activeDef?.query?.SELECT?.from?.ref ?? activeDef?.projection?.from?.ref;
    if (!fromRef?.length) continue;
    const dbEntity = cds.model.definitions[fromRef[0]];
    const proxyDraftEntity = cds.model.definitions[proxyKey];

    // keep .drafts non-enumerable
    if (dbEntity && proxyDraftEntity && !dbEntity.drafts) Object.defineProperty(dbEntity, 'drafts', { value: proxyDraftEntity, configurable: true });
  }

  cds.entities; // trigger lazy init of entity cache

  const app = await new Promise((resolve, reject) => {
    const stdio = VERBOSE ? 'inherit' : ['ignore', 'pipe', 'pipe'];
    const spawnOptions = { cwd: cds.root, stdio, env: process.env };
    // H2's SourceCompiler (used for inline Java triggers) uses ToolProvider.getSystemJavaCompiler(),
    // which only sees the system classpath - NOT Spring Boot's nested JARs. To make org.h2.tools.*
    // available to the compiler, we launch the app with h2.jar on the primary classpath (via -cp),
    // bypassing the -jar mechanism and invoking Spring Boot's JarLauncher directly.
    const javaCmd = _buildJavaLaunchCommand(jarFile, p, cds);
    const javaAppProcess = childProcess.spawn(javaCmd.cmd, javaCmd.args, spawnOptions);
    const capture = VERBOSE ? null : _captureOutput(javaAppProcess);

    let settled = false;
    const settle = (fn, arg) => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        fn(arg);
      }
    };

    const dumpTail = () => {
      if (capture) process.stderr.write(capture.tail());
    };

    const startupTimer = setTimeout(() => {
      dumpTail();
      javaAppProcess.kill();
      settle(reject, new cds.error('Java application did not respond within 90s — killed. Check the output above for details.'));
    }, 90_000);

    javaAppProcess.on('error', (err) => {
      dumpTail();
      settle(reject, err);
    });
    javaAppProcess.on('exit', (code, signal) => {
      dumpTail();
      const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`;
      settle(reject, new cds.error(`Application failed to start — process ${reason}. Check the application output above for details.`));
    });

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ping = () => {
      if (settled) return;
      return axios
        .get(url)
        .then(() => {
          // App is up — drop the startup log tail and stop retaining further
          // output so long-running suites don't accumulate memory. The pipes
          // are switched to flowing mode (data discarded) so the JVM never
          // blocks on stdout/stderr writes.
          capture?.stop();
          settle(resolve, javaAppProcess);
        })
        .catch(() => sleep(500).then(ping));
    };

    ping();
  });

  cds.shutdown = () => {
    // detach proxy; next suite reconnects
    delete cds.services.db;
    delete cds.db;
    app.removeAllListeners('exit');
    if (SKIP_AWAIT_SHUTDOWN) {
      app.unref();
      app.kill();
      return;
    }
    const alreadyExited = app.exitCode !== null || app.signalCode !== null;
    const exited = alreadyExited ? Promise.resolve() : new Promise((r) => app.once('exit', r));
    app.kill();
    return exited;
  };

  const hcqlImpl = require.resolve('./java-hcql.js');
  cds.env.requires.db = { impl: hcqlImpl, axios, proxyMap };

  await cds.connect.to('db');

  // inject after connect, skip OData
  if (cds.model.definitions[draftAdminProxyKey])
    cds.db.model.definitions[draftAdminName] = {
      name: draftAdminName,
      kind: 'entity',
      elements: {},
      is: (x) => x === 'entity' || x === 'any'
    };

  return { server: { address: () => p, pid: app.pid }, url };
}

async function generateProxy(appDir) {
  const cds = require('@sap/cds');
  cds.root = path.resolve(appDir);
  await buildDatabaseProxy(cds, ['*']);
}

function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(() => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Build the Java launch command. Normally we run `java -jar app.jar`, but that hides Spring Boot's
 * nested libraries from the system Java compiler. When the change-tracking plugin generates inline
 * Java H2 triggers (via `AS $$...$$`), H2 invokes javac at trigger-creation time and needs
 * `org.h2.tools.TriggerAdapter` visible on the system classpath. To achieve that, we locate h2.jar
 * (unpacked by Spring Boot's `requiresUnpack` into the exec-jar) or from Maven's local repo, and
 * prepend it to the classpath, launching the Spring Boot loader directly instead of via `-jar`.
 */
function _buildJavaLaunchCommand(jarFile, p, cds) {
  const args = [];
  const h2Jar = _findH2Jar(cds);
  if (h2Jar) {
    // -cp so h2's classes are visible to javac (system compiler)
    args.push('-cp', `${jarFile}${require('node:path').delimiter}${h2Jar}`);
    args.push('org.springframework.boot.loader.launch.JarLauncher');
  } else {
    args.push('-jar', jarFile);
  }
  args.push(`--server.port=${p}`);
  return { cmd: 'java', args };
}

function _findH2Jar(cds) {
  const fsSync = require('node:fs');
  const path = require('node:path');
  // Prefer the specific h2 version currently in use (from Maven local repo).
  const m2 = path.join(process.env.HOME || '', '.m2', 'repository', 'com', 'h2database', 'h2');
  if (!fsSync.existsSync(m2)) return null;
  const versions = fsSync.readdirSync(m2).sort().reverse();
  for (const v of versions) {
    const jar = path.join(m2, v, `h2-${v}.jar`);
    if (fsSync.existsSync(jar)) return jar;
  }
  return null;
}


module.exports = java;
module.exports.default = java;
module.exports.generateProxy = generateProxy;
