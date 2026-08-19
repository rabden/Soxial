const Database = require('better-sqlite3')

try {
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
  console.error(`better-sqlite3 Node ABI smoke test failed: ${message}`)
  console.error(`Node ${process.version} expects native ABI ${process.versions.modules}.`)
  console.error('Run "npm ci" under Node 24.x, then "npm run native:node" and retry.')
  process.exitCode = 1
}
