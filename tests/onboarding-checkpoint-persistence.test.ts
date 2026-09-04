import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../electron/main/db-migrations'

/**
 * Revision-guarded checkpoint writes, exercised against real SQLite rather than
 * the in-memory store, so the ON CONFLICT ... WHERE guard is actually verified.
 */

function createDb() {
  const db = new Database(':memory:')
  // Migration 2 indexes these tables, so they must exist before migrating.
  db.exec(`
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT);
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, updated_at TEXT);
    CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY, status TEXT, scheduled_time TEXT);
    CREATE TABLE social_content (id INTEGER PRIMARY KEY, author_handle TEXT, subreddit TEXT, posted_at TEXT);
    CREATE TABLE model_exhaustion (id INTEGER PRIMARY KEY, model TEXT, api_key_id INTEGER, available_at TEXT);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY, provider TEXT, tier TEXT, is_active INTEGER, created_at TEXT);
  `)
  runMigrations(db)
  return db
}

// Mirrors saveOnboardingCheckpointAtRevision in db.ts.
function save(db: Database.Database, runId: string, revision: number, status = 'running') {
  return db.prepare(`
    INSERT INTO onboarding_runs (run_id, phase, status, checkpoint_json, last_error_code, revision, updated_at, completed_at)
    VALUES (@runId, @phase, @status, @json, NULL, @revision, datetime('now'),
            CASE WHEN @status IN ('complete', 'failed', 'cancelled') THEN datetime('now') ELSE NULL END)
    ON CONFLICT(run_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      checkpoint_json = excluded.checkpoint_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
    WHERE onboarding_runs.revision < excluded.revision
  `).run({
    runId,
    phase: 'interview',
    status,
    json: JSON.stringify({ version: 2, runId, revision }),
    revision,
  }).changes > 0
}

describe('onboarding_runs schema', () => {
  it('adds the revision column via migration', () => {
    const db = createDb()
    const columns = (db.pragma('table_info(onboarding_runs)') as Array<{ name: string }>).map(c => c.name)

    expect(columns).toContain('revision')
    expect(columns).toContain('checkpoint_backup_json')
    db.close()
  })

  it('defaults revision to 0 for rows created before the migration', () => {
    const db = createDb()
    db.prepare(`
      INSERT INTO onboarding_runs (run_id, phase, status, checkpoint_json)
      VALUES ('legacy_run', 'gather', 'running', '{}')
    `).run()

    const row = db.prepare('SELECT revision FROM onboarding_runs WHERE run_id = ?').get('legacy_run') as { revision: number }
    expect(row.revision).toBe(0)
    db.close()
  })
})

describe('revision-guarded writes', () => {
  it('accepts strictly increasing revisions', () => {
    const db = createDb()

    expect(save(db, 'run_1', 1)).toBe(true)
    expect(save(db, 'run_1', 2)).toBe(true)
    expect(save(db, 'run_1', 3)).toBe(true)

    const row = db.prepare('SELECT revision FROM onboarding_runs WHERE run_id = ?').get('run_1') as { revision: number }
    expect(row.revision).toBe(3)
    db.close()
  })

  it('rejects a stale writer without corrupting newer state', () => {
    const db = createDb()
    save(db, 'run_2', 5)

    // A timed-out interaction racing a submitted answer must lose.
    expect(save(db, 'run_2', 4, 'paused')).toBe(false)
    expect(save(db, 'run_2', 5, 'paused')).toBe(false)

    const row = db.prepare('SELECT revision, status FROM onboarding_runs WHERE run_id = ?').get('run_2') as { revision: number; status: string }
    expect(row.revision).toBe(5)
    expect(row.status).toBe('running')
    db.close()
  })

  it('keeps runs independent', () => {
    const db = createDb()
    save(db, 'run_a', 3)
    save(db, 'run_b', 1)

    expect(save(db, 'run_b', 2)).toBe(true)

    const a = db.prepare('SELECT revision FROM onboarding_runs WHERE run_id = ?').get('run_a') as { revision: number }
    const b = db.prepare('SELECT revision FROM onboarding_runs WHERE run_id = ?').get('run_b') as { revision: number }
    expect(a.revision).toBe(3)
    expect(b.revision).toBe(2)
    db.close()
  })

  it('stamps completed_at only for terminal states', () => {
    const db = createDb()
    save(db, 'run_c', 1, 'running')
    expect((db.prepare('SELECT completed_at FROM onboarding_runs WHERE run_id = ?').get('run_c') as any).completed_at).toBeNull()

    save(db, 'run_c', 2, 'complete')
    expect((db.prepare('SELECT completed_at FROM onboarding_runs WHERE run_id = ?').get('run_c') as any).completed_at).not.toBeNull()
    db.close()
  })
})
