/**
 * Vitest global setup: self-heal the better-sqlite3 ABI before any test runs.
 *
 * better-sqlite3 is a C++ addon pinned to a single NODE_MODULE_VERSION, but
 * Soxial loads it from two runtimes with different ABIs: Electron (dev/build,
 * rebuilt to ABI 146 by `native:electron`) and Node (tests, ABI 137). The one
 * compiled binary at build/Release/better_sqlite3.node can only match one at a
 * time, so after a `npm run dev` every DB-touching test fails with
 * "compiled against a different Node.js version" under a bare
 * `npx vitest run`.
 *
 * `npm test` already guards against this via `native:node` (see
 * scripts/rebuild-native.cjs). This setup makes ANY vitest entrypoint safe:
 * probe-load the addon in a fresh child process, and on an ABI mismatch
 * rebuild for the current Node before the suite starts.
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { parseCompiledAbi, describeAbi } = require('./native-abi.cjs')

const ROOT = path.resolve(__dirname, '..')
const SMOKE = path.join(__dirname, 'native-smoke.cjs')
const REBUILD = path.join(__dirname, 'rebuild-native.cjs')

/** Load the addon in a fresh process — a bare require() cannot detect a mismatch. */
function probe() {
  return spawnSync(process.execPath, [SMOKE], { cwd: ROOT, encoding: 'utf8' })
}

module.exports = async function globalSetup() {
  let smoke = probe()
  if (smoke.status === 0) return

  const compiledAbi = parseCompiledAbi(smoke.stderr || smoke.stdout)
  console.log(
    `[vitest-setup] better-sqlite3 binary is built for ${describeAbi(compiledAbi)} — ` +
      `rebuilding for Node ${process.version} (NODE_MODULE_VERSION ${process.versions.modules}) before tests…`,
  )

  const rebuild = spawnSync(process.execPath, [REBUILD], { cwd: ROOT, stdio: 'inherit' })
  if (rebuild.status !== 0) {
    throw new Error(
      `[vitest-setup] better-sqlite3 ABI rebuild failed (exit ${rebuild.status}). ` +
        'Run "npm run native:node" manually, then retry the tests.',
    )
  }

  smoke = probe()
  if (smoke.status !== 0) {
    throw new Error(
      `[vitest-setup] better-sqlite3 still fails to load after the rebuild:\n${(smoke.stderr || smoke.stdout).trim()}`,
    )
  }
  console.log('[vitest-setup] better-sqlite3 ABI restored for tests.')
}
