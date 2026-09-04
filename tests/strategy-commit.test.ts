import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { runMigrations } from '../electron/main/db-migrations'
import {
  createEmptyDraftDocument,
  ensureDraftForRun,
  getBaseSnapshot,
  getDraftRow,
  openDraftForReview,
  parseDraftDocument,
  updateDraft,
} from '../electron/main/strategy-draft'
import { commitOnboardingStrategy, shouldTakePreCommitBackup } from '../electron/main/strategy-commit'
import type { ToolLedgerEntry } from '../electron/main/onboarding-run'

const PLATFORMS = { twitter: true, reddit: true }

/** Ledger of a run that produced every required artifact. */
function fillLedger(): ToolLedgerEntry[] {
  const entry = (callId: string, name: string, kind: string, count: number): ToolLedgerEntry => ({
    callId,
    name,
    status: 'succeeded',
    startedAt: new Date().toISOString(),
    artifact: { kind, count },
  })
  return [
    entry('c1', 'update_soxial_profile', 'growth_strategy', 1),
    entry('c2', 'save_pillar', 'pillars', 3),
    entry('c3', 'save_voice_rule', 'voice_rules', 3),
    entry('c4', 'save_hook', 'hooks', 5),
    entry('c5', 'save_memory', 'audience_memory', 1),
    entry('c6', 'save_milestone', 'baseline_metrics', 1),
  ]
}

const COMMIT_CONTEXT = { connectedPlatforms: PLATFORMS, ledger: fillLedger(), finalText: 'Your strategy is ready.' }

function createDb() {
  const db = new Database(':memory:')
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
  db.prepare(`INSERT INTO user_profile (id, name, twitter_handle, reddit_username, timezone, growth_strategy)
              VALUES (1, 'Jane', 'janedoe', 'jane_rdt', 'UTC+1', 'Old strategy.')`).run()
  db.prepare(`INSERT INTO hooks (rank, category, name, description) VALUES (1, 'showcase', 'Seeded Hook', 'default')`).run()
  return db
}

/** A draft that satisfies every commit requirement. */
function fillCompleteDraft(db: Database.Database, runId = 'run_1', opts: { deleteHook?: string } = {}) {
  updateDraft(db, runId, null, doc => {
    doc.profileStrategyFields.growth_strategy = 'A plan covering X/Twitter and Reddit growth with weekly cadence.'
    doc.profileStrategyFields.voice_description = 'Direct, warm, concrete.'
    doc.pillars = [
      { name: 'Build in public', description: 'Weekly progress' },
      { name: 'Teaching', description: 'How-tos' },
      { name: 'Opinions', description: 'Industry takes' },
    ]
    doc.hooks = Array.from({ length: 5 }, (_, i) => ({
      rank: i + 1, category: 'community' as const, name: `Hook ${i + 1}`, description: 'd',
    }))
    doc.voiceRules = [
      { type: 'banned_phrase' as const, content: 'synergy' },
      { type: 'natural_element' as const, content: 'short sentences' },
      { type: 'banned_structure' as const, content: 'no hook-stacking' },
    ]
    doc.memories = [{ type: 'audience', title: 'Audience', content: 'Founders testing positioning.' }]
    doc.milestones = [{ platform: 'twitter', metric: 'followers', value: '120' }]
    if (opts.deleteHook) doc.deletions.hooks.push(opts.deleteHook)
  })
}

function openReview(db: Database.Database, runId = 'run_1'): number {
  const row = openDraftForReview(db, runId, { gaps: [] })!
  return row.version
}

describe('commit-time readiness re-validation', () => {
  test('commit re-validates readiness on merged state and blocks with the shared validator missing list', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    // Complete draft, but an EMPTY ledger: this run never wrote the artifacts,
    // so the merged state must not be treated as ready.
    fillCompleteDraft(db)
    const version = openReview(db)
    const result = commitOnboardingStrategy(db, 'run_1', version, { connectedPlatforms: PLATFORMS, ledger: [], finalText: 'summary' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('COMMIT_BLOCKED_INCOMPLETE')
      expect(result.missing).toEqual(expect.arrayContaining(['pillars', 'voice_rules', 'hooks', 'audience_memory', 'baseline_metrics', 'growth_strategy']))
    }
    db.close()
  })

  test('a complete ledger plus draft passes the shared validator', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    const version = openReview(db)
    const result = commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)
    expect(result).toEqual({ ok: true })
    db.close()
  })

  test('recorded gaps excuse only eligible artifacts', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    const ledger = fillLedger().filter(e => e.artifact?.kind !== 'audience_memory' && e.artifact?.kind !== 'baseline_metrics')
    const version = openDraftForReview(db, 'run_1', {
      gaps: [
        { artifact: 'audience_memory', reason: 'no data' },
        { artifact: 'baseline_metrics', reason: 'private account' },
      ],
    })!.version
    const result = commitOnboardingStrategy(db, 'run_1', version, { connectedPlatforms: PLATFORMS, ledger, finalText: 'summary' })
    expect(result).toEqual({ ok: true })
    db.close()
  })

  test('a missing summary blocks commit via the shared final_summary check', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    const version = openReview(db)
    const result = commitOnboardingStrategy(db, 'run_1', version, { connectedPlatforms: PLATFORMS, ledger: fillLedger(), finalText: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toContain('final_summary')
    db.close()
  })
})

describe('pre-commit backup decision', () => {
  test('a backup is needed when no pre-commit backup exists for the draft', () => {
    expect(shouldTakePreCommitBackup([], '2026-01-01T00:00:00Z')).toBe(true)
    expect(shouldTakePreCommitBackup([{ reason: 'manual', createdAt: '2026-02-01T00:00:00Z' }], '2026-01-01T00:00:00Z')).toBe(true)
    // Pre-commit backup taken BEFORE this draft was created does not cover it.
    expect(shouldTakePreCommitBackup([{ reason: 'pre-commit', createdAt: '2025-12-01T00:00:00Z' }], '2026-01-01T00:00:00Z')).toBe(true)
  })

  test('an existing pre-commit backup newer than the draft suppresses another', () => {
    expect(shouldTakePreCommitBackup([{ reason: 'pre-commit', createdAt: '2026-01-02T00:00:00Z' }], '2026-01-01T00:00:00Z')).toBe(false)
    expect(shouldTakePreCommitBackup([{ reason: 'pre-commit', createdAt: '2026-01-01T00:00:00Z' }], '2026-01-01T00:00:00Z')).toBe(false)
  })
})

describe('commitOnboardingStrategy', () => {
  test('approval applies every artifact; nothing active before approval', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    // Before approval: active tables untouched.
    expect(db.prepare('SELECT growth_strategy FROM user_profile WHERE id = 1').get()).toEqual({ growth_strategy: 'Old strategy.' })

    fillCompleteDraft(db)
    const version = openReview(db)
    const result = commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)
    expect(result).toEqual({ ok: true })

    expect((db.prepare('SELECT growth_strategy FROM user_profile WHERE id = 1').get() as any).growth_strategy).toContain('weekly cadence')
    expect((db.prepare('SELECT COUNT(*) n FROM content_pillars WHERE name = ?').get('Build in public') as any).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) n FROM hooks').get() as any).n).toBe(6)
    expect((db.prepare('SELECT COUNT(*) n FROM voice_rules').get() as any).n).toBe(3)
    expect((db.prepare('SELECT COUNT(*) n FROM memory_entries').get() as any).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) n FROM growth_milestones').get() as any).n).toBe(1)

    // Identity fields untouched by the commit.
    const profile = db.prepare('SELECT name, twitter_handle, reddit_username, timezone FROM user_profile WHERE id = 1').get() as any
    expect(profile).toEqual({ name: 'Jane', twitter_handle: 'janedoe', reddit_username: 'jane_rdt', timezone: 'UTC+1' })
    db.close()
  })

  test('double approval is an idempotent success that does not duplicate rows', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    const version = openReview(db)
    expect(commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)).toEqual({ ok: true })
    const countsBefore = (db.prepare('SELECT COUNT(*) n FROM hooks').get() as any).n
    expect(commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)).toEqual({ ok: true, alreadyCommitted: true })
    expect((db.prepare('SELECT COUNT(*) n FROM hooks').get() as any).n).toBe(countsBefore)
    db.close()
  })

  test('stale expectedVersion is rejected with a typed error', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    openReview(db)
    updateDraft(db, 'run_1', null, () => {}) // bumps version behind the reviewer's back
    const result = commitOnboardingStrategy(db, 'run_1', 2, COMMIT_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('DRAFT_VERSION_CONFLICT')
    // Active tables still untouched.
    expect((db.prepare('SELECT growth_strategy FROM user_profile WHERE id = 1').get() as any).growth_strategy).toBe('Old strategy.')
    db.close()
  })

  test('a ledger missing strategy artifacts blocks commit with the specific artifact', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    const version = openReview(db)
    // The run never actually saved its pillars — the ledger is the truth.
    const ledger = fillLedger().filter(e => e.artifact?.kind !== 'pillars')
    const result = commitOnboardingStrategy(db, 'run_1', version, { connectedPlatforms: PLATFORMS, ledger, finalText: 'summary' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('COMMIT_BLOCKED_INCOMPLETE')
      expect(result.missing).toContain('pillars')
    }
    db.close()
  })

  test('a merged growth strategy that ignores connected platforms blocks commit', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1')
    fillCompleteDraft(db)
    updateDraft(db, 'run_1', null, doc => {
      doc.profileStrategyFields.growth_strategy = 'A platform-agnostic plan.'
    })
    const version = openReview(db)
    const result = commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toContain('platform_strategy')
    db.close()
  })

  test('deletions skip rows created after the base snapshot', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1') // snapshot taken here — 'User Hook' does not exist yet
    db.prepare(`INSERT INTO hooks (rank, category, name, description) VALUES (9, 'community', 'User Hook', 'user-made')`).run()

    fillCompleteDraft(db, 'run_1', { deleteHook: 'User Hook' })
    const version = openReview(db)
    expect(commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT)).toEqual({ ok: true })

    // User-created row survives; seeded snapshot-backed rows are still there.
    expect((db.prepare('SELECT COUNT(*) n FROM hooks WHERE name = ?').get('User Hook') as any).n).toBe(1)
    expect(commitOnboardingStrategy(db, 'run_1', version, COMMIT_CONTEXT).ok).toBe(true)
    db.close()
  })

  test('drafts outside review cannot be committed', () => {
    const db = createDb()
    ensureDraftForRun(db, 'run_1') // status stays 'draft'
    fillCompleteDraft(db)
    const result = commitOnboardingStrategy(db, 'run_1', getDraftRow(db, 'run_1')!.version, { connectedPlatforms: PLATFORMS })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('DRAFT_NOT_IN_REVIEW')
    db.close()
  })

  test('unknown runs report DRAFT_NOT_FOUND', () => {
    const db = createDb()
    const result = commitOnboardingStrategy(db, 'missing_run', 1, COMMIT_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('DRAFT_NOT_FOUND')
    db.close()
  })
})
