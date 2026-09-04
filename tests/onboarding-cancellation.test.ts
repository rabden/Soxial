import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingInteractionRegistry } from '../electron/main/pending-interaction'

const FIVE_MINUTES = 5 * 60 * 1000

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('inactivity timeout', () => {
  it('pauses a pending questionnaire after five minutes', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const onTimeout = vi.fn()
    const wait = registry.wait('batch_1', { timeoutMs: FIVE_MINUTES, runId: 'run_1', onTimeout })

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)

    await expect(wait).resolves.toEqual({ status: 'timeout' })
    expect(onTimeout).toHaveBeenCalledWith('batch_1')
    expect(registry.size).toBe(0)
  })

  it('does not time out early', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const onTimeout = vi.fn()
    registry.wait('batch_2', { timeoutMs: FIVE_MINUTES, onTimeout })

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES - 1000)

    expect(onTimeout).not.toHaveBeenCalled()
    expect(registry.has('batch_2')).toBe(true)
  })

  it('accepts an answer submitted just before the deadline', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const onTimeout = vi.fn()
    const wait = registry.wait('batch_3', { timeoutMs: FIVE_MINUTES, onTimeout })

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES - 1000)
    expect(registry.resolve('batch_3', ['answered in time'])).toBe(true)
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)

    await expect(wait).resolves.toEqual({ status: 'answered', value: ['answered in time'] })
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('settles exactly once when an answer races the timeout', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const wait = registry.wait('batch_4', { timeoutMs: FIVE_MINUTES })

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)
    // The answer lost the race; the promise keeps its timeout outcome.
    expect(registry.resolve('batch_4', ['too late'])).toBe(false)

    await expect(wait).resolves.toEqual({ status: 'timeout' })
  })

  it('never times out when no budget is given', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    registry.wait('batch_5', {})
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 10)
    expect(registry.has('batch_5')).toBe(true)
  })
})

describe('cancellation', () => {
  it('settles a pending wait with a typed cancellation', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const wait = registry.wait('batch_c', { timeoutMs: FIVE_MINUTES, runId: 'run_c' })

    expect(registry.settleRun('run_c', { status: 'cancelled', reason: 'user-cancelled' })).toBe(1)

    await expect(wait).resolves.toEqual({ status: 'cancelled', reason: 'user-cancelled' })
  })

  it('cancels only the targeted run', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const first = registry.wait('b1', { runId: 'run_a' })
    registry.wait('b2', { runId: 'run_b' })

    expect(registry.settleRun('run_a', { status: 'cancelled', reason: 'superseded' })).toBe(1)

    await expect(first).resolves.toMatchObject({ status: 'cancelled' })
    expect(registry.has('b2')).toBe(true)
  })

  it('settles every pending wait on shutdown', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const first = registry.wait('b1', { timeoutMs: FIVE_MINUTES })
    const second = registry.wait('b2', { timeoutMs: FIVE_MINUTES })

    expect(registry.settleAll({ status: 'cancelled', reason: 'app-quit' })).toBe(2)

    await expect(first).resolves.toMatchObject({ status: 'cancelled', reason: 'app-quit' })
    await expect(second).resolves.toMatchObject({ status: 'cancelled', reason: 'app-quit' })
    expect(registry.size).toBe(0)
  })

  it('clears the timer on cancellation so no late callback fires', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const onTimeout = vi.fn()
    registry.wait('b1', { timeoutMs: FIVE_MINUTES, onTimeout })

    registry.settleAll({ status: 'cancelled', reason: 'app-quit' })
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 2)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('supersedes a duplicate id instead of leaking the first wait', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    const first = registry.wait('same_id', {})
    const second = registry.wait('same_id', {})

    await expect(first).resolves.toMatchObject({ status: 'cancelled', reason: 'superseded' })
    expect(registry.resolve('same_id', ['ok'])).toBe(true)
    await expect(second).resolves.toEqual({ status: 'answered', value: ['ok'] })
  })

  it('reports no pending work once everything settles', async () => {
    const registry = new PendingInteractionRegistry<string[]>()
    registry.wait('b1', { timeoutMs: FIVE_MINUTES })
    registry.resolve('b1', ['done'])
    expect(registry.size).toBe(0)
  })
})
