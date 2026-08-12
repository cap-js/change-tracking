const childProcess = require('node:child_process');
const { promises: fs } = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const PROXY_PREFIX = 'dbProxy.';
const MVN_LOCK_TIMEOUT = 120; // s
const SKIP_AWAIT_SHUTDOWN = !!process.env.CDS_ENV_TEST_SKIP_AWAIT_SHUTDOWN;

const proxyNameOf = (entityName) => PROXY_PREFIX + entityName.replace(/\./g, '_');
const databaseNameOf = (entityName) => entityName.replace(/\./g, '_').toUpperCase();

const buildDatabaseProxy = async (cds, from) => {
  const servicesPath = path.resolve(cds.root, cds.env.folders.srv);
  const proxyJsonPath = path.join(servicesPath, 'db-proxy.json');
  const proxyCdsPath = path.join(servicesPath, 'db-proxy.cds');

  const existingContent = await fs.readFile(proxyJsonPath, 'utf8').catch(() => null);

  const linked = cds.linked(await cds.load(from));

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

  for (const [name, def] of Object.entries(linked.definitions)) {
    if (isDatabaseEntity(name)) {
      const entityName = proxyNameOf(name);
      const entityElements = buildProxyElements(def.elements);
      const entity = proxyEntityDef(name, entityElements);

      hcqlDatabaseProxy.definitions[entityName] = entity;
    }

    if (isDbView(name)) {
      const entityName = proxyNameOf(name);
      const entityElements = buildProxyElements(def.elements, false, true);
      const entity = proxyEntityDef(name, entityElements);

      hcqlDatabaseProxy.definitions[entityName] = entity;
    }

    if (def.kind === 'entity' && def['@odata.draft.enabled']) {
      const draftEntityName = proxyNameOf(`${name}.drafts`);
      const draftEntityElements = buildProxyElements(def.elements, true);
      const draftEntity = proxyEntityDef(`${name}.drafts`, draftEntityElements);

      hcqlDatabaseProxy.definitions[draftEntityName] = draftEntity;

      for (const targetName of collectComposedDescendants(name)) {
        const childDraftEntityName = proxyNameOf(`${targetName}.drafts`);
        if (hcqlDatabaseProxy.definitions[childDraftEntityName]) continue;

        const targetDef = linked.definitions[targetName];
        if (!targetDef || targetDef.kind !== 'entity') continue;

        const childDraftEntityElements = buildProxyElements(targetDef.elements, true);
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
        const mvnBuild = childProcess.spawn('mvn', ['package', '-DskipTests'], {
          cwd: cds.root,
          stdio: 'inherit',
          env: process.env
        });
        mvnBuild.on('error', reject);
        mvnBuild.on('exit', (code, signal) => {
          if (code === 0) return resolve();
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
  cds.model = cds.linked(cds.model);

  const proxyMap = {};
  for (const [name] of Object.entries(cds.model.definitions)) {
    if (name.startsWith(PROXY_PREFIX)) continue;
    const key = proxyNameOf(name);
    if (cds.model.definitions[key]) proxyMap[name] = key;
    const draftKey = proxyNameOf(`${name}.drafts`);
    if (cds.model.definitions[draftKey]) proxyMap[`${name}.drafts`] = draftKey;
  }

  const draftAdminName = 'DRAFT.DraftAdministrativeData';
  const draftAdminProxyKey = proxyNameOf(draftAdminName);
  if (cds.model.definitions[draftAdminProxyKey]) proxyMap[draftAdminName] = draftAdminProxyKey;

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
    const spawnOptions = { cwd: cds.root, stdio: 'inherit', env: process.env };
    const javaAppProcess = childProcess.spawn('java', ['-jar', jarFile, `--server.port=${p}`], spawnOptions);

    let settled = false;
    const settle = (fn, arg) => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        fn(arg);
      }
    };

    const startupTimer = setTimeout(() => {
      javaAppProcess.kill();
      settle(reject, new cds.error('Java application did not respond within 90s — killed. Check the output above for details.'));
    }, 90_000);

    javaAppProcess.on('error', (err) => settle(reject, err));
    javaAppProcess.on('exit', (code, signal) => {
      const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`;
      settle(reject, new cds.error(`Application failed to start — process ${reason}. Check the application output above for details.`));
    });

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ping = () => {
      if (settled) return;
      return axios
        .get(url)
        .then(() => settle(resolve, javaAppProcess))
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

module.exports = java;
module.exports.default = java;
module.exports.generateProxy = generateProxy;
