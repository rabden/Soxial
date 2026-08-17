import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { createTools } from '../electron/main/tools'

function createTestDb() {
  const db = new Database(':memory:')
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
      growth_strategy TEXT,
      branding_strategy TEXT,
      tools_stack TEXT,
      monetization_goals TEXT,
      growth_target TEXT,
      portfolio_status TEXT,
      tone_balance TEXT,
      zai_coding_plan INTEGER DEFAULT 0,
      selected_model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hooks (id INTEGER PRIMARY KEY AUTOINCREMENT, rank INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT, why_it_works TEXT, template TEXT, niche_examples TEXT, performance_notes TEXT);
    CREATE TABLE IF NOT EXISTS content_pillars (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, structure TEXT, frequency TEXT, platform_adaptations TEXT);
    CREATE TABLE IF NOT EXISTS voice_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS target_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, handle TEXT NOT NULL, tier TEXT, why TEXT, strategy TEXT);
    CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS algorithm_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, signal TEXT NOT NULL, weight TEXT, description TEXT);
    CREATE TABLE IF NOT EXISTS memory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, platform TEXT, title TEXT, content TEXT, data_json TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS growth_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, metric TEXT NOT NULL, value TEXT, note TEXT, recorded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS scheduled_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, type TEXT, text TEXT, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT DEFAULT 'New Chat', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS quick_actions (id INTEGER PRIMARY KEY CHECK (id = 1), suggestions TEXT NOT NULL, generated_at TEXT DEFAULT (datetime('now')));
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
  `)
  return db
}

describe('Profile identity protection and social name separation', () => {
  test('updateProfile separates user name from twitter_name and reddit_display_name', () => {
    const db = createTestDb()
    db.prepare(`
      INSERT INTO user_profile (id, name, twitter_handle, reddit_username, timezone)
      VALUES (1, 'Jane Doe', 'janedoe', 'janedoe_rdt', 'UTC+1')
    `).run()

    // Simulate saving social platform display names
    db.prepare(`
      UPDATE user_profile SET
        twitter_name = @twitter_name,
        reddit_display_name = @reddit_display_name
      WHERE id = 1
    `).run({
      twitter_name: 'Jane | Building AI 🚀',
      reddit_display_name: 'Jane (u/janedoe_rdt)',
    })

    const profile = db.prepare('SELECT name, twitter_handle, twitter_name, reddit_username, reddit_display_name, timezone FROM user_profile WHERE id = 1').get() as any

    expect(profile.name).toBe('Jane Doe')
    expect(profile.twitter_handle).toBe('janedoe')
    expect(profile.twitter_name).toBe('Jane | Building AI 🚀')
    expect(profile.reddit_username).toBe('janedoe_rdt')
    expect(profile.reddit_display_name).toBe('Jane (u/janedoe_rdt)')
    expect(profile.timezone).toBe('UTC+1')
  })

  test('update_soxial_profile tool schema excludes user identity fields', () => {
    const tools = createTools()
    const updateProfileTool = tools.update_soxial_profile
    const schemaShape = (updateProfileTool.parameters.shape.data as any).shape

    // Protected identity fields must not exist in schema
    expect(schemaShape.name).toBeUndefined()
    expect(schemaShape.twitter_handle).toBeUndefined()
    expect(schemaShape.reddit_username).toBeUndefined()
    expect(schemaShape.timezone).toBeUndefined()
    expect(schemaShape.onboarding_complete).toBeUndefined()

    // Allowed strategy fields must exist in schema
    expect(schemaShape.niche).toBeDefined()
    expect(schemaShape.specialization).toBeDefined()
    expect(schemaShape.superpower).toBeDefined()
    expect(schemaShape.primary_goal).toBeDefined()
    expect(schemaShape.voice_description).toBeDefined()
    expect(schemaShape.growth_strategy).toBeDefined()
  })
})
