// Plan 13: background strategy enrichment.
//
// After the user approves the core strategy (Plan 12 commit), one bounded,
// resumable job expands hooks, targets, cadence notes, and memory. The user is
// already in chat by then: enrichment never blocks, never asks questions,
// never takes a public/account action, and failure never revokes the approved
// "basic ready" state.

import type Database from 'better-sqlite3'
import { randomBytes } from 'crypto'
import { getDb } from './db'
import { createTools } from './tools'
import { ENRICHMENT_CAPABILITIES, filterToolsByCapability } from './tool-capabilities'
import { abortableSleep, runAgent, getOnboardingFallbackChain } from './agent'
import { logger } from './log'

export const ENRICHMENT_MAX_STEPS = 8
export const ENRICHMENT_MAX_ATTEMPTS = 3

export type EnrichmentJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface EnrichmentJobRow {
  id: string
  run_id: string
  status: EnrichmentJobStatus
  attempt: number
  max_attempts: number
  user_retries?: number
  stage: string
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  updated_at: string
  completed_at: string | null
}

/**
 * Manual (user-initiated) retries reset the attempt counter, so they need
 * their own bound — otherwise a permanently failing job could be retried
 * forever.
 */
export const ENRICHMENT_MAX_USER_RETRIES = 3

/** True when the user may still manually retry this job. */
export function canManuallyRetryEnrichment(job: Pick<EnrichmentJobRow, 'user_retries'>): boolean {
  return (job.user_retries ?? 0) < ENRICHMENT_MAX_USER_RETRIES
}

/** Strategy readiness tiers surfaced to the UI. */
export type StrategyReadiness =
  | 'not_started'
  | 'basic_ready'
  | 'enriching'
  | 'fully_ready'
  | 'enrichment_failed'

function newJobId(): string {
  return `enj_${randomBytes(6).toString('hex')}`
}

export function getEnrichmentJob(db: Database.Database, runId: string): EnrichmentJobRow | null {
  const row = db.prepare(`
    SELECT * FROM onboarding_enrichment_jobs WHERE run_id = ?
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `).get(runId) as EnrichmentJobRow | undefined
  return row ?? null
}

/**
 * Insert a pending job for a committed run. Idempotent: a run with a pending/
 * running/succeeded job never gets a second one; only failed/cancelled jobs
 * can be superseded by an explicit retry (which resets the same row instead).
 */
export function scheduleEnrichment(db: Database.Database, runId: string): EnrichmentJobRow | null {
  const existing = getEnrichmentJob(db, runId)
  if (existing && !['failed', 'cancelled'].includes(existing.status)) return existing

  try {
    db.prepare(`
      INSERT INTO onboarding_enrichment_jobs (id, run_id, status, max_attempts, stage)
      VALUES (?, ?, 'pending', ?, 'queued')
    `).run(newJobId(), runId, ENRICHMENT_MAX_ATTEMPTS)
  } catch (error) {
    // UNIQUE(run_id, status) guards a racing double-schedule.
    logger.warn('enrichment', `schedule race for ${runId}; keeping existing job`, error)
    return getEnrichmentJob(db, runId)
  }
  return getEnrichmentJob(db, runId)
}

/** Mark a running job back to pending on startup; exhausted jobs fail. */
export function prepareEnrichmentJobsForResume(db: Database.Database): EnrichmentJobRow[] {
  db.prepare(`
    UPDATE onboarding_enrichment_jobs SET status = 'pending', updated_at = datetime('now')
    WHERE status = 'running'
  `).run()

  db.prepare(`
    UPDATE onboarding_enrichment_jobs SET status = 'failed',
      last_error_code = 'ATTEMPTS_EXHAUSTED', updated_at = datetime('now')
    WHERE status = 'pending' AND attempt >= max_attempts
  `).run()

  return db.prepare(`
    SELECT * FROM onboarding_enrichment_jobs
    WHERE status = 'pending' AND attempt < max_attempts
    ORDER BY updated_at ASC
  `).all() as EnrichmentJobRow[]
}

interface ActiveEnrichmentJob {
  id: string
  runId: string
  abortController: AbortController
  stage: string
}
const activeJobs = new Map<string, ActiveEnrichmentJob>()

export function isEnrichmentRunning(runId: string): boolean {
  return activeJobs.has(runId)
}

export function cancelEnrichment(runId: string): boolean {
  const active = activeJobs.get(runId)
  if (!active) {
    // Also settle a stuck DB-side running row (e.g. after a crash).
    const db = getDb()
    const result = db.prepare(`
      UPDATE onboarding_enrichment_jobs SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE run_id = ? AND status IN ('pending', 'running')
    `).run(runId)
    return result.changes > 0
  }
  active.abortController.abort()
  return true
}

const ENRICHMENT_INSTRUCTIONS = [
  'Deepen an already-approved social media strategy. Work from what is saved — do NOT gather new social data, do NOT ask questions.',
  'Produce additive refinements only: extra hooks adapted to the niche, additional target accounts/subreddits, deeper platform adaptations inside growth_strategy, an experiment backlog as memory entries, and competitor/audience observations as memory entries.',
  'Rules:',
  '- Save in bulk: one call per tool with all items.',
  '- NEVER invent metrics or engagement numbers. Baselines already exist.',
  '- Do not delete or rewrite the core strategy; add to it.',
  '- Finish with one short confirmation sentence.',
].join('\n')

/** Ordered progression used by `advanceEnrichmentStage`. */
export const ENRICHMENT_STAGES = ['queued', 'hooks', 'targets', 'cadence', 'experiments', 'drafts', 'memory', 'done'] as const

export type EnrichmentStage = (typeof ENRICHMENT_STAGES)[number]

const TOOL_STAGE: Record<string, Exclude<EnrichmentStage, 'queued' | 'done'>> = {
  save_hook: 'hooks',
  save_target: 'targets',
  update_soxial_profile: 'cadence',
  save_memory: 'memory',
}

/**
 * Transient provider/network failures: retried with backoff, capped by the
 * job's `max_attempts`. Everything else (bad request, auth, empty output) is
 * terminal for the attempt.
 */
export function isTransientEnrichmentFailure(message: string): boolean {
  return /\b(500|502|503|504)\b|internal server error|bad gateway|service unavailable|overloaded|network|fetch failed|econnreset|econnrefused|etimedout|timeout|timed out|socket hang up/i.test(message)
}

/** Exponential backoff between retry attempts, capped at 30 seconds. */
export function nextEnrichmentBackoffMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** (attempt - 1))
}

/**
 * Map a tool call to the enrichment stage it belongs to. The stage only ever
 * moves forward, so a late `save_hook` after memory work cannot rewind it.
 */
export function advanceEnrichmentStage(current: string, toolName: string, args?: unknown): string {
  let next: EnrichmentStage | undefined = TOOL_STAGE[toolName]
  if (toolName === 'save_memory') {
    const items = Array.isArray((args as any)?.items) ? (args as any).items : []
    if (items.some((item: any) => String(item?.type ?? '').toLowerCase() === 'experiment')) next = 'experiments'
  }
  if (!next) return current
  const from = (ENRICHMENT_STAGES as readonly string[]).indexOf(current)
  const to = (ENRICHMENT_STAGES as readonly string[]).indexOf(next)
  if (from < 0 || to < 0) return current
  return to > from ? next : current
}

/** Job-scoped events for the renderer (stage progress and settlement). */
export type EnrichmentJobEvent =
  | { type: 'stage'; stage: string }
  | { type: 'complete' }
  | { type: 'failed'; errorCode: string | null }
  | { type: 'cancelled' }

/**
 * Execute one enrichment attempt for a run. Bounded by step budget and abort
 * signal; transient failures retry with exponential backoff up to the job's
 * max_attempts. Writes land directly in the active tables via the strict
 * read + strategy-write capability filter.
 */
export function runEnrichmentJob(
  runId: string,
  options: {
    onEvent?: (event: EnrichmentJobEvent) => void
  } = {},
): void {
  const db = getDb()
  if (activeJobs.has(runId)) return

  let job = getEnrichmentJob(db, runId)
  if (!job || ['succeeded', 'cancelled'].includes(job.status)) return
  if (job.status === 'failed') return
  if (job.attempt >= job.max_attempts) {
    db.prepare(`UPDATE onboarding_enrichment_jobs SET status = 'failed', last_error_code = 'ATTEMPTS_EXHAUSTED', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(job.id)
    options.onEvent?.({ type: 'failed', errorCode: 'ATTEMPTS_EXHAUSTED' })
    return
  }

  const abortController = new AbortController()
  const active: ActiveEnrichmentJob = { id: job.id, runId, abortController, stage: job.stage || 'queued' }
  activeJobs.set(runId, active)

  const setStage = (stage: string) => {
    if (stage === active.stage) return
    active.stage = stage
    db.prepare(`UPDATE onboarding_enrichment_jobs SET stage = ?, updated_at = datetime('now') WHERE id = ?`).run(stage, job.id)
    options.onEvent?.({ type: 'stage', stage })
  }

  let attempt = job.attempt + 1
  db.prepare(`
    UPDATE onboarding_enrichment_jobs SET status = 'running', attempt = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now')
    WHERE id = ?
  `).run(attempt, job.id)

  // Capability filter: reads and strategy writes ONLY — no media generation,
  // no questions, no public/account surface.
  const baseTools = filterToolsByCapability(createTools({}) as Record<string, any>, ENRICHMENT_CAPABILITIES)

  void (async () => {
    let ok = false
    let cancelled = false
    let errorCode: string | null = null
    try {
      while (true) {
        const outcome = await new Promise<{ text: string; error?: string }>((resolve) => {
          runAgent({
            messages: [{ role: 'user', content: ENRICHMENT_INSTRUCTIONS }] as any,
            onToolCall: (name, args) => setStage(advanceEnrichmentStage(active.stage, name, args)),
            onDone: text => resolve({ text }),
            onError: error => resolve({ text: '', error }),
            options: { maxSteps: ENRICHMENT_MAX_STEPS, fallbackChain: getOnboardingFallbackChain() },
            toolsOverride: baseTools as any,
            abortController,
          })
        })
        if (abortController.signal.aborted) {
          cancelled = true
          break
        }
        if (!outcome.error && outcome.text.trim().length > 0) {
          ok = true
          break
        }
        errorCode = outcome.error ? 'AGENT_ERROR' : 'EMPTY_OUTPUT'
        if (isTransientEnrichmentFailure(outcome.error ?? '') && attempt < job.max_attempts) {
          await abortableSleep(nextEnrichmentBackoffMs(attempt), abortController)
          if (abortController.signal.aborted) {
            cancelled = true
            break
          }
          attempt++
          db.prepare(`UPDATE onboarding_enrichment_jobs SET attempt = ?, updated_at = datetime('now') WHERE id = ?`).run(attempt, job.id)
          continue
        }
        break
      }
    } catch (error) {
      logger.error('enrichment', `job for ${runId} threw`, error)
      errorCode = 'EXCEPTION'
      ok = false
    } finally {
      activeJobs.delete(runId)
      const status = cancelled ? 'cancelled' : ok ? 'succeeded' : 'failed'
      const finished = db.prepare(`
        UPDATE onboarding_enrichment_jobs SET
          status = ?,
          stage = ?,
          last_error_code = ?,
          last_error_message = CASE WHEN ? IS NULL THEN NULL ELSE substr(?, 1, 300) END,
          completed_at = CASE WHEN ? IN ('succeeded', 'failed', 'cancelled') THEN datetime('now') ELSE NULL END,
          updated_at = datetime('now')
        WHERE id = ?
      `)
      finished.run(status, ok ? 'done' : active.stage, errorCode, errorCode, errorCode ?? '', status, job.id)
      logger.info('enrichment', `job ${job.id} for ${runId} finished: ${status}`)
      if (cancelled) options.onEvent?.({ type: 'cancelled' })
      else if (ok) options.onEvent?.({ type: 'complete' })
      else options.onEvent?.({ type: 'failed', errorCode })
    }
  })()
}

/** Derived readiness tier for the UI. basic_ready is authoritative once true. */
export function deriveStrategyReadiness(db: Database.Database, runId: string, hasCommittedStrategy: boolean): StrategyReadiness {
  if (!hasCommittedStrategy) return 'not_started'
  const job = getEnrichmentJob(db, runId)
  if (!job) return 'basic_ready'
  switch (job.status) {
    case 'running':
    case 'pending':
      return 'enriching'
    case 'succeeded':
      return 'fully_ready'
    case 'failed':
      return 'enrichment_failed'
    default:
      return 'basic_ready' // cancelled enrichment still leaves basic_ready intact
  }
}
