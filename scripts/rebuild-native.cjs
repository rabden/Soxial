// Rebuild better-sqlite3 for the CURRENT Node ABI.
//
// Plain `npm rebuild better-sqlite3` targets the local prefix, which is wrong
// whenever the package resolves to a node_modules outside this project. In that
// case npm reports success while the binary that actually gets loaded is
// untouched. Resolve the owning prefix first and rebuild there.

const { spawnSync } = require('child_process')
const path = require('path')
const { PACKAGE_NAME, resolveNativeOwner, isExternallyOwned } = require('./native-abi.cjs')

const projectRoot = path.resolve(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')

const owner = resolveNativeOwner()

if (!owner) {
  console.error(`Cannot find ${PACKAGE_NAME}. Run "npm ci" under Node 24.x first.`)
  process.exit(1)
}

console.log(`${PACKAGE_NAME} resolves to: ${owner.packageRoot}`)

if (isExternallyOwned(owner, projectRoot)) {
  console.log(`Note: the package is installed outside this project, so the rebuild targets its owner (${owner.prefix}).`)
  console.log('That node_modules is shared, so this also changes the ABI for anything else using it.')
}

const args = ['rebuild', PACKAGE_NAME, '--force', '--prefix', owner.prefix]

if (dryRun) {
  console.log(`[dry run] npm ${args.join(' ')}`)
  process.exit(0)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' })

if (result.error) {
  console.error(`Failed to run npm rebuild: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
