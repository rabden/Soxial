import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { seedDatabase } from './seed'
import { logger } from './log'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'soxial.db')
  logger.info('db', `opening database: ${dbPath}`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initSchema(db)
  seedDatabase(db)

  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      twitter_handle TEXT,
      reddit_username TEXT,
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
      api_key TEXT NOT NULL,
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
  `)

  // Migration: add context_summary if missing
  const cols = db.pragma('table_info(chat_sessions)') as any[]
  if (!cols.some((c: any) => c.name === 'context_summary')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN context_summary TEXT')
  }

  // Migration: persist chat attachments for image-augmented messages
  const messageCols = db.pragma('table_info(chat_messages)') as any[]
  if (!messageCols.some((c: any) => c.name === 'attachments_json')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT')
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

  const MISSING_COLS = ['tools_stack', 'monetization_goals', 'growth_target', 'portfolio_status', 'tone_balance', 'branding_strategy']
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
  const apiKeyCols = db.pragma('table_info(api_keys)') as any[]
  if (!apiKeyCols.some((c: any) => c.name === 'tier')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN tier TEXT DEFAULT \'unknown\'')
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

export function getChatSessionSteps(sessionId: number): { steps: any[]; userCount: number } | null {
  const row = getDb().prepare('SELECT steps_json, steps_user_count FROM chat_sessions WHERE id = ?').get(sessionId) as any
  if (!row || !row.steps_json) return null
  try {
    return { steps: JSON.parse(row.steps_json), userCount: row.steps_user_count || 0 }
  } catch {
    return null
  }
}

export function updateChatSessionSteps(sessionId: number, steps: any[], userCount: number) {
  getDb().prepare('UPDATE chat_sessions SET steps_json = ?, steps_user_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(steps), userCount, sessionId)
}

export function getProfile() {
  return getDb().prepare('SELECT * FROM user_profile WHERE id = 1').get() as any
}

export function syncPrimaryKeyToApiKeys(apiKey: string, provider: 'google' | 'zhipu' = 'google'): void {
  const db = getDb()

  // If the exact key already exists and is active, just rename it to Primary
  const existing = db.prepare('SELECT id FROM api_keys WHERE api_key = ? AND provider = ? AND is_active = 1').get(apiKey, provider) as any
  if (existing) {
    db.prepare("UPDATE api_keys SET name = 'Primary' WHERE id = ?").run(existing.id)
    return
  }

  // Key changed: update the existing 'Primary' row for this provider in-place
  // (avoids duplicate active rows; resets tier since the new key may differ in capability)
  const currentPrimary = db.prepare("SELECT id FROM api_keys WHERE name = 'Primary' AND provider = ? AND is_active = 1").get(provider) as any
  if (currentPrimary) {
    db.prepare("UPDATE api_keys SET api_key = ?, tier = 'unknown' WHERE id = ?").run(apiKey, currentPrimary.id)
    return
  }

  // No existing primary at all: insert new
  db.prepare("INSERT INTO api_keys (name, api_key, provider) VALUES ('Primary', ?, ?)").run(apiKey, provider)
}

export function updateProfile(data: Record<string, any>) {
  const db = getDb()
  const existing = db.prepare('SELECT COUNT(*) as c FROM user_profile WHERE id = 1').get() as any
  if (existing.c === 0) {
    db.prepare('INSERT INTO user_profile (id) VALUES (1)').run()
  }
  const keys = Object.keys(data).filter(k => data[k] !== undefined)
  const sets = keys.map(k => `${k} = @${k}`).join(', ')
  if (sets) {
    db.prepare(`UPDATE user_profile SET ${sets} WHERE id = 1`).run(data)
  }
  if (data.gemini_api_key) {
    syncPrimaryKeyToApiKeys(data.gemini_api_key, 'google')
  }
  if (data.zai_api_key) {
    syncPrimaryKeyToApiKeys(data.zai_api_key, 'zhipu')
  }
  return getProfile()
}

export function queryAll(table: string, where?: string, params?: any[]) {
  const sql = where ? `SELECT * FROM ${table} WHERE ${where}` : `SELECT * FROM ${table}`
  return getDb().prepare(sql).all(...(params || []))
}

export function insertRow(table: string, data: Record<string, any>) {
  const keys = Object.keys(data)
  const placeholders = keys.map(k => `@${k}`).join(', ')
  const columns = keys.join(', ')
  const result = getDb().prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).run(data)
  return result.lastInsertRowid
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

export function getChatSessionContextSummary(sessionId: number): string | null {
  const row = getDb().prepare('SELECT context_summary FROM chat_sessions WHERE id = ?').get(sessionId) as any
  return row?.context_summary || null
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
      niche = @niche,
      specialization = @specialization,
      voice_description = @voice_description,
      avoid_words = @avoid_words,
      branding_strategy = @branding_strategy,
      growth_strategy = @growth_strategy
      WHERE id = 1`).run({
        twitterHandle: payload.twitterHandle,
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

// API Tier Management
export function getApiTier(): { tier: string; detected_at: string; last_verified_at?: string } {
  const db = getDb()
  const row = db.prepare('SELECT * FROM api_tier_info WHERE id = 1').get() as any
  if (!row) {
    db.prepare('INSERT INTO api_tier_info (id, tier) VALUES (1, ?)').run('free')
    return { tier: 'free', detected_at: new Date().toISOString() }
  }
  return row
}

export function setApiTier(tier: 'free' | 'pro') {
  const db = getDb()
  db.prepare('UPDATE api_tier_info SET tier = ?, last_verified_at = datetime(\'now\') WHERE id = 1').run(tier)
  return getApiTier()
}

export function getAvailableModels(tier?: string): string[] {
  const db = getDb()
  const models: string[] = []
  const profile = getProfile()

  // 1. Evaluate Google models
  const googleKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'google\' AND is_active = 1').get() as any
  if (googleKeys.count > 0) {
    const proGoogleKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'google\' AND tier = \'pro\' AND is_active = 1').get() as any
    if (proGoogleKeys.count > 0) {
      models.push('gemini-3.6-flash', 'gemini-3.1-pro', 'gemini-3.5-flash-lite')
    } else {
      models.push('gemini-3.5-flash-lite', 'gemini-3.6-flash')
    }
  }

  // 2. Evaluate Z.AI (Zhipu) models
  const zhipuKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'zhipu\' AND is_active = 1').get() as any
  if (zhipuKeys.count > 0) {
    if (profile?.zai_coding_plan) {
      // Coding plan: always pro tier, only supports glm-5.2 + glm-5-turbo (no flash models)
      models.push('glm-5.2', 'glm-5-turbo')
    } else {
      const proZhipuKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider = \'zhipu\' AND tier = \'pro\' AND is_active = 1').get() as any
      if (proZhipuKeys.count > 0) {
        models.push('glm-5.2', 'glm-5-turbo', 'glm-4.7-flash', 'glm-4.5-flash')
      } else {
        models.push('glm-4.7-flash', 'glm-4.5-flash')
      }
    }
  }

  return models
}

export function getDefaultModel(tier?: string): string {
  const models = getAvailableModels(tier)
  if (models.includes('gemini-3.6-flash')) return 'gemini-3.6-flash'
  if (models.includes('glm-4.7-flash')) return 'glm-4.7-flash'
  return models[0] || 'gemini-3.5-flash-lite'
}

export function getSelectedModel(): string | null {
  const row = getDb().prepare('SELECT selected_model FROM user_profile WHERE id = 1').get() as any
  return row?.selected_model || null
}

export function setSelectedModel(model: string): void {
  getDb().prepare('UPDATE user_profile SET selected_model = ? WHERE id = 1').run(model)
}

// ─── API Key Management ───────────────────────────────────────────

export function getApiKeys(provider: string = 'google'): Array<{ id: number; name: string; api_key: string; provider: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }> {
  const db = getDb()
  return db.prepare('SELECT * FROM api_keys WHERE provider = ? AND is_active = 1 ORDER BY created_at ASC').all(provider) as any[]
}

export function addApiKey(apiKey: string, provider: string = 'google'): number {
  const db = getDb()
  const name = nextKeyName(db, provider)
  const result = db.prepare('INSERT INTO api_keys (name, api_key, provider) VALUES (?, ?, ?)').run(name, apiKey, provider)
  return result.lastInsertRowid as number
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
  db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id)
}

export function updateApiKeyLastUsed(id: number): void {
  const db = getDb()
  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(id)
}

export function updateApiKeyTier(id: number, tier: 'free' | 'pro'): void {
  const db = getDb()
  db.prepare('UPDATE api_keys SET tier = ? WHERE id = ?').run(tier, id)
}

export function getApiKeysByTier(tier: 'free' | 'pro', provider: string = 'google'): Array<{ id: number; name: string; api_key: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }> {
  const db = getDb()
  return db.prepare('SELECT * FROM api_keys WHERE provider = ? AND tier = ? AND is_active = 1 ORDER BY created_at ASC').all(provider, tier) as any[]
}

export function getAvailableApiKeyForModel(model: string, requiredTier?: 'free' | 'pro', excludeApiKeyIds?: number[]): { id: number; api_key: string } | null {
  const db = getDb()
  const now = new Date().toISOString()
  const provider = model.startsWith('glm') ? 'zhipu' : 'google'

  // Determine required tier based on model
  let tierFilter: string | null | undefined = requiredTier
  if (!tierFilter) {
    tierFilter = (model === 'gemini-3.1-pro' || model === 'glm-5.2' || model === 'glm-5-turbo') ? 'pro' : null
  }

  // Build query with optional tier filter
  let query = `
    SELECT id, api_key
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

  if (tierFilter) {
    query += ' AND tier = ?'
    params.push(tierFilter)
  }

  // Exclude already-tried keys (for rotation across keys on the same model).
  const triedIds = (excludeApiKeyIds || []).filter(id => id != null)
  if (triedIds.length > 0) {
    query += ` AND id NOT IN (${triedIds.map(() => '?').join(',')})`
    params.push(...triedIds)
  }

  query += ' ORDER BY last_used_at ASC NULLS LAST'

  const availableKeys = db.prepare(query).all(...params) as any[]

  logger.info('db', `getAvailableApiKeyForModel for ${model} (provider ${provider}): found ${availableKeys.length} keys (exclude: ${JSON.stringify(triedIds)}, tier: ${tierFilter})`)

  if (availableKeys.length === 0) {
    return null
  }
  
  return { id: availableKeys[0].id, api_key: availableKeys[0].api_key }
}

export function markModelExhausted(model: string, apiKeyId: number | null): void {
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

export function isModelExhaustedForAllKeys(model: string, requiredTier?: 'free' | 'pro'): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const provider = model.startsWith('glm') ? 'zhipu' : 'google'
  
  // Determine required tier based on model
  let tierFilter: string | null | undefined = requiredTier
  if (!tierFilter) {
    tierFilter = (model === 'gemini-3.1-pro' || model === 'glm-5.2' || model === 'glm-5-turbo') ? 'pro' : null
  }
  
  // If tier is specified, only check keys of that tier for the relevant provider
  if (tierFilter) {
    const tierKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1 AND provider = ? AND tier = ?').get(provider, tierFilter) as any
    if (tierKeys.count === 0) return false
    
    const exhaustedTierKeys = db.prepare(`
      SELECT COUNT(DISTINCT api_key_id) as count 
      FROM model_exhaustion 
      WHERE model = ? 
      AND available_at > ?
      AND api_key_id IS NOT NULL
      AND api_key_id IN (SELECT id FROM api_keys WHERE tier = ? AND provider = ? AND is_active = 1)
    `).get(model, now, tierFilter, provider) as any
    
    return exhaustedTierKeys.count >= tierKeys.count
  }
  
  // Non-tier path: the primary key is synced into api_keys (see syncPrimaryKeyToApiKeys
  // + the startup migration), so activeKeysCount already includes it — don't add it again.
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
