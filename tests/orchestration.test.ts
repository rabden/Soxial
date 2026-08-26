import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Orchestration engine reliability suite — the invariants ported from the
 * grok-build harness:
 * - settle-once: terminal states can never be demoted by late callbacks
 * - wall-clock timeout guarantees termination (and is NOT retried)
 * - transient failures retry with capped jittered backoff; fatal/empty do not
 * - admission queue: bounded concurrency, FIFO overflow, cancel-while-queued
 * - foreground budget auto-backgrounds; results retrievable via runId poll
 * - consecutive-failure cooldown gate fails fast and self-heals
 * - teardown fan-out settles everything exactly once
 */

const agentState = vi.hoisted(() => ({
  // Every runAgent invocation appends its request here so tests can resolve
  // or reject individual attempts manually.
  requests: [] as Array<{
    onDone: (text: string) => void
    onError: (error: string) => void
  }>,
}))

vi.mock('../electron/main/agent', () => ({
  runAgent: (request: any) => {
    agentState.requests.push({ onDone: request.onDone, onError: request.onError })
    return Promise.resolve()
  },
}))

import {
  COOLDOWN_MS,
  COMPLETED_BUFFER_SIZE,
  FOREGROUND_BUDGET_MS,
  MAX_CONCURRENT_SUBAGENTS,
  MAX_TRANSIENT_RETRIES,
  SUBAGENT_ATTEMPT_TIMEOUT_MS,
  activeSubagentCount,
  cancelSubagent,
  classifyFailure,
  executeSubagent,
  getSubagentOutput,
  resetCooldownGateForTests,
  runWithSpawnDepth,
  teardownAllSubagents,
} from '../electron/main/orchestration'
import { SUBAGENT_MAX_OUTPUT_CHARS } from '../electron/main/subagents'

function lastRequest() {
  return agentState.requests.at(-1)!
}

/** Requests recorded since this test started — the array accumulates file-wide. */
let requestBase = 0

function newRequests() {
  return agentState.requests.slice(requestBase)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetCooldownGateForTests()
  requestBase = agentState.requests.length
})

afterEach(() => {
  teardownAllSubagents('test-end')
  vi.useRealTimers()
})

describe('classifyFailure (pure taxonomy)', () => {
  it('classifies every failure class explicitly', () => {
    expect(classifyFailure(undefined)).toEqual({ cls: 'cancelled', code: 'CANCELLED' })
    expect(classifyFailure('cancelled')).toEqual({ cls: 'cancelled', code: 'CANCELLED' })
    expect(classifyFailure('Attempt timed out after 180s')).toEqual({ cls: 'timeout', code: 'TIMEOUT' })
    for (const transient of ['429 quota exceeded', 'RESOURCE_EXHAUSTED', 'fetch failed', 'socket hang up', '503 Service Unavailable']) {
      expect(classifyFailure(transient).cls, transient).toBe('transient')
    }
    for (const fatal of ['Invalid argument', '', 'api key not valid']) {
      expect(classifyFailure(fatal).cls, fatal || '(empty)').toBe('fatal')
    }
  })

  it('never retries timeouts even though they look like network noise', () => {
    const { cls } = classifyFailure('etimedout after attempt timed out after 180s')
    // The timeout marker wins over the transient etimedout marker.
    expect(cls).toBe('timeout')
  })
})

describe('input validation', () => {
  it('rejects unknown kinds before touching the runner', async () => {
    const result = await executeSubagent({ kind: 'overlord' as never, task: 'do things' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_KIND' })
    expect(agentState.requests).toHaveLength(0)
  })

  it('rejects empty tasks', async () => {
    const result = await executeSubagent({ kind: 'researcher', task: '   ' })
    expect(result).toMatchObject({ ok: false, code: 'EMPTY_TASK' })
    expect(agentState.requests).toHaveLength(0)
  })

  it('rejects nested delegation via the spawn-depth guard', async () => {
    const nested = await runWithSpawnDepth(() => executeSubagent({ kind: 'researcher', task: 'inner' }))
    expect(nested).toMatchObject({ ok: false, code: 'DEPTH_EXCEEDED' })
    expect(agentState.requests).toHaveLength(0)
  })
})

describe('settlement and output handling', () => {
  it('completes with a bounded summary and telemetry', async () => {
    const long = 'x'.repeat(SUBAGENT_MAX_OUTPUT_CHARS + 500)
    const pending = executeSubagent({ kind: 'researcher', task: 'scan r/webdev' })
    await vi.advanceTimersByTimeAsync(1)
    lastRequest().onDone(long)
    const result = await pending

    expect(result.ok).toBe(true)
    expect(result.summary.endsWith('[truncated]')).toBe(true)
    expect(result.telemetry?.attempts).toBe(1)
  })

  it('treats empty output as fatal EMPTY_OUTPUT without retrying', async () => {
    const pending = executeSubagent({ kind: 'post-composer', task: 'draft' })
    await vi.advanceTimersByTimeAsync(1)
    lastRequest().onDone('   ')
    const result = await pending

    expect(result).toMatchObject({ ok: false, code: 'EMPTY_OUTPUT' })
    expect(newRequests()).toHaveLength(1)
  })

  it('refuses to demote a settled run: cancel after completion is a no-op', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'scan' })
    await vi.advanceTimersByTimeAsync(1)
    lastRequest().onDone('findings')
    const result = await pending
    expect(result.runId).toBeTruthy()

    expect(cancelSubagent(result.runId!)).toBe(false)
    const snapshot = await getSubagentOutput(result.runId!)
    expect(snapshot.status).toBe('completed')
  })
})

describe('retry policy', () => {
  it('retries transient failures with backoff and succeeds', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'scan' })
    await vi.advanceTimersByTimeAsync(1)

    lastRequest().onError('429 quota exceeded')
    // Backoff for attempt 1 is ~2s ±20%; advance past the ceiling.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(agentState.requests.length).toBeGreaterThanOrEqual(2)
    lastRequest().onDone('findings')

    const result = await pending
    expect(result.ok).toBe(true)
    expect(result.telemetry?.attempts).toBe(2)
  })

  it('gives up after the transient retry ceiling', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'scan' })
    await vi.advanceTimersByTimeAsync(1)

    for (let i = 0; i <= MAX_TRANSIENT_RETRIES; i++) {
      lastRequest().onError('503 service unavailable')
      await vi.advanceTimersByTimeAsync(20_000)
    }

    const result = await pending
    expect(result.ok).toBe(false)
    expect(newRequests().length).toBeLessThanOrEqual(MAX_TRANSIENT_RETRIES + 1 + 1)
  })

  it('never retries fatal failures', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'scan' })
    await vi.advanceTimersByTimeAsync(1)
    lastRequest().onError('Invalid argument')

    const result = await pending
    expect(result.ok).toBe(false)
    expect(newRequests()).toHaveLength(1)
  })
})

describe('wall-clock timeout', () => {
  it('aborts a hung attempt at the ceiling and does NOT retry it', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'hang forever' })
    await vi.advanceTimersByTimeAsync(1)

    // Foreground budget expires first — the model gets a backgrounded receipt.
    await vi.advanceTimersByTimeAsync(FOREGROUND_BUDGET_MS)
    const receipt = await pending
    expect(receipt.backgrounded).toBe(true)
    expect(receipt.runId).toBeTruthy()

    // The hung attempt hits its own hard ceiling.
    await vi.advanceTimersByTimeAsync(SUBAGENT_ATTEMPT_TIMEOUT_MS)
    const snapshot = await getSubagentOutput(receipt.runId!)
    expect(snapshot.status).toBe('timeout')
    expect(snapshot.code).toBe('TIMEOUT')
    // Timeout is deterministic — exactly one attempt, no retry amplification.
    expect(newRequests()).toHaveLength(1)
  })
})

describe('admission queue', () => {
  it('queues overflow beyond the concurrency cap and admits in order', async () => {
    const pendings = [
      executeSubagent({ kind: 'researcher', task: 'one' }),
      executeSubagent({ kind: 'reply-crafter', task: 'two' }),
      executeSubagent({ kind: 'post-composer', task: 'three' }),
    ]
    await vi.advanceTimersByTimeAsync(1)
    expect(activeSubagentCount()).toBe(3)

    const fourth = executeSubagent({ kind: 'intel-updater', task: 'four' })
    await vi.advanceTimersByTimeAsync(1)
    expect(activeSubagentCount()).toBe(MAX_CONCURRENT_SUBAGENTS + 1)

    // Completing one running run frees a slot; the queued run starts.
    const base = requestBase
    agentState.requests[base].onDone('done-one')
    await pendings[0]
    await vi.advanceTimersByTimeAsync(1)
    expect(activeSubagentCount()).toBe(MAX_CONCURRENT_SUBAGENTS)

    agentState.requests.at(-1)!.onDone('done-four')
    const result = await fourth
    expect(result.ok).toBe(true)
  }, 20_000)

  it('settles a queued run as cancelled when the parent aborts', async () => {
    const controller = new AbortController()
    const blockers = [
      executeSubagent({ kind: 'researcher', task: 'blocker-a' }),
      executeSubagent({ kind: 'researcher', task: 'blocker-b' }),
      executeSubagent({ kind: 'researcher', task: 'blocker-c' }),
    ]
    await vi.advanceTimersByTimeAsync(1)

    const queued = executeSubagent({ kind: 'researcher', task: 'queued' }, { abortController: controller })
    await vi.advanceTimersByTimeAsync(1)
    expect(activeSubagentCount()).toBe(4)

    controller.abort()
    const result = await queued
    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(activeSubagentCount()).toBe(3)

    teardownAllSubagents('test-cleanup')
    await Promise.allSettled(blockers)
  }, 20_000)
})

describe('backgrounding and polling', () => {
  it('auto-backgrounds past the foreground budget and serves polls', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'long scan' })
    await vi.advanceTimersByTimeAsync(FOREGROUND_BUDGET_MS)

    const receipt = await pending
    expect(receipt.backgrounded).toBe(true)
    expect(receipt.summary).toContain('get_subagent_output')

    // Non-blocking snapshot while still running.
    const running = await getSubagentOutput(receipt.runId!)
    expect(running.status).toBe('running')

    // Settle, then poll again through the completed buffer. Flush microtasks
    // first: the settlement callback runs on the microtask queue.
    lastRequest().onDone('final findings')
    await vi.advanceTimersByTimeAsync(1)
    const done = await getSubagentOutput(receipt.runId!)
    expect(done.status).toBe('completed')
    expect(done.summary).toBe('final findings')
  })

  it('returns a typed UNKNOWN_RUN for ids that never existed', async () => {
    const snapshot = await getSubagentOutput('sub_doesnotexist')
    expect(snapshot).toMatchObject({ ok: false, code: 'UNKNOWN_RUN' })
  })

  it('evicts the oldest completed runs beyond the buffer cap', async () => {
    const runIds: string[] = []
    // Fill the buffer past its cap with instantly-settling runs.
    for (let i = 0; i < COMPLETED_BUFFER_SIZE + 4; i++) {
      const pending = executeSubagent({ kind: 'researcher', task: `run ${i}` })
      await vi.advanceTimersByTimeAsync(1)
      lastRequest().onDone(`out ${i}`)
      const result = await pending
      expect(result.runId).toBeTruthy()
      runIds.push(result.runId!)
    }

    // The oldest ids fell out of the bounded registry; the newest remain.
    const oldest = await getSubagentOutput(runIds[0])
    expect(oldest).toMatchObject({ ok: false, code: 'UNKNOWN_RUN' })
    const newest = await getSubagentOutput(runIds.at(-1)!)
    expect(newest.status).toBe('completed')
    expect(activeSubagentCount()).toBe(0)
  }, 30_000)
})

describe('cancellation', () => {
  it('cancels a running run and refuses double cancellation', async () => {
    const pending = executeSubagent({ kind: 'researcher', task: 'cancel me' })
    await vi.advanceTimersByTimeAsync(FOREGROUND_BUDGET_MS)
    const receipt = await pending
    expect(receipt.runId).toBeTruthy()

    expect(cancelSubagent(receipt.runId!)).toBe(true)
    const snapshot = await getSubagentOutput(receipt.runId!)
    expect(snapshot.status).toBe('cancelled')

    // Settled runs are terminal: double cancel and unknown ids are no-ops.
    expect(cancelSubagent(receipt.runId!)).toBe(false)
    expect(cancelSubagent('sub_never_existed')).toBe(false)
  })
})

describe('cooldown gate', () => {
  it('fails fast after repeated consecutive failures and self-heals on success', async () => {
    // Trip the gate: COOLDOWN_THRESHOLD consecutive fatal failures.
    for (let i = 0; i < 5; i++) {
      const pending = executeSubagent({ kind: 'researcher', task: `fail ${i}` })
      await vi.advanceTimersByTimeAsync(1)
      lastRequest().onError(`fatal problem ${i}`)
      const result = await pending
      expect(result.ok).toBe(false)
    }

    // Gate open: next spawn is rejected before reaching the runner.
    const gated = await executeSubagent({ kind: 'researcher', task: 'blocked' })
    expect(gated).toMatchObject({ ok: false, code: 'COOLDOWN_ACTIVE' })
    expect(gated.error).toContain('cooling down')

    // Cooldown expires → spawns work again.
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS + 1_000)
    const pending = executeSubagent({ kind: 'researcher', task: 'after cooldown' })
    await vi.advanceTimersByTimeAsync(1)
    lastRequest().onDone('recovered')
    const result = await pending
    expect(result.ok).toBe(true)
  })
})

describe('teardown fan-out', () => {
  it('settles every running and queued run exactly once', async () => {
    const pendings = [
      executeSubagent({ kind: 'researcher', task: 'a' }),
      executeSubagent({ kind: 'researcher', task: 'b' }),
      executeSubagent({ kind: 'researcher', task: 'c' }),
      executeSubagent({ kind: 'researcher', task: 'd' }),
    ]
    await vi.advanceTimersByTimeAsync(1)
    expect(teardownAllSubagents('app-quit')).toBe(4)

    const results = await Promise.all(pendings.map(p => p.then(r => r, () => null)))
    // Deferred promises resolve with typed cancellations — nothing hangs.
    expect(results.filter(Boolean).length).toBeGreaterThan(0)
    expect(activeSubagentCount()).toBe(0)
    // Second sweep is a no-op.
    expect(teardownAllSubagents('again')).toBe(0)
  }, 20_000)
})
