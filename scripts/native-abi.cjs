// Shared helpers for locating and diagnosing the better-sqlite3 native addon.
//
// better-sqlite3 compiles to one .node binary pinned to a single
// NODE_MODULE_VERSION. Soxial loads it from two runtimes with different ABIs
// (Node for tests, Electron for dev/build), so the binary must be rebuilt when
// switching between them.

const path = require('path')

const PACKAGE_NAME = 'better-sqlite3'

/**
 * Locate the node_modules tree that actually owns better-sqlite3.
 *
 * `npm rebuild` acts on the local prefix. When the package resolves to a
 * node_modules outside this project (linked checkouts, hoisted monorepos,
 * shared worktrees), that prefix owns nothing and the rebuild silently
 * succeeds without touching the binary that will be loaded.
 */
function resolveNativeOwner(resolver) {
  const resolve = resolver || ((request) => require.resolve(request))

  let manifestPath
  try {
    manifestPath = resolve(`${PACKAGE_NAME}/package.json`)
  } catch {
    return null
  }

  // <prefix>/node_modules/better-sqlite3/package.json
  const packageRoot = path.dirname(manifestPath)
  const nodeModules = path.dirname(packageRoot)
  const prefix = path.dirname(nodeModules)

  return {
    packageRoot,
    prefix,
    binaryPath: path.join(packageRoot, 'build', 'Release', `${PACKAGE_NAME.replace(/-/g, '_')}.node`),
  }
}

/** True when the package lives outside `projectRoot`, so a plain rebuild misses it. */
function isExternallyOwned(owner, projectRoot) {
  if (!owner) return false
  const relative = path.relative(projectRoot, owner.packageRoot)
  return relative.startsWith('..') || path.isAbsolute(relative)
}

/** Pull the ABI the binary was built against out of a Node load error. */
function parseCompiledAbi(message) {
  const match = /NODE_MODULE_VERSION\s+(\d+)/.exec(String(message || ''))
  return match ? Number(match[1]) : null
}

/**
 * Map an ABI to the runtime that uses it, so the message says *why* the binary
 * is wrong rather than only that it is wrong.
 */
function describeAbi(abi) {
  if (abi == null) return 'unknown runtime'
  if (abi === Number(process.versions.modules)) return `Node ${process.version}`
  // Electron ABIs are well ahead of Node's for a given calendar release.
  if (abi > Number(process.versions.modules)) return 'Electron (run "npm run native:electron" to restore it)'
  return 'an older runtime'
}

module.exports = {
  PACKAGE_NAME,
  resolveNativeOwner,
  isExternallyOwned,
  parseCompiledAbi,
  describeAbi,
}
