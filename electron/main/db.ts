import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { seedDatabase } from './seed'
import { logger } from './log'
import { credentialFingerprint, deleteCredential, getCredential, saveCredential } from './credentials'
import { runMigrations } from './db-migrations'
import { decodeStepsFromStorage, encodeStepsForStorage } from './steps-storage'
import {
  normalizeModelId,
  parseModelRef,
  customModelId,
  GOOGLE_MODEL_CATALOG,
  ZHIPU_MODEL_CATALOG,
  OPENAI_MODEL_CATALOG,
  ANTHROPIC_MODEL_CATALOG,
} from './models'

let db: Database.Database | null = null

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'soxial.db')
}

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = getDatabasePath()
  logger.info('db', `opening database: ${dbPath}`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initSchema(db)
  seedDatabase(db)

  return db
}

export function getSchemaVersion(database: Database.Database = getDb()): number {
  const row = database.pragma('user_version', { simple: true })
  return Number(row) || 0
}

export function closeDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    logger.warn('db', 'WAL checkpoint before close failed', error)
  }
  db.close()
  db = null
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      twitter_handle TEXT,
      twitter_name TEXT,
      reddit_username TEXT,
      reddit_display_name TEXT,
      timezone TEXT,
      has_premium INTEGER DEFAULT 0,
      niche TEXT,
      specialization TEXT,
      superpower TEXT,
      primary_goal TEXT,
      target_audience TEXT,
      voice_description TEXT,
      avoid_words TEXT,
      brand_primary_color TEXT DEFAULT '#3b82f6',
      brand_secondary_color TEXT DEFAULT '#1c1c1c',
      brand_accent_color TEXT DEFAULT '#60a5fa',
      style_preset TEXT DEFAULT 'Modern Clean',
      zai_api_key TEXT,
      gemini_api_key TEXT,
      openai_api_key TEXT,
      onboarding_complete INTEGER DEFAULT 0,
      branding_strategy TEXT,
      app_mode TEXT DEFAULT 'agent' CHECK(app_mode IN ('agent', 'human')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      platform TEXT,
      title TEXT,
      content TEXT,
      data_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank INTEGER NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      why_it_works TEXT,
      template TEXT,
      niche_examples TEXT,
      performance_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voice_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS algorithm_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      signal TEXT NOT NULL,
      weight TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS content_pillars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      structure TEXT,
      frequency TEXT,
      platform_adaptations TEXT
    );

    CREATE TABLE IF NOT EXISTS target_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      tier TEXT,
      why TEXT,
      strategy TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      type TEXT,
      text TEXT,
      media_path TEXT,
      hashtags TEXT,
      first_reply TEXT,
      scheduled_time TEXT,
      status TEXT DEFAULT 'draft',
      result_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      attachments_json TEXT, -- TODO: move large attachments to file-backed storage if DB size becomes an issue
      reasoning TEXT,
      tool_calls_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS growth_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      metric TEXT NOT NULL,
      value TEXT,
      note TEXT,
      recorded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quick_actions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      suggestions TEXT NOT NULL,
      generated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS social_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      author_handle TEXT,
      subreddit TEXT,
      title TEXT,
      text TEXT,
      metrics_json TEXT,
      data_json TEXT NOT NULL,
      posted_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      UNIQUE(platform, content_type, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_social_content_platform_type
      ON social_content(platform, content_type, posted_at DESC);

    CREATE TABLE IF NOT EXISTS api_tier_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tier TEXT DEFAULT 'free',
      detected_at TEXT DEFAULT (datetime('now')),
      last_verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT,
      credential_ref TEXT,
      fingerprint TEXT,
      provider TEXT DEFAULT 'google',
      tier TEXT DEFAULT 'unknown',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS model_exhaustion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      api_key_id INTEGER,
      exhausted_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_model_exhaustion_model
      ON model_exhaustion(model);
    CREATE INDEX IF NOT EXISTS idx_model_exhaustion_available
      ON model_exhaustion(available_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_active
      ON api_keys(is_active);

    CREATE TABLE IF NOT EXISTS custom_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      credential_ref TEXT,
      models_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  runMigrations(db)

  // Migration: add context_summary if missing
  const cols = db.pragma('table_info(chat_sessions)') as any[]
  if (!cols.some((c: any) => c.name === 'context_summary')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN context_summary TEXT')
  }

  // Migration: title lifecycle (ticket #67) — kind guards write-once vs
  // manual renames; turn is the refresh watermark ([1, 3, 6]).
  if (!cols.some((c: any) => c.name === 'title_kind')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN title_kind TEXT')
  }
  if (!cols.some((c: any) => c.name === 'title_turn')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN title_turn INTEGER')
  }

  // Migration: persisted ask_user question (ticket #69) — survives an app
  // close mid-turn so the interaction isn't silently lost.
  if (!cols.some((c: any) => c.name === 'pending_question')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN pending_question TEXT')
  }

  // Migration: transcript drift check (ticket #71) — fingerprint of the
  // app-history user messages the stored transcript covers.
  if (!cols.some((c: any) => c.name === 'steps_fingerprint')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN steps_fingerprint TEXT')
  }

  // Migration: persist chat attachments for image-augmented messages
  const messageCols = db.pragma('table_info(chat_messages)') as any[]
  if (!messageCols.some((c: any) => c.name === 'attachments_json')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT')
  }

  // Migration: pending marks an assistant row created at turn start whose
  // turn never finalized (crash/close mid-turn) — step-boundary persistence
  // (spec #65, ticket #68).
  if (!messageCols.some((c: any) => c.name === 'pending')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN pending INTEGER NOT NULL DEFAULT 0')
  }

  // Repair: heal invalid truncated stubs from the first 40k cap ship (ticket #71).
  // The initial truncation wrote `{storedTruncated, preview}` without a `type`
  // discriminator, which fails `modelMessageSchema` on reuse (session 4).
  // This is idempotent — re-encodes any already-persisted invalid envelope.
  try {
    const rows = db.prepare("SELECT id, steps_json FROM chat_sessions WHERE steps_json LIKE '%\"storedTruncated\":true%'").all() as any[]
    for (const row of rows) {
      const repaired = decodeStepsFromStorage(row.steps_json)
      if (!repaired) continue
      const fixed = JSON.stringify({ v: 1, steps: repaired })
      if (fixed !== row.steps_json) {
        db.prepare('UPDATE chat_sessions SET steps_json = ? WHERE id = ?').run(fixed, row.id)
        logger.info('db', `repaired invalid truncated transcript in session ${row.id}`)
      }
    }
  } catch (e: any) {
    logger.warn('db', `transcript stub repair failed: ${e?.message || e}`)
  }

  // Migration: add puter_token if missing
  const profileCols = db.pragma('table_info(user_profile)') as any[]
  if (!profileCols.some((c: any) => c.name === 'puter_token')) {
    db.exec('ALTER TABLE user_profile ADD COLUMN puter_token TEXT')
  }

  // Migration: add growth_strategy if missing
  if (!profileCols.some((c: any) => c.name === 'growth_strategy')) {
    db.exec('ALTER TABLE user_profile ADD COLUMN growth_strategy TEXT')
  }

  const MISSING_COLS = ['tools_stack', 'monetization_goals', 'growth_target', 'portfolio_status', 'tone_balance', 'branding_strategy', 'twitter_name', 'reddit_display_name']
  for (const col of MISSING_COLS) {
    if (!profileCols.some((c: any) => c.name === col)) {
      db.exec(`ALTER TABLE user_profile ADD COLUMN ${col} TEXT`)
    }
  }

  // Migration: make model_exhaustion.api_key_id nullable (NULL = primary/profile key)
  const meCols = db.pragma('table_info(model_exhaustion)') as any[]
  const apiKeyIdCol = meCols.find((c: any) => c.name === 'api_key_id')
  if (apiKeyIdCol && apiKeyIdCol.notnull === 1) {
    // Ephemeral data (5h cooldown) — safe to drop and recreate with nullable column
    db.exec('DROP TABLE IF EXISTS model_exhaustion')
    db.exec(`
      CREATE TABLE model_exhaustion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        api_key_id INTEGER,
        exhausted_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_model_exhaustion_model ON model_exhaustion(model);
      CREATE INDEX IF NOT EXISTS idx_model_exhaustion_available ON model_exhaustion(available_at);
    `)
  }

  // Migration: add tier column to api_keys if missing
  let apiKeyCols = db.pragma('table_info(api_keys)') as any[]
  const legacyApiKeyColumn = apiKeyCols.find((c: any) => c.name === 'api_key')
  if (legacyApiKeyColumn?.notnull === 1) {
    // Older databases declared api_key NOT NULL. Credential migration needs to
    // clear that column after moving the value to the OS credential vault.
    // API-key usage cooldowns are ephemeral, so recreate that table as part of
    // the same compatibility migration to avoid leaving a foreign-key pointer
    // to the renamed legacy table.
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS model_exhaustion;
      ALTER TABLE api_keys RENAME TO api_keys_legacy_notnull;
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        api_key TEXT,
        credential_ref TEXT,
        fingerprint TEXT,
        provider TEXT DEFAULT 'google',
        tier TEXT DEFAULT 'unknown',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        last_used_at TEXT
      );
      INSERT INTO api_keys (id, name, api_key, provider, is_active, created_at, last_used_at)
        SELECT id, name, api_key, provider, is_active, created_at, last_used_at
        FROM api_keys_legacy_notnull;
      DROP TABLE api_keys_legacy_notnull;
      CREATE TABLE model_exhaustion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        api_key_id INTEGER,
        exhausted_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_model_exhaustion_model ON model_exhaustion(model);
      CREATE INDEX IF NOT EXISTS idx_model_exhaustion_available ON model_exhaustion(available_at);
      PRAGMA foreign_keys = ON;
    `)
    apiKeyCols = db.pragma('table_info(api_keys)') as any[]
  }
  if (!apiKeyCols.some((c: any) => c.name === 'tier')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN tier TEXT DEFAULT \'unknown\'')
  }
  if (!apiKeyCols.some((c: any) => c.name === 'credential_ref')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN credential_ref TEXT')
  }
  if (!apiKeyCols.some((c: any) => c.name === 'fingerprint')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN fingerprint TEXT')
  }
  // Migrate legacy plaintext key rows into the OS-encrypted credential vault.
  const legacyApiKeys = db.prepare('SELECT id, api_key FROM api_keys WHERE api_key IS NOT NULL AND api_key != \'\'').all() as { id: number; api_key: string }[]
  for (const row of legacyApiKeys) {
    const ref = `api-key-${row.id}`
    saveCredential(ref, row.api_key)
    db.prepare('UPDATE api_keys SET api_key = NULL, credential_ref = ?, fingerprint = ? WHERE id = ?')
      .run(ref, credentialFingerprint(row.api_key), row.id)
  }

  // Migration: normalize legacy custom-named additional keys to the "Key N" scheme.
  // The new UI no longer collects names; old keys ("Personal", "Work", …) get renamed
  // so the DB stays uniform. Idempotent: a no-op once every name matches Key % or is 'Primary'.
  const legacyKeyRows = db.prepare(
    "SELECT id FROM api_keys WHERE is_active = 1 AND name != 'Primary' AND name NOT LIKE 'Key %' ORDER BY id ASC"
  ).all() as { id: number }[]
  if (legacyKeyRows.length > 0) {
    let maxKeyNum = 0
    for (const r of db.prepare("SELECT name FROM api_keys WHERE name LIKE 'Key %'").all() as { name: string }[]) {
      const m = /^Key (\d+)$/.exec(r.name || '')
      if (m) maxKeyNum = Math.max(maxKeyNum, parseInt(m[1], 10))
    }
    const renameStmt = db.prepare('UPDATE api_keys SET name = ? WHERE id = ?')
    const tx = db.transaction((rows: { id: number }[]) => {
      for (const row of rows) {
        maxKeyNum++
        renameStmt.run(`Key ${maxKeyNum}`, row.id)
      }
    })
    tx(legacyKeyRows)
    logger.info('db', `normalized ${legacyKeyRows.length} legacy API key name(s) to Key N`)
  }

  // Migration: persist authoritative Interactions API steps per session.
  // Stores verbatim server steps (thought signatures + function_call ids +
  // function_result payloads) so multi-turn history round-trips correctly.
  const sessionCols = db.pragma('table_info(chat_sessions)') as any[]
  if (!sessionCols.some((c: any) => c.name === 'steps_json')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN steps_json TEXT')
  }
  if (!sessionCols.some((c: any) => c.name === 'steps_user_count')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN steps_user_count INTEGER DEFAULT 0')
  }
  // Migration: context-token snapshot per session (spec #53). The last
  // provider-reported context size grounds the pre-run compaction gate;
  // NULL means "estimate from scratch".
  if (!sessionCols.some((c: any) => c.name === 'context_tokens')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN context_tokens INTEGER')
  }

  // Migration: add zai_coding_plan column to user_profile table if missing
  if (!profileCols.some((c: any) => c.name === 'zai_coding_plan')) {
    db.exec('ALTER TABLE user_profile ADD COLUMN zai_coding_plan INTEGER DEFAULT 0')
  }

  // Migration: add selected_model column to user_profile table if missing
  if (!profileCols.some((c: any) => c.name === 'selected_model')) {
    db.exec('ALTER TABLE user_profile ADD COLUMN selected_model TEXT')
  }

  // Migration: sync primary API keys from user_profile to api_keys table
  // so they participate in uniform rotation, tier detection, and exhaustion tracking.
  // Uses syncPrimaryKeyToApiKeys which updates the existing 'Primary' row in-place
  // when the key changes (avoids duplicate active rows + stale tier labels).
  const profileKeys = db.prepare('SELECT gemini_api_key, zai_api_key FROM user_profile WHERE id = 1').get() as any
  if (profileKeys?.gemini_api_key) syncPrimaryKeyToApiKeys(profileKeys.gemini_api_key, 'google')
  if (profileKeys?.zai_api_key) syncPrimaryKeyToApiKeys(profileKeys.zai_api_key, 'zhipu')
  if (profileKeys?.gemini_api_key || profileKeys?.zai_api_key) {
    db.prepare('UPDATE user_profile SET gemini_api_key = NULL, zai_api_key = NULL WHERE id = 1').run()
  }

  // Migration: add app_mode column to user_profile table if missing
  if (!profileCols.some((c: any) => c.name === 'app_mode')) {
    db.exec("ALTER TABLE user_profile ADD COLUMN app_mode TEXT DEFAULT 'agent' CHECK(app_mode IN ('agent', 'human'))")
  }

  // Dedup: if any stale duplicate 'Primary' rows survived from the old insert-only
  // logic, keep only the newest one per provider and deactivate the rest.
  db.exec(`
    UPDATE api_keys SET is_active = 0
    WHERE name = 'Primary' AND is_active = 1
    AND id NOT IN (
      SELECT MAX(id) FROM api_keys WHERE name = 'Primary' AND is_active = 1 GROUP BY provider
    )
  `)
}

export function getChatSessionSteps(sessionId: number): { steps: any[]; userCount: number; fingerprint: string | null } | null {
  const row = getDb().prepare('SELECT steps_json, steps_user_count, steps_fingerprint FROM chat_sessions WHERE id = ?').get(sessionId) as any
  if (!row || !row.steps_json) return null
  const steps = decodeStepsFromStorage(row.steps_json)
  if (!steps) return null
  return { steps, userCount: row.steps_user_count || 0, fingerprint: row.steps_fingerprint || null }
}

export interface OnboardingRunRow {
  run_id: string
  phase: string
  status: string
  checkpoint_json: string
  last_error_code: string | null
  started_at: string
  updated_at: string
  completed_at: string | null
  revision: number
}

export function saveOnboardingCheckpoint(runId: string, phase: string, status: string, checkpoint: unknown, errorCode?: string): void {
  getDb().prepare(`
    INSERT INTO onboarding_runs (run_id, phase, status, checkpoint_json, last_error_code, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), CASE WHEN ? IN ('complete', 'failed', 'cancelled') THEN datetime('now') ELSE NULL END)
    ON CONFLICT(run_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      checkpoint_json = excluded.checkpoint_json,
      last_error_code = excluded.last_error_code,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `).run(runId, phase, status, JSON.stringify(checkpoint), errorCode ?? null, status)
}

/**
 * Revision-guarded checkpoint write. A save is rejected when the stored
 * revision is already at or beyond the incoming one, so a late writer (for
 * example a timed-out interaction racing a submitted answer) cannot clobber
 * newer state. Returns false when the write was rejected.
 */
export function saveOnboardingCheckpointAtRevision(
  runId: string,
  phase: string,
  status: string,
  checkpoint: { revision: number },
  errorCode?: string,
): boolean {
  const revision = checkpoint.revision
  const result = getDb().prepare(`
    INSERT INTO onboarding_runs (run_id, phase, status, checkpoint_json, last_error_code, revision, updated_at, completed_at)
    VALUES (@runId, @phase, @status, @json, @errorCode, @revision, datetime('now'),
            CASE WHEN @status IN ('complete', 'failed', 'cancelled') THEN datetime('now') ELSE NULL END)
    ON CONFLICT(run_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      checkpoint_json = excluded.checkpoint_json,
      last_error_code = excluded.last_error_code,
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
    WHERE onboarding_runs.revision < excluded.revision
  `).run({
    runId,
    phase,
    status,
    json: JSON.stringify(checkpoint),
    errorCode: errorCode ?? null,
    revision,
  })
  return result.changes > 0
}

export function getOnboardingRun(runId: string): OnboardingRunRow | null {
  return (getDb().prepare('SELECT * FROM onboarding_runs WHERE run_id = ?').get(runId) as OnboardingRunRow | undefined) ?? null
}

export function getLatestResumableOnboardingRun(): OnboardingRunRow | null {
  return (getDb().prepare(`
    SELECT *
    FROM onboarding_runs
    WHERE status IN ('running', 'paused', 'failed')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() as OnboardingRunRow | undefined) ?? null
}

export function quarantineOnboardingRun(runId: string): void {
  getDb().prepare(`
    UPDATE onboarding_runs
    SET checkpoint_backup_json = checkpoint_json,
        status = 'failed',
        phase = 'failed',
        last_error_code = 'CHECKPOINT_CORRUPT',
        updated_at = datetime('now'),
        completed_at = datetime('now')
    WHERE run_id = ?
  `).run(runId)
}

export function clearOnboardingRun(runId: string): void {
  getDb().prepare('DELETE FROM onboarding_runs WHERE run_id = ?').run(runId)
}

export function updateChatSessionSteps(sessionId: number, steps: any[], userCount: number, fingerprint?: string) {
  // Hardened storage (ticket #71): versioned envelope + capped tool results;
  // the fingerprint records which app-history user messages this transcript
  // covers — the reuse-path drift check.
  getDb().prepare('UPDATE chat_sessions SET steps_json = ?, steps_user_count = ?, steps_fingerprint = COALESCE(?, steps_fingerprint), updated_at = datetime(\'now\') WHERE id = ?')
    .run(encodeStepsForStorage(steps), userCount, fingerprint ?? null, sessionId)
}

export function getProfile() {
  const profile = getDb().prepare('SELECT * FROM user_profile WHERE id = 1').get() as any
  if (!profile) return profile
  for (const [field, provider] of [
    ['gemini_api_key', 'google'],
    ['zai_api_key', 'zhipu'],
    ['openai_api_key', 'openai'],
    ['anthropic_api_key', 'anthropic'],
  ] as const) {
    const row = getDb().prepare("SELECT credential_ref, api_key FROM api_keys WHERE provider = ? AND name = 'Primary' AND is_active = 1 ORDER BY id DESC LIMIT 1").get(provider) as any
    profile[field] = row ? (getCredential(row.credential_ref) || row.api_key || null) : null
  }
  return profile
}

export type HostedKeyProvider = 'google' | 'zhipu' | 'openai' | 'anthropic'

export function syncPrimaryKeyToApiKeys(apiKey: string, provider: HostedKeyProvider = 'google'): void {
  const db = getDb()

  // If the exact key already exists and is active, just rename it to Primary
  const fingerprint = credentialFingerprint(apiKey)
  const existing = db.prepare('SELECT id, credential_ref FROM api_keys WHERE fingerprint = ? AND provider = ? AND is_active = 1').get(fingerprint, provider) as any
  if (existing) {
    const ref = existing.credential_ref || `api-key-${existing.id}`
    saveCredential(ref, apiKey)
    db.prepare("UPDATE api_keys SET credential_ref = ?, fingerprint = ?, api_key = NULL, name = 'Primary' WHERE id = ?").run(ref, fingerprint, existing.id)
    return
  }

  // Key changed: update the existing 'Primary' row for this provider in-place
  // (avoids duplicate active rows; resets tier since the new key may differ in capability)
  const currentPrimary = db.prepare("SELECT id, credential_ref FROM api_keys WHERE name = 'Primary' AND provider = ? AND is_active = 1").get(provider) as any
  if (currentPrimary) {
    const ref = currentPrimary.credential_ref || `api-key-${currentPrimary.id}`
    saveCredential(ref, apiKey)
    db.prepare("UPDATE api_keys SET credential_ref = ?, fingerprint = ?, api_key = NULL, tier = 'unknown' WHERE id = ?").run(ref, fingerprint, currentPrimary.id)
    return
  }

  // No existing primary at all: insert new
  const result = db.prepare("INSERT INTO api_keys (name, credential_ref, fingerprint, provider) VALUES ('Primary', ?, ?, ?)").run('', fingerprint, provider)
  const ref = `api-key-${result.lastInsertRowid}`
  saveCredential(ref, apiKey)
  db.prepare('UPDATE api_keys SET credential_ref = ? WHERE id = ?').run(ref, result.lastInsertRowid)
}

export function updateProfile(data: Record<string, any>) {
  const db = getDb()
  const existing = db.prepare('SELECT COUNT(*) as c FROM user_profile WHERE id = 1').get() as any
  if (existing.c === 0) {
    db.prepare('INSERT INTO user_profile (id) VALUES (1)').run()
  }
  if (data.gemini_api_key) syncPrimaryKeyToApiKeys(data.gemini_api_key, 'google')
  if (data.zai_api_key) syncPrimaryKeyToApiKeys(data.zai_api_key, 'zhipu')
  if (data.openai_api_key) syncPrimaryKeyToApiKeys(data.openai_api_key, 'openai')
  if (data.anthropic_api_key) syncPrimaryKeyToApiKeys(data.anthropic_api_key, 'anthropic')
  const profileData = { ...data }
  delete profileData.gemini_api_key
  delete profileData.zai_api_key
  delete profileData.openai_api_key
  delete profileData.anthropic_api_key
  const keys = Object.keys(profileData).filter(k => profileData[k] !== undefined)
  const sets = keys.map(k => `${k} = @${k}`).join(', ')
  if (sets) {
    db.prepare(`UPDATE user_profile SET ${sets} WHERE id = 1`).run(profileData)
  }
  return getProfile()
}

export function queryAll(table: string, where?: string, params?: any[]) {
  const sql = where ? `SELECT * FROM ${table} WHERE ${where}` : `SELECT * FROM ${table}`
  return getDb().prepare(sql).all(...(params || []))
}

export function getScheduledPosts(statuses: string[] = ['draft', 'scheduled']) {
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => '?').join(', ')
  return getDb().prepare(`
    SELECT id, platform, type, text, media_path, hashtags, first_reply,
           scheduled_time, status, result_json, created_at
    FROM scheduled_posts
    WHERE status IN (${placeholders})
    ORDER BY scheduled_time ASC, created_at DESC
  `).all(...statuses)
}

export function insertRow(table: string, data: Record<string, any>) {
  const keys = Object.keys(data)
  const placeholders = keys.map(k => `@${k}`).join(', ')
  const columns = keys.join(', ')
  const result = getDb().prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).run(data)
  return result.lastInsertRowid
}

const ALLOWED_DELETE_TABLES = new Set([
  'scheduled_posts',
  'social_content',
  'quick_actions',
  'memory_entries',
  'chat_sessions',
  'chat_messages'
])

export function deleteRow(table: string, id: number) {
  if (!ALLOWED_DELETE_TABLES.has(table)) {
    throw new Error(`Deletion not allowed for table: ${table}`)
  }
  const result = getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
  return result.changes > 0
}

export function createChatSession(title?: string) {
  const db = getDb()
  const result = db.prepare('INSERT INTO chat_sessions (title) VALUES (?)').run(title || 'New Chat')
  return result.lastInsertRowid
}

export function getChatSessions() {
  return getDb().prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as msg_count
    FROM chat_sessions s ORDER BY s.updated_at DESC
  `).all()
}

export function getChatMessages(sessionId: number) {
  return getDb().prepare(`
    SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC
  `).all(sessionId)
}

export function addChatMessage(
  sessionId: number,
  role: string,
  content: string,
  reasoning?: string,
  toolCallsJson?: string,
  attachmentsJson?: string,
) {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, attachments_json, reasoning, tool_calls_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, role, content, attachmentsJson || null, reasoning || null, toolCallsJson || null)
  db.prepare('UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(sessionId)
  return result.lastInsertRowid
}

export function updateChatSessionTitle(id: number, title: string) {
  getDb().prepare('UPDATE chat_sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, id)
}

/** Stored title lifecycle state (ticket #67). */
export function getChatSessionTitleMeta(sessionId: number): { kind: 'fallback' | 'ai' | 'manual' | null; turn: number } {
  const row = getDb().prepare('SELECT title_kind, title_turn FROM chat_sessions WHERE id = ?').get(sessionId) as any
  return { kind: row?.title_kind ?? null, turn: row?.title_turn ?? 0 }
}

/** Automatic title write (fallback or AI): never clobbers a manual rename —
 * the SQL guard makes the write-once promise atomic. */
export function updateChatSessionTitleSmart(sessionId: number, title: string, kind: 'fallback' | 'ai', turn: number): boolean {
  const result = getDb().prepare(`
    UPDATE chat_sessions SET title = ?, title_kind = ?, title_turn = ?, updated_at = datetime('now')
    WHERE id = ? AND title_kind IS NOT 'manual'
  `).run(title, kind, turn, sessionId)
  return result.changes > 0
}

/** Manual rename — wins forever (blocks all future automatic writes). */
export function renameChatSession(id: number, title: string) {
  getDb().prepare("UPDATE chat_sessions SET title = ?, title_kind = 'manual', updated_at = datetime('now') WHERE id = ?").run(title, id)
}

/** Persisted ask_user question (ticket #69): survives an app close mid-turn. */
export function getChatSessionPendingQuestion(sessionId: number): { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[] } | null {
  const row = getDb().prepare('SELECT pending_question FROM chat_sessions WHERE id = ?').get(sessionId) as any
  if (!row?.pending_question) return null
  try {
    return JSON.parse(row.pending_question)
  } catch {
    return null
  }
}

export function updateChatSessionPendingQuestion(sessionId: number, q: unknown | null) {
  getDb().prepare('UPDATE chat_sessions SET pending_question = ? WHERE id = ?')
    .run(q == null ? null : JSON.stringify(q), sessionId)
}

/** Step-boundary persistence (ticket #68): the assistant row exists from the
 * moment the turn starts, so a crash costs at most the step in flight. */
export function addPendingChatMessage(sessionId: number): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, pending)
    VALUES (?, 'assistant', '', 1)
  `).run(sessionId)
  db.prepare('UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(sessionId)
  return result.lastInsertRowid as number
}

/** Partial content flush at each step boundary (ticket #68). */
export function updateChatMessageContent(id: number, content: string) {
  getDb().prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(content, id)
}

/** Turn completion: finalize the pending assistant row instead of inserting a
 * second one. `reasoning` carries the renderer's UI steps envelope (v2). */
export function finalizeChatMessage(id: number, content: string, reasoning?: string) {
  getDb().prepare('UPDATE chat_messages SET content = ?, reasoning = COALESCE(?, reasoning), pending = 0 WHERE id = ?')
    .run(content, reasoning ?? null, id)
}

export function getChatSessionContextSummary(sessionId: number): string | null {
  const row = getDb().prepare('SELECT context_summary FROM chat_sessions WHERE id = ?').get(sessionId) as any
  return row?.context_summary || null
}

export function getChatSessionContextTokens(sessionId: number): number | null {
  const row = getDb().prepare('SELECT context_tokens FROM chat_sessions WHERE id = ?').get(sessionId) as any
  return typeof row?.context_tokens === 'number' ? row.context_tokens : null
}

export function updateChatSessionContextTokens(sessionId: number, tokens: number) {
  getDb().prepare('UPDATE chat_sessions SET context_tokens = ?, updated_at = datetime(\'now\') WHERE id = ?').run(tokens, sessionId)
}

export function updateChatSessionContextSummary(sessionId: number, summary: string) {
  getDb().prepare('UPDATE chat_sessions SET context_summary = ?, updated_at = datetime(\'now\') WHERE id = ?').run(summary, sessionId)
}

export function deleteChatSession(id: number) {
  getDb().prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id)
  getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
}

export function getQuickActions(): { suggestions: string[]; generated_at: string } | null {
  const row = getDb().prepare('SELECT suggestions, generated_at FROM quick_actions WHERE id = 1').get() as any
  if (!row) return null
  try {
    return { suggestions: JSON.parse(row.suggestions), generated_at: row.generated_at }
  } catch {
    return null
  }
}

export function setQuickActions(suggestions: string[]) {
  const db = getDb()
  const json = JSON.stringify(suggestions)
  db.prepare(`INSERT INTO quick_actions (id, suggestions, generated_at) VALUES (1, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET suggestions = excluded.suggestions, generated_at = excluded.generated_at`).run(json)
}

export function getQuickActionsContext(): string {
  const profile = getDb().prepare('SELECT * FROM user_profile WHERE id = 1').get() as any
  const hooks = getDb().prepare('SELECT name, category, description FROM hooks ORDER BY rank LIMIT 6').all() as any[]
  const pillars = getDb().prepare('SELECT name, description, structure FROM content_pillars LIMIT 4').all() as any[]
  const voice = getDb().prepare('SELECT type, content FROM voice_rules LIMIT 8').all() as any[]
  const targets = getDb().prepare('SELECT platform, handle, tier, strategy FROM target_accounts LIMIT 6').all() as any[]
  const memory = getDb().prepare('SELECT type, title, content FROM memory_entries ORDER BY created_at DESC LIMIT 5').all() as any[]
  const scheduled = getDb().prepare('SELECT COUNT(*) as count FROM scheduled_posts WHERE status = \'draft\'').get() as any
  const lines: string[] = []
  if (profile?.name) lines.push(`User: ${profile.name}`)
  if (profile?.niche) lines.push(`Niche: ${profile.niche}`)
  if (profile?.specialization) lines.push(`Specialization: ${profile.specialization}`)
  if (profile?.voice_description) lines.push(`Voice: ${profile.voice_description}`)
  if (profile?.primary_goal) lines.push(`Goal: ${profile.primary_goal}`)
  if (profile?.target_audience) lines.push(`Target audience: ${profile.target_audience}`)
  if (profile?.twitter_handle) lines.push(`Twitter: ${profile.twitter_handle}`)
  if (profile?.reddit_username) lines.push(`Reddit: ${profile.reddit_username}`)
  if (hooks.length > 0) lines.push(`Hooks: ${hooks.map(h => `${h.name} (${h.category})`).join(', ')}`)
  if (pillars.length > 0) lines.push(`Content pillars: ${pillars.map(p => p.name).join(', ')}`)
  if (voice.length > 0) lines.push(`Voice rules: ${voice.map(v => `${v.type}: ${v.content.slice(0, 60)}`).join(' | ')}`)
  if (targets.length > 0) lines.push(`Target accounts: ${targets.map(t => `${t.platform}/${t.handle} (${t.tier || 'no tier'})`).join(', ')}`)
  if (memory.length > 0) lines.push(`Recent memories: ${memory.map(m => m.title || m.content?.slice(0, 60)).join(' | ')}`)
  if (scheduled?.count > 0) lines.push(`Draft posts pending: ${scheduled.count}`)
  return lines.length > 0 ? lines.join('\n') : 'New user — no profile data yet.'
}

export interface SocialContentRow {
  platform: string
  content_type: string
  external_id: string
  author_handle?: string | null
  subreddit?: string | null
  title?: string | null
  text?: string | null
  metrics_json?: string | null
  data_json: string
  posted_at?: string | null
}

export interface TwitterHandleRebuildCutover {
  twitterHandle: string
  twitterName?: string | null
  profile: {
    niche: string
    specialization: string
    voice_description: string
    avoid_words?: string | null
    branding_strategy?: string | null
    growth_strategy: string
  }
  hooks: Array<{ rank: number; category: string; name: string; description: string; why_it_works?: string | null; template?: string | null; niche_examples?: string | null; performance_notes?: string | null }>
  pillars: Array<{ name: string; description: string; structure?: string | null; frequency?: string | null; platform_adaptations?: string | null }>
  voiceRules: Array<{ type: string; content: string }>
  targetAccounts: Array<{ platform: string; handle: string; tier?: string | null; why?: string | null; strategy?: string | null }>
  replies: Array<{ platform: string; category: string; text: string }>
  twitterSocialContent: SocialContentRow[]
}

export function countActiveTwitterScheduledPosts(db: Database.Database = getDb()): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM scheduled_posts WHERE platform = 'twitter' AND status IN ('draft', 'scheduled')").get() as { count: number }
  return row.count
}

export function applyTwitterHandleRebuild(
  data: TwitterHandleRebuildCutover,
  options?: { db?: Database.Database; expectedActiveTwitterScheduledPostCount?: number; hasConflictingActivity?: () => boolean },
): { profile: any; archivedCount: number } {
  const db = options?.db || getDb()
  if (options?.hasConflictingActivity?.()) throw new Error('Wait for active app generation to finish before rebuilding the profile source.')
  if (options?.expectedActiveTwitterScheduledPostCount != null) {
    const currentCount = countActiveTwitterScheduledPosts(db)
    if (currentCount !== options.expectedActiveTwitterScheduledPostCount) throw new Error('Active Twitter draft/scheduled post count changed. Preview again before rebuilding.')
  }
  const tx = db.transaction((payload: TwitterHandleRebuildCutover) => {
    const archived = db.prepare("UPDATE scheduled_posts SET status = 'archived' WHERE platform = 'twitter' AND status IN ('draft', 'scheduled')").run().changes

    db.prepare(`UPDATE user_profile SET
      twitter_handle = @twitterHandle,
      twitter_name = CASE WHEN @twitterName IS NOT NULL THEN @twitterName ELSE twitter_name END,
      niche = @niche,
      specialization = @specialization,
      voice_description = @voice_description,
      avoid_words = @avoid_words,
      branding_strategy = @branding_strategy,
      growth_strategy = @growth_strategy
      WHERE id = 1`).run({
        twitterHandle: payload.twitterHandle,
        twitterName: payload.twitterName ?? null,
        ...payload.profile,
        avoid_words: payload.profile.avoid_words ?? null,
        branding_strategy: payload.profile.branding_strategy ?? null,
      })

    db.prepare('DELETE FROM hooks').run()
    db.prepare('DELETE FROM content_pillars').run()
    db.prepare('DELETE FROM voice_rules').run()
    db.prepare('DELETE FROM target_accounts').run()
    db.prepare('DELETE FROM replies').run()
    db.prepare("DELETE FROM social_content WHERE platform = 'twitter'").run()
    db.prepare('DELETE FROM quick_actions').run()

    const insertHook = db.prepare(`INSERT INTO hooks (rank, category, name, description, why_it_works, template, niche_examples, performance_notes)
      VALUES (@rank, @category, @name, @description, @why_it_works, @template, @niche_examples, @performance_notes)`)
    const insertPillar = db.prepare(`INSERT INTO content_pillars (name, description, structure, frequency, platform_adaptations)
      VALUES (@name, @description, @structure, @frequency, @platform_adaptations)`)
    const insertVoice = db.prepare('INSERT INTO voice_rules (type, content) VALUES (@type, @content)')
    const insertTarget = db.prepare('INSERT INTO target_accounts (platform, handle, tier, why, strategy) VALUES (@platform, @handle, @tier, @why, @strategy)')
    const insertReply = db.prepare('INSERT INTO replies (platform, category, text) VALUES (@platform, @category, @text)')
    const insertSocial = db.prepare(`INSERT INTO social_content (
      platform, content_type, external_id, author_handle, subreddit, title, text, metrics_json, data_json, posted_at, fetched_at
    ) VALUES (
      @platform, @content_type, @external_id, @author_handle, @subreddit, @title, @text, @metrics_json, @data_json, @posted_at, datetime('now')
    )`)

    for (const row of payload.hooks) insertHook.run({
      ...row,
      why_it_works: row.why_it_works ?? null,
      template: row.template ?? null,
      niche_examples: row.niche_examples ?? null,
      performance_notes: row.performance_notes ?? null,
    })
    for (const row of payload.pillars) insertPillar.run({
      ...row,
      structure: row.structure ?? null,
      frequency: row.frequency ?? null,
      platform_adaptations: row.platform_adaptations ?? null,
    })
    for (const row of payload.voiceRules) insertVoice.run(row)
    for (const row of payload.targetAccounts) insertTarget.run({
      ...row,
      tier: row.tier ?? null,
      why: row.why ?? null,
      strategy: row.strategy ?? null,
    })
    for (const row of payload.replies) insertReply.run(row)
    for (const row of payload.twitterSocialContent) insertSocial.run({
      ...row,
      author_handle: row.author_handle ?? null,
      subreddit: row.subreddit ?? null,
      title: row.title ?? null,
      text: row.text ?? null,
      metrics_json: row.metrics_json ?? null,
      posted_at: row.posted_at ?? null,
    })

    return archived
  })
  const archivedCount = tx(data)
  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get()
  return { profile, archivedCount }
}

export function upsertSocialContent(items: SocialContentRow[]): { inserted: number; updated: number } {
  if (items.length === 0) return { inserted: 0, updated: 0 }
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO social_content (
      platform, content_type, external_id, author_handle, subreddit, title, text, metrics_json, data_json, posted_at, fetched_at
    ) VALUES (
      @platform, @content_type, @external_id, @author_handle, @subreddit, @title, @text, @metrics_json, @data_json, @posted_at, datetime('now')
    )
    ON CONFLICT(platform, content_type, external_id) DO UPDATE SET
      author_handle = excluded.author_handle,
      subreddit = excluded.subreddit,
      title = excluded.title,
      text = excluded.text,
      metrics_json = excluded.metrics_json,
      data_json = excluded.data_json,
      posted_at = excluded.posted_at,
      fetched_at = datetime('now')
  `)
  let inserted = 0
  let updated = 0
  const check = db.prepare(
    'SELECT id FROM social_content WHERE platform = ? AND content_type = ? AND external_id = ?'
  )
  const tx = db.transaction((rows: SocialContentRow[]) => {
    for (const row of rows) {
      const existed = check.get(row.platform, row.content_type, row.external_id)
      stmt.run(row)
      if (existed) updated++
      else inserted++
    }
  })
  tx(items)
  return { inserted, updated }
}

export function getSocialContent(options: {
  platform?: string
  content_type?: string
  author_handle?: string
  subreddit?: string
  limit?: number
  include_raw?: boolean
}) {
  const limit = Math.min(options.limit || 50, 200)
  const cols = options.include_raw
    ? 'id, platform, content_type, external_id, author_handle, subreddit, title, text, metrics_json, data_json, posted_at, fetched_at'
    : 'id, platform, content_type, external_id, author_handle, subreddit, title, text, metrics_json, posted_at, fetched_at'
  let sql = `SELECT ${cols} FROM social_content WHERE 1=1`
  const params: any[] = []
  if (options.platform) { sql += ' AND platform = ?'; params.push(options.platform) }
  if (options.content_type) { sql += ' AND content_type = ?'; params.push(options.content_type) }
  if (options.author_handle) {
    sql += ' AND author_handle = ?'
    params.push(options.author_handle.replace(/^@/, ''))
  }
  if (options.subreddit) {
    sql += ' AND subreddit = ?'
    params.push(options.subreddit.replace(/^r\//, ''))
  }
  sql += ' ORDER BY datetime(COALESCE(posted_at, fetched_at)) DESC, id DESC'
  sql += ` LIMIT ${limit}`
  const rows = getDb().prepare(sql).all(...params) as any[]
  return rows.map(row => {
    const out: Record<string, any> = {
      id: row.id,
      platform: row.platform,
      content_type: row.content_type,
      external_id: row.external_id,
      author_handle: row.author_handle,
      subreddit: row.subreddit,
      title: row.title,
      text: row.text,
      posted_at: row.posted_at,
      fetched_at: row.fetched_at,
      metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null,
    }
    if (options.include_raw && row.data_json) {
      try { out.raw = JSON.parse(row.data_json) } catch { out.raw = row.data_json }
    }
    return out
  })
}

export function countSocialContent(options?: { platform?: string; content_type?: string }) {
  let sql = 'SELECT platform, content_type, COUNT(*) as count FROM social_content WHERE 1=1'
  const params: any[] = []
  if (options?.platform) { sql += ' AND platform = ?'; params.push(options.platform) }
  if (options?.content_type) { sql += ' AND content_type = ?'; params.push(options.content_type) }
  sql += ' GROUP BY platform, content_type ORDER BY platform, content_type'
  return getDb().prepare(sql).all(...params)
}

export function getAvailableModels(): string[] {
  const db = getDb()
  const models: string[] = []

  // 1. Google models (full catalog — no tier gating; exhaustion cooldowns are
  // handled at attempt time).
  const googleKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'google\' AND is_active = 1').get() as any
  if (googleKeys.count > 0) {
    for (const m of GOOGLE_MODEL_CATALOG) models.push(m.id)
  }

  // 2. Z.AI (Zhipu) models — full catalog, no coding-plan split (historical separation removed).
  const zhipuKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'zhipu\' AND is_active = 1').get() as any
  if (zhipuKeys.count > 0) {
    for (const m of ZHIPU_MODEL_CATALOG) models.push(m.id)
  }

  // 3. Evaluate OpenAI / Anthropic / user-defined OpenAI-compatible endpoints.
  const openaiKeys = db.prepare("SELECT COUNT(*) as count FROM api_keys WHERE provider = 'openai' AND is_active = 1").get() as any
  if (openaiKeys.count > 0) {
    for (const m of OPENAI_MODEL_CATALOG) models.push(`openai/${m.id}`)
  }
  const anthropicKeys = db.prepare("SELECT COUNT(*) as count FROM api_keys WHERE provider = 'anthropic' AND is_active = 1").get() as any
  if (anthropicKeys.count > 0) {
    for (const m of ANTHROPIC_MODEL_CATALOG) models.push(`anthropic/${m.id}`)
  }
  for (const provider of listActiveCustomProviders()) {
    for (const m of provider.models) models.push(customModelId(provider.id, m.id))
  }

  return models
}

export function getDefaultModel(): string {
  const models = getAvailableModels()
  if (models.includes('gemini-3.7-flash')) return 'gemini-3.7-flash'
  if (models.includes('glm-5.3-flash')) return 'glm-5.3-flash'
  if (models.includes('openai/gpt-5.6-luna')) return 'openai/gpt-5.6-luna'
  if (models.includes('anthropic/claude-sonnet-5')) return 'anthropic/claude-sonnet-5'
  return models[0] || 'gemini-3.5-flash-lite'
}

// Model ids saved before renames resolve onto their current equivalents (see models.ts).
export function getSelectedModel(): string | null {
  const row = getDb().prepare('SELECT selected_model FROM user_profile WHERE id = 1').get() as any
  const value: string | null = row?.selected_model || null
  return value ? normalizeModelId(value) : null
}

export function setSelectedModel(model: string): void {
  getDb().prepare('UPDATE user_profile SET selected_model = ? WHERE id = 1').run(model)
}

export type AppMode = 'agent' | 'human'

export function getAppMode(): AppMode {
  const row = getDb().prepare('SELECT app_mode FROM user_profile WHERE id = 1').get() as { app_mode?: string } | undefined
  const mode = row?.app_mode
  if (mode === 'human' || mode === 'agent') return mode
  return 'agent'
}

export function setAppMode(mode: AppMode): void {
  if (mode !== 'agent' && mode !== 'human') {
    throw new Error(`Invalid app_mode: ${mode}. Must be 'agent' or 'human'.`)
  }
  const db = getDb()
  const existing = db.prepare('SELECT COUNT(*) as c FROM user_profile WHERE id = 1').get() as any
  if (existing.c === 0) {
    db.prepare("INSERT INTO user_profile (id, app_mode) VALUES (1, ?)").run(mode)
  } else {
    db.prepare('UPDATE user_profile SET app_mode = ? WHERE id = 1').run(mode)
  }
}

// ─── API Key Management ───────────────────────────────────────────

/** api_keys.provider value serving a model id ('google'|'zhipu'|'openai'|'anthropic'). */
function apiKeyProviderName(model: string): string {
  return parseModelRef(model).kind
}


export function getApiKeys(provider: string = 'google'): Array<{ id: number; name: string; api_key: string; provider: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }> {
  const db = getDb()
  return (db.prepare('SELECT * FROM api_keys WHERE provider = ? AND is_active = 1 ORDER BY created_at ASC').all(provider) as any[])
    .map(row => ({ ...row, api_key: getCredential(row.credential_ref) || row.api_key || '' }))
}

export function addApiKey(apiKey: string, provider: string = 'google'): number {
  const db = getDb()
  const name = nextKeyName(db, provider)
  const result = db.prepare('INSERT INTO api_keys (name, credential_ref, fingerprint, provider) VALUES (?, ?, ?, ?)').run(name, '', credentialFingerprint(apiKey), provider)
  const id = result.lastInsertRowid as number
  const ref = `api-key-${id}`
  saveCredential(ref, apiKey)
  db.prepare('UPDATE api_keys SET credential_ref = ? WHERE id = ?').run(ref, id)
  return id
}

// Auto-name nameless keys as "Key N" (N = max existing numeric suffix + 1), scoped per provider.
function nextKeyName(db: Database.Database, provider: string = 'google'): string {
  const rows = db.prepare("SELECT name FROM api_keys WHERE provider = ? AND name LIKE 'Key %'").all(provider) as { name: string }[]
  let max = 0
  for (const r of rows) {
    const m = /^Key (\d+)$/.exec(r.name || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `Key ${max + 1}`
}

export function removeApiKey(id: number): void {
  const db = getDb()
  const row = db.prepare('SELECT credential_ref FROM api_keys WHERE id = ?').get(id) as any
  db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id)
  if (row?.credential_ref) deleteCredential(row.credential_ref)
}

export function updateApiKeyLastUsed(id: number): void {
  const db = getDb()
  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(id)
}

export function updateApiKeyTier(id: number, tier: 'free' | 'pro'): void {
  const db = getDb()
  db.prepare('UPDATE api_keys SET tier = ? WHERE id = ?').run(tier, id)
}

// ─── Custom OpenAI-compatible providers ─────────────────────────────────────

export interface CustomProviderModel { id: string; label: string }
export interface CustomProvider {
  id: number
  name: string
  baseUrl: string
  models: CustomProviderModel[]
  isActive: boolean
  createdAt: string
}
/** Same shape plus the resolved credential — never leaves the main process. */
export interface CustomProviderCredential extends CustomProvider {
  apiKey: string
}

function parseCustomModels(modelsJson: string): CustomProviderModel[] {
  try {
    const parsed = JSON.parse(modelsJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m: any) => m && typeof m.id === 'string' && m.id.trim())
      .map((m: any) => ({ id: String(m.id).trim(), label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : String(m.id).trim() }))
  } catch {
    return []
  }
}

function rowToCustomProvider(row: any): CustomProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    models: parseCustomModels(row.models_json),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  }
}

export function listCustomProviders(includeInactive = false): CustomProvider[] {
  const db = getDb()
  const rows = includeInactive
    ? db.prepare('SELECT * FROM custom_providers ORDER BY created_at ASC').all()
    : db.prepare('SELECT * FROM custom_providers WHERE is_active = 1 ORDER BY created_at ASC').all()
  return (rows as any[]).map(rowToCustomProvider)
}

export function listActiveCustomProviders(): CustomProvider[] {
  return listCustomProviders(false)
}

export function getCustomProviderCredential(id: number): CustomProviderCredential | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM custom_providers WHERE id = ? AND is_active = 1').get(id) as any
  if (!row) return null
  const apiKey = (row.credential_ref && getCredential(row.credential_ref)) || ''
  return { ...rowToCustomProvider(row), apiKey }
}

export function addCustomProvider(input: {
  name: string
  baseUrl: string
  apiKey?: string
  models: CustomProviderModel[]
}): number {
  const db = getDb()
  const result = db.prepare(
    'INSERT INTO custom_providers (name, base_url, credential_ref, models_json) VALUES (?, ?, ?, ?)',
  ).run(input.name.trim(), input.baseUrl.trim().replace(/\/+$/, ''), '', JSON.stringify(input.models))
  const id = result.lastInsertRowid as number
  if (input.apiKey?.trim()) {
    const ref = `custom-provider-${id}`
    saveCredential(ref, input.apiKey.trim())
    db.prepare('UPDATE custom_providers SET credential_ref = ? WHERE id = ?').run(ref, id)
  }
  logger.info('db', `added custom provider "${input.name}" (${input.baseUrl}) with ${input.models.length} model(s)`)
  return id
}

export function updateCustomProvider(id: number, patch: {
  name?: string
  baseUrl?: string
  /** Omit to keep the existing credential; empty string clears it. */
  apiKey?: string
  models?: CustomProviderModel[]
}): boolean {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM custom_providers WHERE id = ?').get(id) as any
  if (!existing) return false

  const name = patch.name?.trim() || existing.name
  const baseUrl = (patch.baseUrl?.trim().replace(/\/+$/, '')) || existing.base_url
  const modelsJson = patch.models ? JSON.stringify(patch.models) : existing.models_json

  let credentialRef: string | null = null
  if (patch.apiKey !== undefined) {
    if (patch.apiKey.trim()) {
      const ref = existing.credential_ref || `custom-provider-${id}`
      saveCredential(ref, patch.apiKey.trim())
      credentialRef = ref
    } else {
      if (existing.credential_ref) deleteCredential(existing.credential_ref)
      credentialRef = ''
    }
  }

  db.prepare(
    'UPDATE custom_providers SET name = ?, base_url = ?, models_json = ?' +
    (credentialRef !== null ? ', credential_ref = ?' : '') +
    ' WHERE id = ?',
  ).run(...(credentialRef !== null ? [name, baseUrl, modelsJson, credentialRef, id] : [name, baseUrl, modelsJson, id]))
  return true
}

export function removeCustomProvider(id: number): boolean {
  const db = getDb()
  const row = db.prepare('SELECT credential_ref FROM custom_providers WHERE id = ?').get(id) as any
  if (!row) return false
  db.prepare('UPDATE custom_providers SET is_active = 0 WHERE id = ?').run(id)
  if (row.credential_ref) deleteCredential(row.credential_ref)
  logger.info('db', `removed custom provider #${id}`)
  return true
}

/** Active-key count per api_keys provider family ('google'|'zhipu'|'openai'|'anthropic'). */
export function getActiveKeyCountForProvider(provider: string): number {
  return (getDb().prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = ? AND is_active = 1').get(provider) as any).count
}

export function getApiKeysByTier(tier: 'free' | 'pro', provider: string = 'google'): Array<{ id: number; name: string; api_key: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }> {
  const db = getDb()
  return (db.prepare('SELECT * FROM api_keys WHERE provider = ? AND tier = ? AND is_active = 1 ORDER BY created_at ASC').all(provider, tier) as any[])
    .map(row => ({ ...row, api_key: getCredential(row.credential_ref) || row.api_key || '' }))
}

export function getAvailableApiKeyForModel(model: string, excludeApiKeyIds?: number[]): { id: number; api_key: string } | null {
  const raw = model
  model = normalizeModelId(raw)
  if (raw !== model) logger.warn('db', `normalized legacy model id ${raw} -> ${model}`)
  // Custom endpoints keep their credential on their own row — resolved by
  // getCustomProviderCredential, never through api_keys rotation.
  if (parseModelRef(model).kind === 'custom') return null
  const db = getDb()
  const now = new Date().toISOString()
  const provider = apiKeyProviderName(model)

  let query = `
    SELECT id, credential_ref, api_key
    FROM api_keys
    WHERE is_active = 1
    AND provider = ?
    AND id NOT IN (
      SELECT api_key_id
      FROM model_exhaustion
      WHERE model = ?
      AND available_at > ?
      AND api_key_id IS NOT NULL
    )
  `
  const params: any[] = [provider, model, now]

  // Exclude already-tried keys (for rotation across keys on the same model).
  const triedIds = (excludeApiKeyIds || []).filter(id => id != null)
  if (triedIds.length > 0) {
    query += ` AND id NOT IN (${triedIds.map(() => '?').join(',')})`
    params.push(...triedIds)
  }

  query += ' ORDER BY last_used_at ASC NULLS LAST'

  const availableKeys = db.prepare(query).all(...params) as any[]

  logger.info('db', `getAvailableApiKeyForModel for ${model} (provider ${provider}): found ${availableKeys.length} keys (exclude: ${JSON.stringify(triedIds)})`)

  if (availableKeys.length === 0) {
    return null
  }
  
  return {
    id: availableKeys[0].id,
    api_key: getCredential(availableKeys[0].credential_ref) || availableKeys[0].api_key || '',
  }
}

export function markModelExhausted(model: string, apiKeyId: number | null): void {
  // Exhaustion rows key on canonical ids; legacy-keyed rows simply expire within the TTL.
  const raw = model
  model = normalizeModelId(raw)
  if (raw !== model) logger.warn('db', `normalized legacy model id ${raw} -> ${model}`)
  const db = getDb()
  const now = new Date()
  const availableAt = new Date(now.getTime() + 5 * 60 * 60 * 1000) // 5 hours from now
  
  db.prepare(`
    INSERT INTO model_exhaustion (model, api_key_id, exhausted_at, available_at)
    VALUES (?, ?, ?, ?)
  `).run(model, apiKeyId, now.toISOString(), availableAt.toISOString())
  
  const keyLabel = apiKeyId ? `API key ${apiKeyId}` : 'primary key'
  logger.info('db', `marked model ${model} as exhausted for ${keyLabel} until ${availableAt.toISOString()}`)
}

export function isModelExhaustedForAllKeys(model: string): boolean {
  const raw = model
  model = normalizeModelId(raw)
  if (raw !== model) logger.warn('db', `normalized legacy model id ${raw} -> ${model}`)
  // Custom endpoints have a single dedicated credential with no rotation pool,
  // so the all-keys-exhausted concept does not apply.
  if (parseModelRef(model).kind === 'custom') return false
  const db = getDb()
  const now = new Date().toISOString()
  const provider = apiKeyProviderName(model)

  // The primary key is synced into api_keys (see syncPrimaryKeyToApiKeys
  // + the startup migration), so activeKeysCount already includes it.
  const activeKeysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1 AND provider = ?').get(provider) as any
  const totalKeys = activeKeysCount.count
  if (totalKeys === 0) return false

  const exhaustedKeys = db.prepare(`
    SELECT COUNT(DISTINCT api_key_id) as count
    FROM model_exhaustion
    WHERE model = ?
    AND available_at > ?
    AND api_key_id IS NOT NULL
  `).get(model, now) as any

  return exhaustedKeys.count >= totalKeys
}

export function getModelExhaustionStatus(model: string): { exhausted: boolean; availableAt: string | null } {
  const raw = model
  model = normalizeModelId(raw)
  if (raw !== model) logger.warn('db', `normalized legacy model id ${raw} -> ${model}`)
  const db = getDb()
  const now = new Date().toISOString()
  
  if (!isModelExhaustedForAllKeys(model)) {
    return { exhausted: false, availableAt: null }
  }
  
  const record = db.prepare(`
    SELECT available_at 
    FROM model_exhaustion 
    WHERE model = ? 
    AND available_at > ?
    ORDER BY available_at DESC 
    LIMIT 1
  `).get(model, now) as any
  
  return { exhausted: true, availableAt: record?.available_at ?? null }
}
