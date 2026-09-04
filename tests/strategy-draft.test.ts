import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { runMigrations } from '../electron/main/db-migrations'
import {
  createEmptyDraftDocument,
  ensureDraftForRun,
  getBaseSnapshot,
  getDraftRow,
  getMergedGrowthStrategy,
  parseDraftDocument,
  restoreOutOfScopeMutations,
  setDraftStatus,
  updateDraft,
} from '../electron/main/strategy-draft'
import { createDraftScopedTools } from '../electron/main/draft-tools'

function createDb() {
  const db = new Database(':memory:')
  // Tables required by migrations 2-6 index targets before runMigrations runs.
  db.exec(`
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT);
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, updated_at TEXT);
    CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY, status TEXT, scheduled_time TEXT);
    CREATE TABLE social_content (id INTEGER PRIMARY KEY, author_handle TEXT, subreddit TEXT, posted_at TEXT);
    CREATE TABLE model_exhaustion (id INTEGER PRIMARY KEY, model TEXT, api_key_id INTEGER, available_at TEXT);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY, provider TEXT, tier TEXT, is_active INTEGER, created_at TEXT);
    CREATE TABLE user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT, twitter_handle TEXT, reddit_username TEXT, timezone TEXT,
      growth_strategy TEXT, voice_description TEXT
    );
    CREATE TABLE hooks (id INTEGER PRIMARY KEY AUTOINCREMENT, rank INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT, why_it_works TEXT, template TEXT, niche_examples TEXT, performance_notes TEXT);
    CREATE TABLE content_pillars (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, structure TEXT, frequency TEXT, platform_adaptations TEXT);
    CREATE TABLE voice_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL, UNIQUE(type, content));
    CREATE TABLE target_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, handle TEXT NOT NULL, tier TEXT, why TEXT, strategy TEXT, UNIQUE(platform, handle));
    CREATE TABLE algorithm_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, signal TEXT NOT NULL, weight TEXT, description TEXT, UNIQUE(platform, signal));
    CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE memory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, platform TEXT, title TEXT, content TEXT, data_json TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE growth_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, metric TEXT NOT NULL, value TEXT, note TEXT, recorded_at TEXT DEFAULT (datetime('now')));
  `)
  runMigrations(db)

  // Seed "existing" user strategy + seeded defaults, like a real pre-onboarding DB.
  db.prepare(`INSERT INTO user_profile (id, name, twitter_handle, reddit_username, timezone, growth_strategy)
              VALUES (1, 'Jane', 'janedoe', 'jane_rdt', 'UTC+1', 'Old user-written strategy.')`).run()
  db.prepare(`INSERT INTO hooks (rank, category, name, description) VALUES (1, 'showcase', 'Seeded Hook', 'default')`).run()
  db.prepare(`INSERT INTO content_pillars (name, description) VALUES ('Seeded Pillar', 'default')`).run()
  db.prepare(`INSERT INTO voice_rules (type, content) VALUES ('banned_phrase', 'synergy')`).run()
  return db
}

/** Minimal stand-in for the capability-filtered tool map; the adapter only
 *  dispatches on names and inherits description/parameters untouched. */
function stubTool(): any {
  return { description: 'stub', parameters: {}, execute: async () => ({}) }
}

function draftTools(db: Database.Database, runId = 'run_1') {
  const base: Record<string, any> = {}
  for (const name of [
    'read_hooks', 'read_voice_rules', 'read_replies', 'read_algorithm', 'read_memory',
    'read_pillars', 'read_targets', 'save_reply', 'save_memory', 'save_milestone',
    'save_pillar', 'save_target', 'save_voice_rule', 'save_hook', 'save_algorithm_rule',
    'delete_voice_rules', 'delete_hooks', 'delete_pillars', 'delete_targets',
    'delete_algorithm_rules', 'update_soxial_profile', 'schedule_post', 'twitter_post',
  ]) base[name] = stubTool()
  return createDraftScopedTools(base, db, runId)
}

function activeRowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n
}

describe('migration 007', () => {
  test('creates onboarding_strategy_drafts with status check and index', () => {
    const db = createDb()
    const columns = (db.pragma('table_info(onboarding_strategy_drafts)') as Array<{ name: string }>).map(c => c.name)
    expect(columns).toEqual(expect.arrayContaining(['run_id', 'version', 'status', 'base_snapshot_json', 'draft_json', 'committed_at']))

    expect(() =>
      db.prepare(`INSERT INTO onboarding_strategy_drafts (run_id, status, base_snapshot_json, draft_json) VALUES ('r', 'bogus', '{}', '{}')`).run(),
    ).toThrow()

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='onboarding_strategy_drafts'`).all() as any[]
    expect(indexes.some(i => i.name === 'idx_strategy_drafts_status_updated')).toBe(true)
    db.close()
  })
})

describe('draft repository', () => {
  test('ensureDraftForRun snapshots existing user strategy verbatim and is idempotent', () => {
    const db = createDb()
    const row = ensureDraftForRun(db, 'run_1')
    const snap = getBaseSnapshot(row)
    expect(snap.profile.growth_strategy).toBe('Old user-written strategy.')
    expect(snap.hooks).toHaveLength(1)
    expect((snap.hooks[0] as any).name).toBe('Seeded Hook')

    // Second call must not clobber or duplicate.
    const again = ensureDraftForRun(db, 'run_1')
    expect(again.version).toBe(row.version)
    expect(JSON.parse(again.draft_json)).toEqual(JSON.parse(row.draft_json))
    db.close()
  })

  test('updates bump version; stale expectedVersion loses; terminal drafts immutable', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')

    expect(updateDraft(db, 'run_1', null, doc => { doc.pillars.push({ name: 'P1', description: 'd' }) })).toBe(true)
    let row = getDraftRow(db, 'run_1')!
    expect(row.version).toBe(2)

    // Stale writer using version 1 must be rejected.
    expect(updateDraft(db, 'run_1', 1, doc => { doc.pillars.push({ name: 'P2', description: 'd' }) })).toBe(false)
    expect(parseDraftDocument(getDraftRow(db, 'run_1')!).pillars).toHaveLength(1)

    setDraftStatus(db, 'run_1', 'review')
    expect(setDraftStatus(db, 'run_1', 'review')).toBe(false) // review → review not allowed
    expect(setDraftStatus(db, 'run_1', 'committed')).toBe(true)
    expect(updateDraft(db, 'run_1', null, doc => { doc.pillars.push({ name: 'P3', description: 'd' }) })).toBe(false)
    expect(parseDraftDocument(getDraftRow(db, 'run_1')!).pillars).toHaveLength(1)
    db.close()
  })

  test('secret-shaped keys are redacted in persisted JSON', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    updateDraft(db, 'run_1', null, doc => {
      doc.pillars.push({ name: 'Sneaky', description: 'x' })
      ;(doc.pillars[0] as any).gemini_api_key = 'sk-leak'
      doc.memories.push({ type: 'audience', title: 't', content: 'c', cookie: 'session=xyz' } as any)
    })
    const raw = getDraftRow(db, 'run_1')!.draft_json
    expect(raw).not.toContain('sk-leak')
    expect(raw).not.toContain('session=xyz')
    expect(raw).toContain('[redacted]')
    db.close()
  })

  test('getMergedGrowthStrategy prefers the draft over the profile', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    expect(getMergedGrowthStrategy(db, 'run_1')).toBe('Old user-written strategy.')
    updateDraft(db, 'run_1', null, doc => { doc.profileStrategyFields.growth_strategy = 'New draft strategy.' })
    expect(getMergedGrowthStrategy(db, 'run_1')).toBe('New draft strategy.')
    db.close()
  })
})

describe('draft-scoped tools', () => {
  test('writes land in the draft only; active tables stay byte-identical', async () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    const tools = draftTools(db)

    const before = {
      hooks: db.prepare('SELECT * FROM hooks ORDER BY id').all(),
      pillars: db.prepare('SELECT * FROM content_pillars ORDER BY id').all(),
      memory: db.prepare('SELECT * FROM memory_entries ORDER BY id').all(),
    }

    await tools.save_hook.execute({ items: [{ rank: 2, category: 'community', name: 'Draft Hook', description: 'mine' }] })
    await tools.update_soxial_profile.execute({ data: { growth_strategy: 'Fresh strategy.', name: 'Evil', twitter_handle: 'hacked' } })

    expect(activeRowCount(db, 'hooks')).toBe(before.hooks.length)
    expect(db.prepare('SELECT * FROM hooks ORDER BY id').all()).toEqual(before.hooks)
    expect(activeRowCount(db, 'memory_entries')).toBe(before.memory.length)
    expect(db.prepare('SELECT growth_strategy FROM user_profile WHERE id = 1').get()).toEqual({ growth_strategy: 'Old user-written strategy.' })
    void before.pillars

    const doc = parseDraftDocument(getDraftRow(db, 'run_1')!)
    expect(doc.hooks.map(h => h.name)).toContain('Draft Hook')
    expect(doc.profileStrategyFields.growth_strategy).toBe('Fresh strategy.')
    // Identity fields never enter the document.
    expect(Object.keys(doc.profileStrategyFields)).not.toContain('name')
    expect(Object.keys(doc.profileStrategyFields)).not.toContain('twitter_handle')
    db.close()
  })

  test('merged reads include base ⊕ draft with upsert precedence, deletions last', async () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    const tools = draftTools(db)

    // Upsert over the seeded hook by name.
    await tools.save_hook.execute({ items: [{ rank: 9, category: 'showcase', name: 'Seeded Hook', description: 'personalised' }] })
    await tools.delete_hooks.execute({ by_name: ['Seeded Hook'] })

    // Deletion applies last, so it wins over the upsert.
    const rowsAfterDeleteOnly = await tools.read_hooks.execute({})
    expect(rowsAfterDeleteOnly.map((r: any) => r.name)).not.toContain('Seeded Hook')

    await tools.delete_hooks.execute({ by_name: ['__nonexistent__'] }) // no-op delete
    const freshHook = { rank: 2, category: 'community', name: 'Fresh Hook', description: 'new' }
    await tools.save_hook.execute({ items: [freshHook] })
    const rows = await tools.read_hooks.execute({})
    expect(rows.map((r: any) => r.name)).toEqual(['Fresh Hook'])

    // Active table still has its original row untouched.
    expect(db.prepare('SELECT description FROM hooks').all()).toEqual([{ description: 'default' }])
    db.close()
  })

  test('voice rule dedup mirrors production semantics across base and draft', async () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    const tools = draftTools(db)

    const result = await tools.save_voice_rule.execute({
      items: [
        { type: 'banned_phrase', content: 'synergy' },   // exists in ACTIVE table
        { type: 'banned_phrase', content: 'leverage' },  // new
      ],
    })
    expect(result.saved).toBe(1)
    expect(result.skipped).toBe(1)

    // Merged read shows both rules exactly once each.
    const rows = await tools.read_voice_rules.execute({})
    expect(rows.filter((r: any) => r.content === 'synergy')).toHaveLength(1)
    expect(rows.filter((r: any) => r.content === 'leverage')).toHaveLength(1)
    // Active table unchanged.
    expect(activeRowCount(db, 'voice_rules')).toBe(1)
    db.close()
  })

  test('non-strategy tools pass through untouched', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    const base = { schedule_post: stubTool(), twitter_post: stubTool() }
    const tools = createDraftScopedTools(base, db, 'run_1')
    expect(tools.schedule_post).toBe(base.schedule_post)
    expect(tools.twitter_post).toBe(base.twitter_post)
    db.close()
  })

  test('adapter results keep readiness artifact accounting working', async () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    const tools = draftTools(db)

    const hookResult = await tools.save_hook.execute({
      items: Array.from({ length: 5 }, (_, i) => ({ rank: i, category: 'community', name: `H${i}`, description: 'd' })),
    })
    const profileResult = await tools.update_soxial_profile.execute({ data: { growth_strategy: 'Covers X/Twitter and Reddit.' } })

    const { artifactFromTool } = await import('../electron/main/onboarding-readiness')
    expect(artifactFromTool('save_hook', { items: new Array(5) }, hookResult)).toEqual({ kind: 'hooks', count: 5 })
    expect(artifactFromTool('update_soxial_profile', { data: { growth_strategy: 'Covers X/Twitter and Reddit.' } }, profileResult))
      .toEqual({ kind: 'growth_strategy', count: 1 })
    db.close()
  })
})

describe('review-section scoping for regeneration', () => {
  function baselineDoc() {
    const doc = createEmptyDraftDocument()
    doc.profileStrategyFields.growth_strategy = 'Positioning baseline.'
    doc.profileStrategyFields.voice_description = 'Voice baseline.'
    doc.profileStrategyFields.target_audience = 'Audience baseline.'
    doc.profileStrategyFields.tone_balance = 'Cadence baseline.'
    doc.pillars = [{ name: 'P1', description: 'base' }]
    doc.hooks = [{ rank: 1, category: 'showcase', name: 'H1', description: 'base' }]
    doc.voiceRules = [{ type: 'banned_phrase' as const, content: 'synergy' }]
    doc.targets = [{ platform: 'twitter', handle: 'base' }]
    doc.memories = [{ type: 'audience', title: 'Base', content: 'base' }]
    doc.deletions.targets = ['twitter\u0000old']
    return doc
  }

  test('mutations outside the requested section are discarded, in-section changes kept', () => {
    const baseline = baselineDoc()
    const after = baselineDoc()
    // A misbehaving regeneration pass for "voice" touched everything:
    after.profileStrategyFields.growth_strategy = 'REWRITTEN positioning'
    after.profileStrategyFields.voice_description = 'Sharper voice.'
    after.pillars = [{ name: 'Mutated', description: 'x' }]
    after.hooks.push({ rank: 2, category: 'community', name: 'Sneaky', description: 'x' })
    after.targets.push({ platform: 'reddit', handle: 'sneaky' })
    after.memories.push({ type: 'audience', title: 'Sneaky', content: 'x' })
    after.deletions.hooks.push('H1')
    after.voiceRules.push({ type: 'banned_phrase' as const, content: 'jargon' })

    restoreOutOfScopeMutations(after, baseline, 'voice')

    expect(after.profileStrategyFields.growth_strategy).toBe('Positioning baseline.')
    expect(after.profileStrategyFields.voice_description).toBe('Sharper voice.')
    expect(after.pillars).toEqual([{ name: 'P1', description: 'base' }])
    expect(after.hooks).toEqual(baseline.hooks)
    expect(after.targets).toEqual(baseline.targets)
    expect(after.memories).toEqual(baseline.memories)
    expect(after.deletions.hooks).toEqual([])
    expect(after.voiceRules).toHaveLength(2)
  })

  test('a voice regeneration can no longer rewrite growth_strategy via update_soxial_profile', () => {
    const baseline = baselineDoc()
    const after = baselineDoc()
    after.profileStrategyFields.growth_strategy = 'Voice pass rewrote the positioning!'
    restoreOutOfScopeMutations(after, baseline, 'voice')
    expect(after.profileStrategyFields.growth_strategy).toBe('Positioning baseline.')
  })

  test('each section owns exactly its own surface', () => {
    const baseline = baselineDoc()
    const after = baselineDoc()
    after.profileStrategyFields.growth_strategy = 'new positioning'
    after.profileStrategyFields.target_audience = 'new audience'
    after.profileStrategyFields.tone_balance = 'new cadence'
    after.memories.push({ type: 'audience', title: 'New', content: 'x' })
    after.targets.push({ platform: 'reddit', handle: 'new' })

    restoreOutOfScopeMutations(after, baseline, 'targets')
    expect(after.profileStrategyFields.growth_strategy).toBe('Positioning baseline.')
    expect(after.targets).toHaveLength(2)

    const after2 = baselineDoc()
    after2.profileStrategyFields.growth_strategy = 'new positioning'
    restoreOutOfScopeMutations(after2, baseline, 'positioning')
    expect(after2.profileStrategyFields.growth_strategy).toBe('new positioning')
  })

  test('fields deleted by the pass are restored from baseline', () => {
    const baseline = baselineDoc()
    const after = baselineDoc()
    delete after.profileStrategyFields.target_audience
    restoreOutOfScopeMutations(after, baseline, 'voice')
    expect(after.profileStrategyFields.target_audience).toBe('Audience baseline.')
  })
})

describe('draft size bounds', () => {
  test('collections are capped on persist, keeping the first items', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    updateDraft(db, 'run_1', null, doc => {
      doc.hooks = Array.from({ length: 80 }, (_, i) => ({ rank: i + 1, category: 'community' as const, name: `H${i}`, description: 'd' }))
      doc.starterDrafts = Array.from({ length: 25 }, (_, i) => ({ i }))
    })
    const doc = parseDraftDocument(getDraftRow(db, 'run_1')!)
    expect(doc.hooks).toHaveLength(50)
    expect(doc.hooks[0].name).toBe('H0')
    expect(doc.starterDrafts).toHaveLength(10)
    db.close()
  })
})
