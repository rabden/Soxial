import { describe, expect, it } from 'vitest'
import { PendingRequestRegistry } from '../electron/main/onboarding-recovery'

describe('onboarding pending request lifecycle', () => {
  it('resolves authentication retry requests exactly once', async () => {
    const registry = new PendingRequestRegistry<'retry' | 'abort'>()
    const request = registry.wait('auth_1')
    expect(registry.size).toBe(1)
    expect(registry.resolve('auth_1', 'retry')).toBe(true)
    expect(registry.resolve('auth_1', 'retry')).toBe(false)
    await expect(request).resolves.toBe('retry')
    expect(registry.size).toBe(0)
  })

  it('cancels all pending requests when the app closes', async () => {
    const registry = new PendingRequestRegistry<'abort'>()
    const first = registry.wait('auth_1')
    const second = registry.wait('auth_2')
    registry.cancelAll('abort')
    await expect(first).resolves.toBe('abort')
    await expect(second).resolves.toBe('abort')
    expect(registry.size).toBe(0)
  })
})
