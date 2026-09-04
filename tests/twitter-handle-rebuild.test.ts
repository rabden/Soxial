import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { applyTwitterHandleRebuild, countActiveTwitterScheduledPosts, type TwitterHandleRebuildCutover } from '../electron/main/db'
import { normalizeTwitterHandle } from '../electron/main/twitter-handle'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE user_profile (
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
      branding_strategy TEXT,
      growth_strategy TEXT
    );
    CREATE TABLE hooks (id INTEGER PRIMARY KEY AUTOINCREMENT, rank INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT, why_it_works TEXT, template TEXT, niche_examples TEXT, performance_notes TEXT);
    CREATE TABLE content_pillars (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, structure TEXT, frequency TEXT, platform_adaptations TEXT);
    CREATE TABLE voice_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE target_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, handle TEXT NOT NULL, tier TEXT, why TEXT, strategy TEXT);
    CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE algorithm_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, signal TEXT NOT NULL, weight TEXT, description TEXT);
    CREATE TABLE memory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, platform TEXT, title TEXT, content TEXT, data_json TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE growth_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, metric TEXT NOT NULL, value TEXT, note TEXT, recorded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, type TEXT, text TEXT, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT DEFAULT 'New Chat', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE quick_actions (id INTEGER PRIMARY KEY CHECK (id = 1), suggestions TEXT NOT NULL, generated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE social_content (
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
  `)
  seedDb(db)
  return db
}

function seedDb(db: Database.Database) {
  db.prepare(`INSERT INTO user_profile (
    id, name, twitter_handle, reddit_username, timezone, has_premium, niche, specialization, superpower, primary_goal, target_audience,
    voice_description, avoid_words, brand_primary_color, brand_secondary_color, brand_accent_color, style_preset, branding_strategy, growth_strategy
  ) VALUES (1, 'User', 'old_x', 'reddit_user', 'Europe/Warsaw', 1, 'old niche', 'old specialization', 'teaching', 'grow', 'builders', 'old voice', 'jargon', '#111111', '#222222', '#333333', 'Sharp', 'brand stable', 'old strategy')`).run()
  db.prepare("INSERT INTO hooks (rank, category, name, description) VALUES (1, 'old', 'old hook', 'old desc')").run()
  db.prepare("INSERT INTO content_pillars (name, description) VALUES ('old pillar', 'old pillar desc')").run()
  db.prepare("INSERT INTO voice_rules (type, content) VALUES ('do', 'old voice rule')").run()
  db.prepare("INSERT INTO target_accounts (platform, handle, tier, why, strategy) VALUES ('twitter', 'oldtarget', 'a', 'old why', 'old strategy')").run()
  db.prepare("INSERT INTO replies (platform, category, text) VALUES ('twitter', 'old', 'old reply')").run()
  db.prepare("INSERT INTO algorithm_rules (platform, signal, weight, description) VALUES ('twitter', 'recency', 'high', 'stable algo')").run()
  db.prepare("INSERT INTO memory_entries (type, platform, title, content, data_json, created_at) VALUES ('fact', 'twitter', 'memory', 'keep exact', '{\"a\":1}', '2026-01-01 00:00:00')").run()
  db.prepare("INSERT INTO growth_milestones (platform, metric, value, note, recorded_at) VALUES ('twitter', 'followers', '10', 'keep exact', '2026-01-02 00:00:00')").run()
  db.prepare("INSERT INTO scheduled_posts (platform, type, text, status) VALUES ('twitter', 'post', 'active twitter draft', 'draft')").run()
  db.prepare("INSERT INTO scheduled_posts (platform, type, text, status) VALUES ('twitter', 'post', 'active twitter scheduled', 'scheduled')").run()
  db.prepare("INSERT INTO scheduled_posts (platform, type, text, status) VALUES ('reddit', 'post', 'reddit draft', 'draft')").run()
  db.prepare("INSERT INTO chat_sessions (title) VALUES ('chat')").run()
  db.prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (1, 'user', 'hello')").run()
  db.prepare("INSERT INTO quick_actions (id, suggestions, generated_at) VALUES (1, '[\"old action\"]', '2026-01-03 00:00:00')").run()
  db.prepare("INSERT INTO social_content (platform, content_type, external_id, author_handle, subreddit, title, text, data_json) VALUES ('twitter', 'post', 'old-tweet', 'old_x', NULL, NULL, 'old tweet', '{\"old\":true}')").run()
  db.prepare("INSERT INTO social_content (platform, content_type, external_id, author_handle, subreddit, title, text, data_json) VALUES ('reddit', 'post', 'old-reddit', NULL, 'saas', 'reddit title', 'reddit post', '{\"reddit\":true}')").run()
}

function payload(overrides: Partial<TwitterHandleRebuildCutover> = {}): TwitterHandleRebuildCutover {
  return {
    twitterHandle: 'new_x',
    profile: {
      niche: 'new niche',
      specialization: 'new specialization',
      voice_description: 'new voice',
      avoid_words: 'fluff',
      branding_strategy: 'new brand',
      growth_strategy: 'new strategy',
    },
    hooks: [{ rank: 1, category: 'new', name: 'new hook', description: 'new desc' }],
    pillars: [{ name: 'new pillar', description: 'new pillar desc' }],
    voiceRules: [{ type: 'do', content: 'new voice rule' }],
    targetAccounts: [{ platform: 'twitter', handle: 'newtarget', tier: 'a', why: 'new why', strategy: 'new strategy' }],
    replies: [{ platform: 'twitter', category: 'new', text: 'new reply' }],
    twitterSocialContent: [{ platform: 'twitter', content_type: 'post', external_id: 'new-tweet', author_handle: 'new_x', data_json: '{"new":true}', text: 'new tweet' }],
    ...overrides,
  }
}

function rows(db: Database.Database, table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
}

describe('normalizeTwitterHandle', () => {
  test('normalizes canonical equivalents and rejects irrelevant changes', () => {
    expect(normalizeTwitterHandle(' @Soxial_app ')).toBe('Soxial_app')
    expect(normalizeTwitterHandle('Soxial_app')).toBe('Soxial_app')
    expect(() => normalizeTwitterHandle('https://x.com/Soxial_app')).toThrow('Enter a valid X handle')
    expect(() => normalizeTwitterHandle('too_long_for_x_handles')).toThrow('Enter a valid X handle')
  })
})

describe('applyTwitterHandleRebuild', () => {
  test('replaces derived X data, archives active X posts, and preserves historical/stable data', () => {
    const db = createDb()
    const memoryBefore = JSON.stringify(rows(db, 'memory_entries'))
    const milestonesBefore = JSON.stringify(rows(db, 'growth_milestones'))
    const algorithmBefore = JSON.stringify(rows(db, 'algorithm_rules'))
    const chatsBefore = JSON.stringify(rows(db, 'chat_sessions')) + JSON.stringify(rows(db, 'chat_messages'))

    const result = applyTwitterHandleRebuild(payload(), { db, expectedActiveTwitterScheduledPostCount: 2 })

    expect(result.archivedCount).toBe(2)
    expect(countActiveTwitterScheduledPosts(db)).toBe(0)
    expect(rows(db, 'hooks')).toMatchObject([{ name: 'new hook' }])
    expect(rows(db, 'content_pillars')).toMatchObject([{ name: 'new pillar' }])
    expect(rows(db, 'voice_rules')).toMatchObject([{ content: 'new voice rule' }])
    expect(rows(db, 'target_accounts')).toMatchObject([{ handle: 'newtarget' }])
    expect(rows(db, 'replies')).toMatchObject([{ text: 'new reply' }])
    expect(db.prepare("SELECT external_id FROM social_content WHERE platform = 'twitter'").all()).toEqual([{ external_id: 'new-tweet' }])
    expect(db.prepare("SELECT external_id FROM social_content WHERE platform = 'reddit'").all()).toEqual([{ external_id: 'old-reddit' }])
    expect(db.prepare("SELECT status FROM scheduled_posts WHERE platform = 'twitter' ORDER BY id").all()).toEqual([{ status: 'archived' }, { status: 'archived' }])
    expect(db.prepare("SELECT status FROM scheduled_posts WHERE platform = 'reddit'").all()).toEqual([{ status: 'draft' }])
    expect(db.prepare('SELECT name, reddit_username, timezone, has_premium, superpower, primary_goal, target_audience, brand_primary_color, brand_secondary_color, brand_accent_color, style_preset FROM user_profile WHERE id = 1').get()).toEqual({
      name: 'User', reddit_username: 'reddit_user', timezone: 'Europe/Warsaw', has_premium: 1, superpower: 'teaching', primary_goal: 'grow', target_audience: 'builders', brand_primary_color: '#111111', brand_secondary_color: '#222222', brand_accent_color: '#333333', style_preset: 'Sharp',
    })
    expect(JSON.stringify(rows(db, 'memory_entries'))).toBe(memoryBefore)
    expect(JSON.stringify(rows(db, 'growth_milestones'))).toBe(milestonesBefore)
    expect(JSON.stringify(rows(db, 'algorithm_rules'))).toBe(algorithmBefore)
    expect(JSON.stringify(rows(db, 'chat_sessions')) + JSON.stringify(rows(db, 'chat_messages'))).toBe(chatsBefore)
    expect(rows(db, 'quick_actions')).toEqual([])
  })

  test('rolls back all prior state when insertion fails', () => {
    const db = createDb()
    const before = [
      'user_profile', 'hooks', 'content_pillars', 'voice_rules', 'target_accounts', 'replies', 'algorithm_rules',
      'memory_entries', 'growth_milestones', 'scheduled_posts', 'chat_sessions', 'chat_messages', 'quick_actions', 'social_content',
    ].map(table => [table, JSON.stringify(rows(db, table))])

    expect(() => applyTwitterHandleRebuild(payload({
      twitterSocialContent: [
        { platform: 'twitter', content_type: 'post', external_id: 'duplicate', author_handle: 'new_x', data_json: '{"n":1}' },
        { platform: 'twitter', content_type: 'post', external_id: 'duplicate', author_handle: 'new_x', data_json: '{"n":2}' },
      ],
    }), { db, expectedActiveTwitterScheduledPostCount: 2 })).toThrow()

    for (const [table, snapshot] of before) {
      expect(JSON.stringify(rows(db, table))).toBe(snapshot)
    }
  })
})
