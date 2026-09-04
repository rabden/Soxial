import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userData: '',
  databasePath: '',
  db: null as any,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData,
    getVersion: () => 'test-version',
  },
}))

vi.mock('../electron/main/db', () => ({
  getDb: () => {
    if (!state.db) state.db = new Database(state.databasePath)
    return state.db
  },
  getDatabasePath: () => state.databasePath,
  getSchemaVersion: (db: any) => Number(db.pragma('user_version', { simple: true })) || 0,
  closeDb: () => {
    if (!state.db) return
    state.db.pragma('wal_checkpoint(TRUNCATE)')
    state.db.close()
    state.db = null
  },
}))

import { createBackup, exportUserData, listBackups, pruneBackups, restoreBackup, verifyBackup } from '../electron/main/backup'

describe('SQLite backup and portable export', () => {
  let directory = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'soxial-backup-test-'))
    state.userData = directory
    state.databasePath = join(directory, 'soxial.db')
    state.db = new Database(state.databasePath)
    state.db.pragma('journal_mode = WAL')
    state.db.pragma('user_version = 5')
    state.db.exec(`
      CREATE TABLE user_profile (id INTEGER PRIMARY KEY, name TEXT, gemini_api_key TEXT, puter_token TEXT);
      CREATE TABLE memory_entries (id INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE hooks (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE replies (id INTEGER PRIMARY KEY, text TEXT);
      CREATE TABLE voice_rules (id INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE algorithm_rules (id INTEGER PRIMARY KEY, description TEXT);
      CREATE TABLE content_pillars (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE target_accounts (id INTEGER PRIMARY KEY, handle TEXT);
      CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY, text TEXT, media_path TEXT);
      CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, title TEXT);
      CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER, content TEXT);
      CREATE TABLE growth_milestones (id INTEGER PRIMARY KEY, note TEXT);
      CREATE TABLE social_content (id INTEGER PRIMARY KEY, text TEXT);
      CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT);
    `)
    state.db.prepare('INSERT INTO user_profile (id, name, gemini_api_key, puter_token) VALUES (1, ?, ?, ?)').run('Ada', 'AIzaSyVerySecretKeyThatMustNotExport', 'token-secret')
    state.db.prepare('INSERT INTO chat_sessions (id, title) VALUES (1, ?)').run('Ideas')
    state.db.prepare('INSERT INTO chat_messages (session_id, content) VALUES (1, ?)').run('Use api_key=AIzaSyVerySecretKeyThatMustNotExport')
  })

  afterEach(() => {
    if (state.db) {
      state.db.close()
      state.db = null
    }
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates a WAL-safe backup with matching integrity and checksum', async () => {
    const backup = await createBackup('test')
    const verified = await verifyBackup(backup.fileName)

    expect(backup.integrityCheck).toBe('ok')
    expect(backup.schemaVersion).toBe(5)
    expect(verified.verified).toBe(true)
    expect(verified.sha256).toHaveLength(64)
  })

  it('rejects a corrupted backup and restores a valid snapshot round trip', async () => {
    const backup = await createBackup('test')
    const backupPath = join(directory, 'backups', backup.fileName)
    const bytes = readFileSync(backupPath)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(backupPath, bytes)
    expect((await verifyBackup(backup.fileName)).verified).toBe(false)

    const validBackup = await createBackup('valid')
    state.db.prepare('UPDATE user_profile SET name = ? WHERE id = 1').run('Changed')
    await restoreBackup(validBackup.fileName)
    expect(state.db.prepare('SELECT name FROM user_profile WHERE id = 1').get()).toEqual({ name: 'Ada' })
  })

  it('exports user data without credentials', async () => {
    const destination = join(directory, 'export.json')
    const result = await exportUserData(destination)
    const exported = readFileSync(destination, 'utf8')

    expect(result.format).toBe('json')
    expect(exported).toContain('Ada')
    expect(exported).toContain('credentialsExcluded')
    expect(exported).not.toContain('AIzaSyVerySecretKeyThatMustNotExport')
    expect(exported).not.toContain('token-secret')
    expect(exported).toContain('api_key=[REDACTED]')
  })

  it('prunes old snapshots while retaining the newest verified backup', async () => {
    await createBackup('one', { prune: false })
    await createBackup('two', { prune: false })
    await createBackup('three', { prune: false })
    await pruneBackups({ daily: 1, weekly: 0, maxCount: 2, maxBytes: 1024 * 1024 * 1024 })

    const backups = await listBackups()
    expect(backups.every(backup => backup.verified)).toBe(true)
    expect(backups.length).toBe(2)
  })

  it('leaves no apparently valid final file when backup creation is interrupted', async () => {
    const originalBackup = state.db.backup.bind(state.db)
    state.db.backup = () => Promise.reject(new Error('simulated interruption'))

    await expect(createBackup('interrupted')).rejects.toThrow('simulated interruption')
    expect((await listBackups()).some(backup => backup.reason === 'interrupted')).toBe(false)
    expect(originalBackup).toBeTypeOf('function')
  })
})
