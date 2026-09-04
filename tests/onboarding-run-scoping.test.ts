import { describe, expect, it, vi } from 'vitest'
import {
  createOnboardingEventGate,
  isOnboardingEvent,
  type OnboardingEvent,
} from '../src/types/onboarding-events'
import { OnboardingRunRegistry } from '../electron/main/onboarding-registry'

function collector() {
  const events: OnboardingEvent[] = []
  const registry = new OnboardingRunRegistry(event => events.push(event))
  return { events, registry }
}

describe('onboarding event envelope', () => {
  it('stamps every event with run id and a monotonic sequence', () => {
    const { events, registry } = collector()
    registry.prepare('onboarding_a')

    registry.publish('onboarding_a', { type: 'phase', phase: 'gather' })
    registry.publish('onboarding_a', { type: 'text', text: 'hello' })
    registry.publish('onboarding_a', { type: 'text', text: ' world' })

    expect(events.map(e => e.sequence)).toEqual([1, 2, 3])
    expect(events.every(e => e.runId === 'onboarding_a')).toBe(true)
    expect(events.every(e => e.version === 1)).toBe(true)
    expect(events.every(e => isOnboardingEvent(e))).toBe(true)
  })

  it('drops events for runs that were never prepared', () => {
    const { events, registry } = collector()
    registry.publish('onboarding_ghost', { type: 'text', text: 'should not emit' })
    expect(events).toEqual([])
  })

  it('keeps sequences independent per run', () => {
    const { events, registry } = collector()
    registry.prepare('run_a')
    registry.prepare('run_b')

    registry.publish('run_a', { type: 'text', text: 'a1' })
    registry.publish('run_b', { type: 'text', text: 'b1' })
    registry.publish('run_a', { type: 'text', text: 'a2' })

    expect(events.filter(e => e.runId === 'run_a').map(e => e.sequence)).toEqual([1, 2])
    expect(events.filter(e => e.runId === 'run_b').map(e => e.sequence)).toEqual([1])
  })
})

describe('renderer event gate', () => {
  it('accepts in-order events for the active run', () => {
    const { events, registry } = collector()
    registry.prepare('run_active')
    const gate = createOnboardingEventGate('run_active')

    registry.publish('run_active', { type: 'text', text: 'one' })
    registry.publish('run_active', { type: 'text', text: 'two' })

    expect(events.every(event => gate.accept(event))).toBe(true)
    expect(gate.lastSequence).toBe(2)
  })

  it('ignores events from a stale run', () => {
    const { events, registry } = collector()
    registry.prepare('run_old')
    registry.prepare('run_new')
    const gate = createOnboardingEventGate('run_new')

    registry.publish('run_old', { type: 'text', text: 'stale output' })
    registry.publish('run_new', { type: 'text', text: 'live output' })

    const accepted = events.filter(event => gate.accept(event))
    expect(accepted).toHaveLength(1)
    expect(accepted[0].runId).toBe('run_new')
  })

  it('ignores duplicate and out-of-order delivery', () => {
    const gate = createOnboardingEventGate('run_dup')
    const event = (sequence: number): OnboardingEvent => ({
      version: 1,
      runId: 'run_dup',
      sequence,
      emittedAt: new Date().toISOString(),
      payload: { type: 'text', text: `chunk ${sequence}` },
    })

    expect(gate.accept(event(1))).toBe(true)
    expect(gate.accept(event(1))).toBe(false)
    expect(gate.accept(event(2))).toBe(true)
    expect(gate.accept(event(2))).toBe(false)
    // A late-arriving earlier event must not rewind the stream.
    expect(gate.accept(event(1))).toBe(false)
    expect(gate.lastSequence).toBe(2)
  })

  it('rejects malformed payloads', () => {
    const gate = createOnboardingEventGate('run_x')
    for (const bad of [null, undefined, {}, { runId: 'run_x' }, { version: 2, runId: 'run_x', sequence: 1, emittedAt: '', payload: { type: 'text' } }]) {
      expect(gate.accept(bad)).toBe(false)
    }
  })
})

describe('run lifecycle', () => {
  it('knows the run before execution begins', () => {
    const { registry } = collector()
    const run = registry.prepare('run_prepared')

    expect(run.state).toBe('prepared')
    expect(registry.canExecute('run_prepared')).toBe(true)
    expect(registry.isActive()).toBe(false)
  })

  it('rejects duplicate execution of a running run', () => {
    const { registry } = collector()
    registry.prepare('run_busy')
    registry.markRunning('run_busy')

    expect(registry.canExecute('run_busy')).toBe(false)
    expect(registry.isActive()).toBe(true)
  })

  it('rejects execution of an unknown run', () => {
    const { registry } = collector()
    expect(registry.canExecute('run_unknown')).toBe(false)
    expect(registry.markRunning('run_unknown')).toBeUndefined()
  })

  it('allows retrying a settled run', () => {
    const { registry } = collector()
    registry.prepare('run_retry')
    registry.markRunning('run_retry')
    registry.settle('run_retry', 'failed', 'MODEL_RATE_LIMITED')

    expect(registry.canExecute('run_retry')).toBe(true)
    expect(registry.isActive()).toBe(false)
  })

  it('gives a resumed run a fresh abort controller', () => {
    const { registry } = collector()
    registry.prepare('run_resume')
    const first = registry.markRunning('run_resume')!
    first.abortController.abort()

    const second = registry.markRunning('run_resume')!
    expect(second.abortController.signal.aborted).toBe(false)
  })

  it('reports the abort to the renderer as a run-scoped event', () => {
    const { events, registry } = collector()
    registry.prepare('run_cancel')
    const run = registry.markRunning('run_cancel')!
    const onAbort = vi.fn()
    run.abortController.signal.addEventListener('abort', onAbort)

    expect(registry.abort('run_cancel', 'cancelled', 'user-cancelled')).toBe(true)

    expect(onAbort).toHaveBeenCalledOnce()
    const last = events.at(-1)!
    expect(last.runId).toBe('run_cancel')
    expect(last.payload).toMatchObject({ type: 'cancelled', reason: 'user-cancelled' })
    expect(registry.isActive()).toBe(false)
  })
})
