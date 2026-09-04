import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../electron/main/db-migrations'

describe('migration-managed operational indexes', () => {
  it('creates indexes for the high-frequency query shapes', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT);
      CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, updated_at TEXT);
      CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY, status TEXT, scheduled_time TEXT);
      CREATE TABLE social_content (id INTEGER PRIMARY KEY, author_handle TEXT, subreddit TEXT, posted_at TEXT);
      CREATE TABLE model_exhaustion (id INTEGER PRIMARY KEY, model TEXT, api_key_id INTEGER, available_at TEXT);
      CREATE TABLE api_keys (id INTEGER PRIMARY KEY, provider TEXT, tier TEXT, is_active INTEGER, created_at TEXT);
    `)

    runMigrations(db)

    const indexes = new Set((db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>).map(row => row.name))

    expect(Array.from(indexes)).toEqual(expect.arrayContaining([
      'idx_chat_messages_session_created',
      'idx_chat_sessions_updated',
      'idx_scheduled_posts_status_time',
      'idx_social_content_author_posted',
      'idx_social_content_subreddit_posted',
      'idx_model_exhaustion_model_key_available',
      'idx_api_keys_provider_tier_active',
    ]))

    const planFor = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
      .map(row => row.detail)
      .join(' ')
    expect(planFor('SELECT * FROM chat_messages WHERE session_id = 1 ORDER BY created_at, id')).toContain('idx_chat_messages_session_created')
    expect(planFor("SELECT * FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_time >= '2026-01-01'")).toContain('idx_scheduled_posts_status_time')
    expect(planFor("SELECT * FROM social_content WHERE author_handle = 'alice' ORDER BY posted_at DESC")).toContain('idx_social_content_author_posted')
    expect(planFor("SELECT * FROM model_exhaustion WHERE model = 'gemini' AND api_key_id = 1 AND available_at > '2026-01-01'")).toContain('idx_model_exhaustion_model_key_available')
    expect(planFor("SELECT * FROM api_keys WHERE provider = 'google' AND tier = 'free' AND is_active = 1")).toContain('idx_api_keys_provider_tier_active')
    expect((db.pragma('table_info(onboarding_runs)') as Array<{ name: string }>).map(column => column.name))
      .toContain('checkpoint_backup_json')
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    db.close()
  })
})
