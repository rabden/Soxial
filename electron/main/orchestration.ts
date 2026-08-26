// Hardened subagent orchestration engine.
//
// Patterns ported from the grok-build agent harness (xai-org/grok-build):
// - Foreground budget with auto-backgrounding: a blocking delegation returns
//   after a budget with a run id the model can poll, instead of blocking
//   forever or killing productive work (task tool, `result.backgrounded`).
// - Concurrency admission that can be tuned but never disabled; overflow
//   queues in order and still acts as a barrier (task/admission.rs).
// - Closed outcome vocabulary + settle-once: late or duplicate settlements
//   are refused and logged instead of corrupting state (workflow tracker's
//   apply_outcome).
// - Classify-once failure taxonomy as a pure function: every failure class
//   declares its own retryability explicitly, and deterministic failures veto
//   retries even when they look transient (sampler/retry.rs).
// - Every backoff capped and jittered; every wait has a documented ceiling.
// - Bounded completion buffer so finished-run results stay retrievable for a
//   while without growing without limit.
// - Teardown fan-out on chat stop / app quit settles everything exactly once.

import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { runAgent } from './agent'
import { createTools } from './tools'
import {
  SUBAGENT_DEFINITIONS,
  SUBAGENT_KINDS,
  SUBAGENT_MAX_OUTPUT_CHARS,
  isSubagentKind,
  type SubagentKind,
} from './subagents'
import { logger } from './log'

// ─── Tunables (documented ceilings — never infinite) ────────────────────────

/** Subagents one chat run may execute at once. Tunable, never disabled. */
export const MAX_CONCURRENT_SUBAGENTS = 3

/**
 * How long run_subagent blocks before auto-backgrounding the child. The child
 * keeps running; the model polls get_subagent_output instead of hanging the
 * turn (grok-build default foreground budget: 45s).
 */
export const FOREGROUND_BUDGET_MS = 45_000

/** Hard wall-clock budget for ONE attempt of a subagent run. */
export const SUBAGENT_ATTEMPT_TIMEOUT_MS = 180_000

/** Ceiling for get_subagent_output's blocking wait. */
export const MAX_WAIT_BLOCK_MS = 60_000

/** Transient failures retry with this many EXTRA attempts (logical call = 1 slot). */
export const MAX_TRANSIENT_RETRIES = 2

/** Backoff schedule base: 2s, 8s — capped, jittered ±20%. */
const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 15_000

/** After this many consecutive failed runs, new spawns fail fast for a cooldown. */
export const COOLDOWN_THRESHOLD = 5
export const COOLDOWN_MS = 60_000

/** Finished-run results kept retrievable by get_subagent_output. */
export const COMPLETED_BUFFER_SIZE = 64

/** Bounded transition history per run (change detection / diagnostics). */
const RUN_HISTORY_LIMIT = 32

// ─── Closed vocabularies ────────────────────────────────────────────────────

export type SubagentRunState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'

export const TERMINAL_RUN_STATES: ReadonlySet<SubagentRunState> = new Set([
  'completed', 'failed', 'cancelled', 'timeout',
])

/** Typed error codes surfaced to the orchestrating model. */
export type SubagentErrorCode =
  | 'UNKNOWN_KIND'
  | 'EMPTY_TASK'
  | 'DEPTH_EXCEEDED'
  | 'COOLDOWN_ACTIVE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'ALL_MODELS_FAILED'
  | 'EMPTY_OUTPUT'
  | 'UNKNOWN_RUN'

/**
 * Failure classification — PURE, total. Every class declares its own
 * retryability; an unrecognised message falls to `fatal` (never retried)
 * rather than to `transient`. Timeout is deliberately NOT retryable:
 * replaying the same task would likely stall again (sampler/retry.rs
 * invariant).
 */
export type FailureClass = 'cancelled' | 'timeout' | 'transient' | 'fatal'

export function classifyFailure(error: string | undefined): { cls: FailureClass; code: SubagentErrorCode } {
  // Only an explicit cancellation token counts as cancelled. An EMPTY error
  // string is a malformed failure, not a cancellation — it classifies fatal.
  if (error === undefined || error === 'cancelled') return { cls: 'cancelled', code: 'CANCELLED' }
  const text = error.toLowerCase()
  if (text.includes('timed out') || text.includes('timeout')) return { cls: 'timeout', code: 'TIMEOUT' }
  const transientMarkers = [
    '429', 'quota', 'rate limit', 'resource_exhausted', 'overloaded',
    'fetch failed', 'econnreset', 'econnrefused', 'etimedout', 'enotfound',
    'socket hang up', 'network', '500', '502', '503', '504',
    'internal server error', 'bad gateway', 'service unavailable',
    'deadline exceeded', 'high demand', 'temporarily',
  ]
  if (transientMarkers.some(marker => text.includes(marker))) {
    return { cls: 'transient', code: 'ALL_MODELS_FAILED' }
  }
  return { cls: 'fatal', code: 'ALL_MODELS_FAILED' }
}

function jitteredBackoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 4 ** attempt)
  // ±20% jitter so concurrent retry storms do not sync up.
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

// ─── Result envelope ────────────────────────────────────────────────────────

export interface SubagentResult {
  ok: boolean
  kind: SubagentKind
  /** Pre-digested final output, bounded to SUBAGENT_MAX_OUTPUT_CHARS. */
  summary: string
  runId?: string
  /** Set when ok:false (typed) or when a foreground await backgrounded. */
  error?: string
  code?: SubagentErrorCode
  backgrounded?: boolean
  telemetry?: SubagentTelemetry
}

export interface SubagentTelemetry {
  durationMs: number
  attempts: number
  queuedMs: number
}

function boundOutput(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > SUBAGENT_MAX_OUTPUT_CHARS
    ? `${trimmed.slice(0, SUBAGENT_MAX_OUTPUT_CHARS)}…[truncated]`
    : trimmed
}

// ─── Run registry ───────────────────────────────────────────────────────────

interface ManagedRun {
  id: string
  kind: SubagentKind
  task: string
  state: SubagentRunState
  revision: number
  enqueuedAt: number
  startedAt?: number
  settledAt?: number
  abortController: AbortController
  deferred: Promise<SubagentResult>
  /** Wired immediately after construction, before anything can settle. */
  resolveDeferred?: (result: SubagentResult) => void
  /** Bounded transition log — newest last. */
  history: string[]
  result?: SubagentResult
}

function note(run: ManagedRun, entry: string): void {
  run.revision += 1
  run.history.push(entry)
  if (run.history.length > RUN_HISTORY_LIMIT) run.history.shift()
}

/**
 * Insertion-ordered map of settled runs, oldest evicted beyond the cap.
 * Exported read-only for tests via helpers below.
 */
const completedBuffer = new Map<string, ManagedRun>()

/**
 * Settle-once state transition. A terminal state can never be demoted or
 * re-settled: late callbacks lose the race and are logged instead (the
 * workflow-tracker apply_outcome invariant). Returns false when refused.
 */
function settleRun(run: ManagedRun, state: Extract<SubagentRunState, 'completed' | 'failed' | 'cancelled' | 'timeout'>, result: SubagentResult): boolean {
  if (TERMINAL_RUN_STATES.has(run.state)) {
    logger.warn('orchestration', `run ${run.id} settlement refused: already ${run.state} (wanted ${state})`)
    note(run, `settlement-refused:${state}`)
    return false
  }
  run.state = state
  run.result = result
  run.settledAt = Date.now()
  note(run, `settled:${state}`)
  // Release the admission slot BEFORE resolving waiters: the deferred
  // resolution may synchronously trigger follow-up work that expects the
  // freed slot to be visible.
  activeRuns.delete(run.id)
  run.resolveDeferred?.(result)
  completedBuffer.set(run.id, run)
  trimCompletedBuffer()
  pumpQueue()
  return true
}

function trimCompletedBuffer(): void {
  while (completedBuffer.size > COMPLETED_BUFFER_SIZE) {
    const oldest = completedBuffer.keys().next().value
    if (oldest === undefined) break
    completedBuffer.delete(oldest)
  }
}

// ─── Consecutive-failure cooldown gate ──────────────────────────────────────

let consecutiveFailures = 0
let cooldownUntil = 0

export function subagentCooldownRemainingMs(now = Date.now()): number {
  return Math.max(0, cooldownUntil - now)
}

function recordRunSuccess(): void {
  consecutiveFailures = 0
  cooldownUntil = 0
}

function recordRunFailure(): void {
  consecutiveFailures += 1
  const now = Date.now()
  // Re-armable gate: after an expired cooldown the very next failure re-trips,
  // because the counter only resets on SUCCESS — repeated failures keep the
  // gate engaged instead of letting a failing pattern hammer the provider.
  if (consecutiveFailures >= COOLDOWN_THRESHOLD && now >= cooldownUntil) {
    cooldownUntil = now + COOLDOWN_MS
    logger.warn('orchestration', `${consecutiveFailures} consecutive subagent failures — pausing spawns for ${COOLDOWN_MS / 1000}s`)
  }
}

/** Test hook: reset gate state between tests. */
export function resetCooldownGateForTests(): void {
  consecutiveFailures = 0
  cooldownUntil = 0
}

// ─── Depth guard (AsyncLocalStorage ≈ grok-build's depth counter) ───────────

const spawnDepth = new AsyncLocalStorage<{ depth: number }>()

// ─── Admission queue ────────────────────────────────────────────────────────

const activeRuns = new Map<string, ManagedRun>()
const waitingQueue: ManagedRun[] = []

let pumping = false

function pumpQueue(): void {
  if (pumping) return
  pumping = true
  try {
    while (waitingQueue.length > 0 && activeRuns.size < MAX_CONCURRENT_SUBAGENTS) {
      const run = waitingQueue.shift()!
      activeRuns.set(run.id, run)
      note(run, 'admitted')
      startAttemptLoop(run)
    }
  } finally {
    pumping = false
  }
}

// ─── Attempt execution ──────────────────────────────────────────────────────

interface AttemptOutcome {
  text: string
  error?: string
}

function buildWhitelistedTools(kind: SubagentKind): Record<string, any> {
  const baseTools = createTools({}) as Record<string, any>

  const definition = SUBAGENT_DEFINITIONS[kind]
  // Fail closed: only whitelisted names resolve into the override map.
  const tools: Record<string, any> = {}
  for (const name of definition.tools) {
    if (baseTools[name]) tools[name] = baseTools[name]
  }
  return tools
}

function runAttemptOnce(
  run: ManagedRun,
  parentSignal?: AbortSignal,
): Promise<AttemptOutcome> {
  const tools = buildWhitelistedTools(run.kind)

  const attemptAbort = new AbortController()
  // Cancellation forwarding: BOTH the registry run controller (cancelSubagent,
  // teardown) and the chat parent signal abort this attempt.
  for (const signal of [run.abortController.signal, ...(parentSignal ? [parentSignal] : [])]) {
    if (signal.aborted) attemptAbort.abort()
    else signal.addEventListener('abort', () => attemptAbort.abort(), { once: true })
  }

  return new Promise<AttemptOutcome>(resolve => {
    let settled = false
    const finish = (outcome: AttemptOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }

    // Wall-clock timeout: guaranteed termination even if the stream hangs.
    const timer = setTimeout(() => {
      attemptAbort.abort()
      finish({ text: '', error: `Subagent attempt timed out after ${Math.round(SUBAGENT_ATTEMPT_TIMEOUT_MS / 1000)}s` })
    }, SUBAGENT_ATTEMPT_TIMEOUT_MS)
    timer.unref?.()

    try {
      void runAgent({
        messages: [{
          role: 'user',
          content: `TASK: ${run.task}\n\nComplete this task with your tools, then produce your final structured output.`,
        }] as any,
        onDone: text => finish({ text }),
        onError: error => finish({ text: '', error }),
        options: { maxSteps: SUBAGENT_DEFINITIONS[run.kind].maxSteps },
        toolsOverride: tools,
        systemPromptOverride: SUBAGENT_DEFINITIONS[run.kind].systemPrompt,
        abortController: attemptAbort,
      }).catch((err: unknown) => {
        // runAgent rejecting synchronously/asyncly (it normally resolves via
        // onError) becomes a typed failure rather than a hang.
        finish({ text: '', error: err instanceof Error ? err.message : String(err) })
      })
    } catch (error) {
      finish({ text: '', error: error instanceof Error ? error.message : String(error) })
    }
  })
}

async function attemptLoop(run: ManagedRun, parentSignal?: AbortSignal): Promise<SubagentResult> {
  const startedAt = Date.now()
  let attempts = 0

  for (;;) {
    if (parentSignal?.aborted || run.abortController.signal.aborted) {
      settleRun(run, 'cancelled', cancelledResult(run))
      return run.result!
    }

    attempts += 1
    note(run, `attempt:${attempts}`)
    const outcome = await runAttemptOnce(run, parentSignal)

    if (!outcome.error) {
      if (outcome.text.trim()) {
        const result: SubagentResult = {
          ok: true,
          kind: run.kind,
          summary: boundOutput(outcome.text),
          runId: run.id,
          telemetry: { durationMs: Date.now() - startedAt, attempts, queuedMs: startedAt - run.enqueuedAt },
        }
        settleRun(run, 'completed', result)
        recordRunSuccess()
        return result
      }
      // Empty output is fatal but NOT transient — retrying identical work
      // reproduces the same emptiness (deterministic-failure veto).
      const result: SubagentResult = { ok: false, kind: run.kind, summary: '', runId: run.id, error: 'Subagent finished without producing output.', code: 'EMPTY_OUTPUT' }
      settleRun(run, 'failed', result)
      recordRunFailure()
      return result
    }

    const { cls, code } = classifyFailure(outcome.error)

    if (cls === 'cancelled') {
      settleRun(run, 'cancelled', cancelledResult(run))
      return run.result!
    }

    if (cls === 'transient' && attempts <= MAX_TRANSIENT_RETRIES) {
      note(run, `transient-retry:${attempts}`)
      logger.warn('orchestration', `run ${run.id} transient failure (attempt ${attempts}), backing off: ${outcome.error.slice(0, 120)}`)
      await sleepWithAbort(jitteredBackoffMs(attempts - 1), parentSignal)
      continue
    }

    const result: SubagentResult = {
      ok: false,
      kind: run.kind,
      summary: '',
      runId: run.id,
      error: outcome.error,
      code,
      telemetry: { durationMs: Date.now() - startedAt, attempts, queuedMs: startedAt - run.enqueuedAt },
    }
    settleRun(run, cls === 'timeout' ? 'timeout' : 'failed', result)
    recordRunFailure()
    return result
  }
}

function cancelledResult(run: ManagedRun): SubagentResult {
  return { ok: false, kind: run.kind, summary: '', runId: run.id, error: 'cancelled', code: 'CANCELLED' }
}

function startAttemptLoop(run: ManagedRun): void {
  run.startedAt = Date.now()
  run.state = 'running'
  note(run, 'started')
  // Fire-and-forget: the deferred promise carries the outcome; an escaped
  // exception still settles the run instead of leaving it running forever.
  // The loop runs inside a spawn-depth zone so any nested executeSubagent in
  // its async shadow is rejected (structural no-recursion).
  const currentDepth = spawnDepth.getStore()?.depth ?? 0
  void spawnDepth.run({ depth: currentDepth + 1 }, () => attemptLoop(run))
    .catch((error: unknown) => {
      logger.error('orchestration', `run ${run.id} attempt loop escaped`, error)
      settleRun(run, 'failed', {
        ok: false, kind: run.kind, summary: '', runId: run.id,
        error: error instanceof Error ? error.message : String(error), code: 'ALL_MODELS_FAILED',
      })
    })
}

// ─── Public managed API ─────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** Parent run's controller: stopping the chat stops delegated work. */
  abortController?: AbortController
}

/**
 * Execute one managed subagent delegation: sanitized input, admission queue,
 * timeout enforcement, transient-only retries, settle-once registry
 * bookkeeping, and a foreground budget that auto-backgrounds long runs.
 */
export async function executeSubagent(
  input: { kind: SubagentKind; task: string; context?: string },
  options: ExecuteOptions = {},
): Promise<SubagentResult> {
  // Depth guard: a nested delegation inside another subagent's async context
  // is rejected before any resource is touched.
  const depth = spawnDepth.getStore()?.depth ?? 0
  if (depth >= 1) {
    return {
      ok: false,
      kind: isSubagentKind(input.kind) ? input.kind : 'researcher',
      summary: '',
      error: 'Subagents cannot spawn further subagents.',
      code: 'DEPTH_EXCEEDED',
    }
  }

  if (!isSubagentKind(input.kind)) {
    return { ok: false, kind: 'researcher', summary: '', error: `Unknown subagent kind: ${String(input.kind)}`, code: 'UNKNOWN_KIND' }
  }
  if (!input.task || !input.task.trim()) {
    return { ok: false, kind: input.kind, summary: '', error: 'Subagent task must not be empty.', code: 'EMPTY_TASK' }
  }

  const remainingCooldown = subagentCooldownRemainingMs()
  if (remainingCooldown > 0) {
    return {
      ok: false,
      kind: input.kind,
      summary: '',
      error: `Subagent spawns are cooling down after repeated failures. Retry in ~${Math.ceil(remainingCooldown / 1000)}s.`,
      code: 'COOLDOWN_ACTIVE',
    }
  }

  const run: ManagedRun = {
    id: `sub_${randomUUID().slice(0, 12)}`,
    kind: input.kind,
    task: input.task.trim(),
    state: 'queued',
    revision: 0,
    enqueuedAt: Date.now(),
    abortController: new AbortController(),
    deferred: undefined!,
    history: [],
  }
  note(run, 'created')
  run.deferred = new Promise<SubagentResult>(resolve => { run.resolveDeferred = resolve })

  // Cancellation forwarding: parent abort ⇒ run controller abort; a queued run
  // leaves the queue and settles immediately.
  let parentListener: (() => void) | undefined
  const parentSignal = options.abortController?.signal
  if (parentSignal) {
    if (parentSignal.aborted) run.abortController.abort()
    else {
      parentListener = () => {
        run.abortController.abort()
        if (run.state === 'queued') {
          const index = waitingQueue.indexOf(run)
          if (index >= 0) waitingQueue.splice(index, 1)
          settleRun(run, 'cancelled', cancelledResult(run))
        }
      }
      parentSignal.addEventListener('abort', parentListener, { once: true })
    }
  }

  // Release the parent listener exactly once, when the run first settles.
  const originalResolve = run.resolveDeferred?.bind(run)
  run.resolveDeferred = result => {
    if (parentListener && parentSignal) parentSignal.removeEventListener('abort', parentListener)
    originalResolve?.(result)
  }

  logger.info('orchestration', `delegating ${run.kind} (${activeRuns.size}/${MAX_CONCURRENT_SUBAGENTS} slots): ${run.task.slice(0, 80)}`)

  if (activeRuns.size >= MAX_CONCURRENT_SUBAGENTS) {
    waitingQueue.push(run)
    note(run, `queued:position=${waitingQueue.length}`)
  } else {
    activeRuns.set(run.id, run)
    startAttemptLoop(run)
  }

  // Foreground budget: block briefly, then hand back a pollable run id instead
  // of hanging the model's turn (auto-backgrounding). The race resolves with
  // whichever comes first — settlement or budget expiry.
  const raced = await Promise.race([
    run.deferred.then(result => ({ backgrounded: false as const, result })),
    sleepWithAbort(FOREGROUND_BUDGET_MS).then(() => ({ backgrounded: true as const })),
  ])

  if (raced.backgrounded) {
    note(run, 'auto-backgrounded')
    logger.info('orchestration', `run ${run.id} backgrounded after ${FOREGROUND_BUDGET_MS / 1000}s foreground budget`)
    return {
      ok: true,
      kind: run.kind,
      summary: `Still running. Poll get_subagent_output with runId "${run.id}" (non-blocking snapshot, or timeoutMs up to ${MAX_WAIT_BLOCK_MS / 1000}).`,
      runId: run.id,
      backgrounded: true,
    }
  }

  return raced.result
}

export interface SubagentOutputSnapshot {
  ok: boolean
  runId: string
  status: SubagentRunState
  summary?: string
  error?: string
  code?: SubagentErrorCode
  telemetry?: SubagentTelemetry
}

/**
 * Snapshot a run's output. Non-blocking by default; a positive timeoutMs
 * (capped at MAX_WAIT_BLOCK_MS) waits for settlement first.
 */
export async function getSubagentOutput(runId: string, timeoutMs?: number): Promise<SubagentOutputSnapshot> {
  const run = findRun(runId)
  if (!run) {
    return { ok: false, runId, status: 'failed', error: `Unknown subagent run: ${runId}`, code: 'UNKNOWN_RUN' }
  }

  if (!TERMINAL_RUN_STATES.has(run.state) && timeoutMs && timeoutMs > 0) {
    await Promise.race([run.deferred, sleepWithAbort(Math.min(timeoutMs, MAX_WAIT_BLOCK_MS))])
  }

  const snapshot: SubagentOutputSnapshot = { ok: true, runId: run.id, status: run.state }
  if (run.result) {
    snapshot.summary = run.result.summary
    snapshot.error = run.result.error
    snapshot.code = run.result.code
    snapshot.telemetry = run.result.telemetry
  } else if (run.state === 'running') {
    snapshot.summary = ''
  }
  return snapshot
}

/** Cancel one run (queued entries leave the queue; running ones abort). */
export function cancelSubagent(runId: string): boolean {
  const run = findRun(runId)
  if (!run || TERMINAL_RUN_STATES.has(run.state)) return false
  if (run.state === 'queued') {
    const index = waitingQueue.indexOf(run)
    if (index >= 0) waitingQueue.splice(index, 1)
  }
  run.abortController.abort()
  settleRun(run, 'cancelled', cancelledResult(run))
  return true
}

/**
 * Teardown fan-out (chat stop, window close, app quit): cancels running runs,
 * rejects queued ones, settles every pending promise exactly once.
 */
export function teardownAllSubagents(reason: string): number {
  let torn = 0
  for (const run of [...activeRuns.values(), ...waitingQueue]) {
    if (TERMINAL_RUN_STATES.has(run.state)) continue
    torn += 1
    if (run.state === 'queued') {
      const index = waitingQueue.indexOf(run)
      if (index >= 0) waitingQueue.splice(index, 1)
    }
    run.abortController.abort()
    settleRun(run, 'cancelled', cancelledResult(run))
  }
  if (torn > 0) logger.info('orchestration', `torn down ${torn} subagent run(s): ${reason}`)
  return torn
}

function findRun(runId: string): ManagedRun | undefined {
  return activeRuns.get(runId) ?? completedBuffer.get(runId)
}

export function activeSubagentCount(): number {
  return activeRuns.size + waitingQueue.length
}

/**
 * Run `fn` marked as inside a subagent context. Any executeSubagent call in
 * `fn`'s async shadow is rejected — structural no-recursion, defence in depth
 * behind the tool whitelists.
 */
export async function runWithSpawnDepth<T>(fn: () => Promise<T>): Promise<T> {
  const current = spawnDepth.getStore()?.depth ?? 0
  // Pass a THUNK, not the already-invoked promise: AsyncLocalStorage.run
  // applies the callback itself so the store covers fn's async shadow.
  return spawnDepth.run({ depth: current + 1 }, () => fn())
}

// ─── Tool surface (chat-only; capability 'orchestration') ───────────────────

import { z } from 'zod'

const subagentInputSchema = z.object({
  kind: z.enum(SUBAGENT_KINDS).describe('Which specialist to run.'),
  task: z.string().min(1).describe('Precise, self-contained instruction for the subagent. It cannot see this conversation — include post IDs, topic keywords, subreddit/handle names, and exactly what output you need.'),
  context: z.string().optional().describe('Optional supporting material (e.g. a research summary for the composer, prior findings for the intel updater).'),
})

const outputInputSchema = z.object({
  runId: z.string().min(1).describe('The runId returned by run_subagent (e.g. "sub_1a2b3c4d5e6f").'),
  timeoutMs: z.number().optional().describe(`Optional blocking wait in ms (max ${MAX_WAIT_BLOCK_MS}). Omit for an instant snapshot.`),
})

const cancelInputSchema = z.object({
  runId: z.string().min(1).describe('The runId of the delegated task to cancel.'),
})

export interface SubagentToolOptions {
  platforms?: { twitter?: boolean; reddit?: boolean }
  /** Parent run's controller: stopping the chat stops delegated work. */
  abortController?: AbortController
}

/**
 * Build the three chat-only delegation tools. The orchestrating model stays
 * owner of user interaction, approvals, media verification, and public
 * actions; these tools only manage bounded child work.
 */
export function createSubagentTools(options: SubagentToolOptions) {
  return {
    run_subagent: {
      description:
        'Delegate a bounded task to a specialist subagent. Kinds: "researcher" (read-only scans → structured research summary), "reply-crafter" (voice-matched reply drafts for given posts), "post-composer" (post variations from a research summary), "intel-updater" (performance analysis + memory/milestone/hook updates). Runs that exceed the foreground budget return backgrounded=true with a runId — poll get_subagent_output instead of re-delegating. The subagent CANNOT see this conversation, cannot ask the user anything, and can never publish.',
      parameters: subagentInputSchema,
      execute: async (input: { kind: SubagentKind; task: string; context?: string }) =>
        executeSubagent(input, { abortController: options.abortController }),
    },
    get_subagent_output: {
      description:
        'Retrieve the status/output of a delegated subagent run. Without timeoutMs: instant snapshot (status running/completed/failed/timeout/cancelled + summary when settled). With timeoutMs (≤60s): waits up to that long for settlement. Use after run_subagent returns backgrounded=true.',
      parameters: outputInputSchema,
      execute: async ({ runId, timeoutMs }: { runId: string; timeoutMs?: number }) => getSubagentOutput(runId, timeoutMs),
    },
    cancel_subagent: {
      description:
        'Cancel one delegated subagent run by its runId. Queued runs leave the queue; running ones are aborted at the next cancellation boundary. Settled runs cannot be cancelled.',
      parameters: cancelInputSchema,
      execute: async ({ runId }: { runId: string }) => {
        const cancelled = cancelSubagent(runId)
        return cancelled
          ? { ok: true, runId }
          : { ok: false, runId, error: 'No cancellable subagent run with that id.' }
      },
    },
  }
}
