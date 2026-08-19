import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'establish-versioned-migration-ledger',
    up: () => {
      // The pre-existing schema is the baseline. Future schema changes belong here.
    },
  },
  {
    version: 2,
    name: 'add-operational-query-indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
          ON chat_messages(session_id, created_at, id);
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated
          ON chat_sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_time
          ON scheduled_posts(status, scheduled_time);
        CREATE INDEX IF NOT EXISTS idx_social_content_author_posted
          ON social_content(author_handle, posted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_social_content_subreddit_posted
          ON social_content(subreddit, posted_at DESC);
      `)
    },
  },
  {
    version: 3,
    name: 'add-model-exhaustion-and-active-key-indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_model_exhaustion_model_key_available
          ON model_exhaustion(model, api_key_id, available_at);
        CREATE INDEX IF NOT EXISTS idx_api_keys_provider_tier_active
          ON api_keys(provider, tier, created_at)
          WHERE is_active = 1;
      `)
    },
  },
  {
    version: 4,
    name: 'add-onboarding-checkpoints',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS onboarding_runs (
          run_id TEXT PRIMARY KEY,
          phase TEXT NOT NULL,
          status TEXT NOT NULL,
          checkpoint_json TEXT NOT NULL,
          last_error_code TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_onboarding_runs_status_updated
          ON onboarding_runs(status, updated_at DESC);
      `)
    },
  },
  {
    version: 5,
    name: 'add-onboarding-checkpoint-quarantine',
    up: (db) => {
      const columns = db.pragma('table_info(onboarding_runs)') as Array<{ name: string }>
      if (!columns.some(column => column.name === 'checkpoint_backup_json')) {
        db.exec('ALTER TABLE onboarding_runs ADD COLUMN checkpoint_backup_json TEXT')
      }
    },
  },
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const appliedRows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as { version: number; name: string }[]
  const applied = new Set(appliedRows.map(row => row.version))
  const highestApplied = appliedRows.at(-1)?.version ?? 0
  const pending = migrations.filter(migration => !applied.has(migration.version))
  if (pending.length > 0 && pending[0].version > highestApplied + 1) {
    throw new Error(`Database migration gap: expected version ${highestApplied + 1}, found ${pending[0].version}`)
  }
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      migration.up(db)
      record.run(migration.version, migration.name)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }

  const integrity = db.pragma('integrity_check', { simple: true }) as string
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
  const foreignKeys = db.pragma('foreign_key_check') as unknown[]
  if (foreignKeys.length > 0) throw new Error(`SQLite foreign-key check failed with ${foreignKeys.length} violation(s)`)
}
