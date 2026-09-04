const path = require('path')
const {
  resolveNativeOwner,
  isExternallyOwned,
  parseCompiledAbi,
  describeAbi,
} = require('./native-abi.cjs')

const Database = require('better-sqlite3')

try {
  // Constructing the Database is what actually loads the addon; a bare
  // require() of the package does not, so it cannot detect an ABI mismatch.
  const db = new Database(':memory:')
  db.exec('CREATE TABLE smoke (value TEXT NOT NULL)')
  db.prepare('INSERT INTO smoke (value) VALUES (?)').run('ok')
  const row = db.prepare('SELECT value FROM smoke').get()
  db.close()

  if (row?.value !== 'ok') {
    throw new Error('SQLite smoke query returned an unexpected result')
  }

  console.log('better-sqlite3 Node ABI smoke test passed')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const expected = Number(process.versions.modules)
  const compiled = parseCompiledAbi(message)
  const owner = resolveNativeOwner()
  const projectRoot = path.resolve(__dirname, '..')

  console.error(`better-sqlite3 Node ABI smoke test failed: ${message}`)
  console.error('')
  console.error(`  binary:   ${owner ? owner.binaryPath : '(could not resolve better-sqlite3)'}`)
  console.error(`  expected: ABI ${expected} (Node ${process.version})`)
  console.error(`  found:    ${compiled == null ? 'unknown' : `ABI ${compiled} — built for ${describeAbi(compiled)}`}`)
  console.error('')

  if (owner && isExternallyOwned(owner, projectRoot)) {
    // The common trap: `npm rebuild` would target this project and no-op,
    // because the package is installed somewhere else.
    console.error(`  This package is installed outside the project, under ${owner.prefix}.`)
    console.error('  A plain "npm rebuild" here would report success without touching it.')
    console.error('  "npm run native:node" handles this by rebuilding the owning prefix.')
  } else {
    console.error('  Run "npm run native:node" to rebuild it for Node, then retry.')
  }

  console.error('  Afterwards, run "npm run native:electron" before "npm run dev", "build", or "preview".')
  process.exitCode = 1
}
