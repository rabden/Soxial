import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { runMigrations } from '../electron/main/db-migrations'
import {
  advanceEnrichmentStage,
  canManuallyRetryEnrichment,
  deriveStrategyReadiness,
  ENRICHMENT_MAX_USER_RETRIES,
  getEnrichmentJob,
  isTransientEnrichmentFailure,
  nextEnrichmentBackoffMs,
  prepareEnrichmentJobsForResume,
  scheduleEnrichment,
} from '../electron/main/onboarding-enrichment'
import { createTools } from '../electron/main/tools'
import { ENRICHMENT_CAPABILITIES, SAFE_CAPABILITIES, filterToolsByCapability, listDeniedTools } from '../electron/main/tool-capabilities'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT);
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, updated_at TEXT);
    CREATE TABLE scheduled_posts (id INTEGER PRIMARY KEY, status TEXT, scheduled_time TEXT);
    CREATE TABLE social_content (id INTEGER PRIMARY KEY, author_handle TEXT, subreddit TEXT, posted_at TEXT);
    CREATE TABLE model_exhaustion (id INTEGER PRIMARY KEY, model TEXT, api_key_id INTEGER, available_at TEXT);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY, provider TEXT, tier TEXT, is_active INTEGER, created_at TEXT);
    CREATE TABLE user_profile (id INTEGER PRIMARY KEY CHECK (id = 1), growth_strategy TEXT, onboarding_complete INTEGER DEFAULT 0);
    CREATE TABLE hooks (id INTEGER PRIMARY KEY AUTOINCREMENT, rank INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT, why_it_works TEXT, template TEXT, niche_examples TEXT, performance_notes TEXT);
    CREATE TABLE content_pillars (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, structure TEXT, frequency TEXT, platform_adaptations TEXT);
    CREATE TABLE voice_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL, UNIQUE(type, content));
    CREATE TABLE target_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, handle TEXT NOT NULL, tier TEXT, why TEXT, strategy TEXT, UNIQUE(platform, handle));
    CREATE TABLE algorithm_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, signal TEXT NOT NULL, weight TEXT, description TEXT, UNIQUE(platform, signal));
    CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE memory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, platform TEXT, title TEXT, content TEXT, data_json TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE growth_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, metric TEXT NOT NULL, value TEXT, note TEXT, recorded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE onboarding_runs (
      run_id TEXT PRIMARY KEY, phase TEXT NOT NULL, status TEXT NOT NULL, checkpoint_json TEXT NOT NULL,
      last_error_code TEXT, started_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), completed_at TEXT
    );
  `)
  runMigrations(db)
  return db
}

describe('enrichment job persistence', () => {
  test('schedule is idempotent while a job is live', () => {
    const db = createDb()
    const first = scheduleEnrichment(db, 'run_1')
    expect(first?.status).toBe('pending')
    const again = scheduleEnrichment(db, 'run_1')
    expect(again?.id).toBe(first?.id)

    const rows = db.prepare('SELECT COUNT(*) n FROM onboarding_enrichment_jobs WHERE run_id = ?').get('run_1') as any
    expect(rows.n).toBe(1)
    db.close()
  })

  test('a failed job can be superseded by a new schedule attempt', () => {
    const db = createDb()
    const first = scheduleEnrichment(db, 'run_1')!
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'failed', last_error_code = 'AGENT_ERROR', completed_at = datetime('now') WHERE id = ?`).run(first.id)
    const second = scheduleEnrichment(db, 'run_1')!
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
    expect(second.attempt).toBe(0)
    db.close()
  })

  test('startup resume requeues running jobs and fails exhausted ones', () => {
    const db = createDb()
    // Interrupted mid-flight:
    const interrupted = scheduleEnrichment(db, 'run_1')!
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'running', attempt = 1 WHERE id = ?`).run(interrupted.id)
    // Exhausted by repeated crashes:
    const exhausted = scheduleEnrichment(db, 'run_2')!
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'pending', attempt = max_attempts WHERE id = ?`).run(exhausted.id)

    const resumable = prepareEnrichmentJobsForResume(db)
    expect(resumable.map(r => r.run_id)).toEqual(['run_1'])

    expect((db.prepare('SELECT status FROM onboarding_enrichment_jobs WHERE id = ?').get(interrupted.id) as any).status).toBe('pending')
    expect((db.prepare('SELECT status FROM onboarding_enrichment_jobs WHERE id = ?').get(exhausted.id) as any).status).toBe('failed')
    db.close()
  })
})

describe('derived strategy readiness', () => {
  test('basic_ready is authoritative; enrichment states are additive', () => {
    const db = createDb()
    // Not committed yet.
    expect(deriveStrategyReadiness(db, 'run_1', false)).toBe('not_started')

    // Committed, no job at all — still usable.
    expect(deriveStrategyReadiness(db, 'run_1', true)).toBe('basic_ready')

    scheduleEnrichment(db, 'run_1')
    expect(deriveStrategyReadiness(db, 'run_1', true)).toBe('enriching')

    const job = getEnrichmentJob(db, 'run_1')!
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'succeeded', completed_at = datetime('now') WHERE id = ?`).run(job.id)
    expect(deriveStrategyReadiness(db, 'run_1', true)).toBe('fully_ready')

    // Failure never revokes basic readiness for product purposes; it surfaces diagnostically.
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'failed' WHERE id = ?`).run(job.id)
    expect(deriveStrategyReadiness(db, 'run_1', true)).toBe('enrichment_failed')

    // Cancelled enrichment leaves basic_ready intact.
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'cancelled' WHERE id = ?`).run(job.id)
    expect(deriveStrategyReadiness(db, 'run_1', true)).toBe('basic_ready')
    db.close()
  })
})

describe('enrichment capability boundary', () => {
  test('the scoped tool set carries no denied or interactive/scheduling tools', () => {
    const raw = createTools({}) as Record<string, any>
    const scoped = filterToolsByCapability(raw, SAFE_CAPABILITIES) as Record<string, unknown>

    // No public/account tool survives the filter.
    for (const name of Object.keys(raw)) {
      if (listDeniedTools({ [name]: raw[name] }, SAFE_CAPABILITIES).length > 0) {
        expect(scoped[name]).toBeUndefined()
      }
    }
    // The interview and scheduling surface must never exist during enrichment.
    expect(scoped.ask_user_questions).toBeUndefined()
    expect(scoped.schedule_post).toBeUndefined()
    // Sanity: reads and strategy writes do exist.
    expect(scoped.read_hooks).toBeDefined()
    expect(scoped.save_hook).toBeDefined()
  })

  test('enrichment grants ONLY read + strategy-write — no local-draft or interactive tools', () => {
    const raw = createTools({}) as Record<string, any>
    const scoped = filterToolsByCapability(raw, ENRICHMENT_CAPABILITIES) as Record<string, unknown>

    expect(scoped.read_hooks).toBeDefined()
    expect(scoped.save_hook).toBeDefined()
    // local-draft: image generation is out of enrichment scope.
    expect(scoped.generate_image).toBeUndefined()
    // interactive: enrichment must never ask the user anything.
    expect(scoped.ask_user).toBeUndefined()
  })
})

describe('enrichment retry policy', () => {
  test('transient server/network failures are retryable; others are not', () => {
    expect(isTransientEnrichmentFailure('500 Internal Server Error')).toBe(true)
    expect(isTransientEnrichmentFailure('502 Bad Gateway')).toBe(true)
    expect(isTransientEnrichmentFailure('503 Service Unavailable')).toBe(true)
    expect(isTransientEnrichmentFailure('network request failed')).toBe(true)
    expect(isTransientEnrichmentFailure('fetch failed')).toBe(true)
    expect(isTransientEnrichmentFailure('ECONNRESET')).toBe(true)
    expect(isTransientEnrichmentFailure('socket hang up')).toBe(true)

    expect(isTransientEnrichmentFailure('400 invalid argument')).toBe(false)
    expect(isTransientEnrichmentFailure('unauthorized (401)')).toBe(false)
    expect(isTransientEnrichmentFailure('')).toBe(false)
  })

  test('backoff grows exponentially and caps at 30 seconds', () => {
    expect(nextEnrichmentBackoffMs(1)).toBe(2000)
    expect(nextEnrichmentBackoffMs(2)).toBe(4000)
    expect(nextEnrichmentBackoffMs(3)).toBe(8000)
    expect(nextEnrichmentBackoffMs(4)).toBe(16000)
    expect(nextEnrichmentBackoffMs(5)).toBe(30000)
    expect(nextEnrichmentBackoffMs(50)).toBe(30000)
  })
})

describe('enrichment stage progression', () => {
  test('write tools advance the stage; reads and unknown tools do not', () => {
    expect(advanceEnrichmentStage('queued', 'save_hook')).toBe('hooks')
    expect(advanceEnrichmentStage('queued', 'save_target')).toBe('targets')
    expect(advanceEnrichmentStage('queued', 'update_soxial_profile')).toBe('cadence')
    expect(advanceEnrichmentStage('queued', 'save_memory')).toBe('memory')
    expect(advanceEnrichmentStage('queued', 'read_hooks')).toBe('queued')
    expect(advanceEnrichmentStage('queued', 'twitter_post')).toBe('queued')
  })

  test('the stage only moves forward', () => {
    expect(advanceEnrichmentStage('targets', 'save_hook')).toBe('targets')
    expect(advanceEnrichmentStage('memory', 'save_target')).toBe('memory')
    expect(advanceEnrichmentStage('done', 'save_hook')).toBe('done')
  })

  test('experiment-type memories report the experiments stage', () => {
    expect(advanceEnrichmentStage('queued', 'save_memory', { items: [{ type: 'experiment' }] })).toBe('experiments')
    expect(advanceEnrichmentStage('queued', 'save_memory', { items: [{ type: 'audience' }] })).toBe('memory')
  })
})

describe('manual retry cap (Plan 13: no unbounded user retries)', () => {
  test('allows a fresh job to be manually retried', () => {
    expect(canManuallyRetryEnrichment({ user_retries: 0 })).toBe(true)
    expect(canManuallyRetryEnrichment({})).toBe(true)
  })

  test('blocks once the manual retry budget is spent', () => {
    expect(canManuallyRetryEnrichment({ user_retries: ENRICHMENT_MAX_USER_RETRIES - 1 })).toBe(true)
    expect(canManuallyRetryEnrichment({ user_retries: ENRICHMENT_MAX_USER_RETRIES })).toBe(false)
    expect(canManuallyRetryEnrichment({ user_retries: ENRICHMENT_MAX_USER_RETRIES + 5 })).toBe(false)
  })
})
