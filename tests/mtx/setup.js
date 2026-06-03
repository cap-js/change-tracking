const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.resolve(__dirname, '../bookshop-mtx');
const SIDECAR_DIR = path.join(APP_DIR, 'mtx', 'sidecar');
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

/**
 * Pack @cap-js/change-tracking and install in sidecar to avoid dual @sap/cds load.
 * Restores the original package.json afterward so the file: reference stays intact.
 */
function ensureSidecarPlugin() {
  const pkgPath = path.join(SIDECAR_DIR, 'package.json');
  const originalPkg = fs.readFileSync(pkgPath, 'utf-8');
  const tmpDir = os.tmpdir();
  const tgz = execSync(`npm pack --pack-destination ${tmpDir}`, {
    cwd: PLUGIN_ROOT,
    encoding: 'utf-8'
  }).trim();
  execSync(`npm install ${path.join(tmpDir, tgz)}`, {
    cwd: SIDECAR_DIR,
    encoding: 'utf-8',
    stdio: 'ignore'
  });
  fs.writeFileSync(pkgPath, originalPkg);
}

/**
 * db*.sqlite, db*.sqlite-shm and db*.sqlite-wal files from the app directory.
 */
function cleanDbFiles() {
  let files;
  try {
    files = fs.readdirSync(APP_DIR);
  } catch {
    return;
  }
  for (const f of files.filter((f) => /^db.*\.sqlite(-shm|-wal)?$/.test(f))) {
    try {
      fs.unlinkSync(path.join(APP_DIR, f));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Start the MTX sidecar via the locally-installed `@sap/cds` server (`bin/serve.js`)
 * on a random port. Resolves with { proc, port } when the server is listening.
 */
function startSidecar() {
  return new Promise((resolve, reject) => {
    const serveJs = path.join(SIDECAR_DIR, 'node_modules', '@sap', 'cds', 'bin', 'serve.js');
    const proc = spawn(process.execPath, [serveJs, '--port', '0'], {
      cwd: SIDECAR_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: 'false', NODE_ENV: 'development' }
    });

    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Sidecar failed to start within 30s.\nOutput: ${output}`));
    }, 30000);

    proc.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/server listening on \{[^}]*url:\s*'http:\/\/localhost:(\d+)'/);
      if (match) {
        clearTimeout(timeout);
        resolve({ proc, port: Number(match[1]) });
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Sidecar exited with code ${code}.\nOutput: ${output}`));
      }
    });
  });
}

/**
 * Subscribe a tenant via the sidecar's Deployment endpoint.
 */
async function subscribeTenant(tenant, port) {
  const res = await fetch(`http://localhost:${port}/-/cds/deployment/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from('yves:').toString('base64')
    },
    body: JSON.stringify({ tenant })
  });
  return res.status;
}

/**
 * Upgrade a tenant via the sidecar's Deployment endpoint.
 */
async function upgradeTenant(tenant, port) {
  const res = await fetch(`http://localhost:${port}/-/cds/deployment/upgrade`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from('yves:').toString('base64')
    },
    body: JSON.stringify({ tenant })
  });
  return res.status;
}

/**
 * Stop the sidecar process and clean up DB files.
 */
async function stopSidecar(proc) {
  if (proc && !proc.killed) {
    if (proc.exitCode === null) {
      proc.kill();
      await Promise.race([new Promise((resolve) => proc.on('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  }
  cleanDbFiles();
}

module.exports = { APP_DIR, SIDECAR_DIR, ensureSidecarPlugin, cleanDbFiles, startSidecar, subscribeTenant, upgradeTenant, stopSidecar };
