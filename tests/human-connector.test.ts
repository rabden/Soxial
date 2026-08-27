import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AppErrorCategory } from '../src/types/app-error'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../electron/main/cli', () => ({
  runCli: vi.fn(),
  runTwitterCli: vi.fn(),
  ensureTwitterAuth: vi.fn(),
}))

import { ipcMain } from 'electron'
import { runTwitterCli, ensureTwitterAuth, type CliResult } from '../electron/main/cli'
import {
  HumanCliQueue,
  clampHumanCount,
  extractHumanItems,
  mapCliError,
  sanitizeCursor,
  toHumanPage,
} from '../electron/main/human-connector'
import { registerHumanHandlers } from '../electron/main/ipc/human'

const handlers: Record<string, Function> = {}

function okResult(overrides: Partial<CliResult> = {}): CliResult {
  return { ok: true, data: [], ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const [channel, handler] of Object.entries(handlers)) delete handlers[channel]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    handlers[channel] = handler
  })
  registerHumanHandlers()
})

describe('human connector — error code mapping (D6)', () => {
  const cases: Array<[string, AppErrorCategory, string | undefined, boolean]> = [
    ['not_authenticated', 'auth', 'reauthenticate', false],
    ['rate_limited', 'rate-limit', 'retry', true],
    ['not_found', 'validation', undefined, false],
    ['network_error', 'network', 'retry', true],
    ['query_id_error', 'network', 'retry', true],
    ['invalid_input', 'validation', undefined, false],
    ['api_error', 'internal', undefined, false],
  ]

  it.each(cases)('maps %s → %s', (code, category, action, retryable) => {
    const error = mapCliError({ error: 'upstream said no', errorCode: code })
    expect(error.category).toBe(category)
    expect(error.retryable).toBe(retryable)
    if (action) expect(error.action).toBe(action)
    else expect(error.action).toBeUndefined()
    expect(error.message).toBe('upstream said no')
  })

  it('rate-limited errors carry a 5-minute retryAfterMs', () => {
    expect(mapCliError({ errorCode: 'rate_limited' }).retryAfterMs).toBe(5 * 60 * 1000)
  })

  it('falls back to heuristic mapping when no structured code exists', () => {
    const error = mapCliError({ error: 'Too many requests: rate limit exceeded' })
    expect(error.category).toBe('rate-limit')
    expect(error.retryable).toBe(true)
  })
})

describe('human connector — input hygiene', () => {
  it('defaults count to the page size and clamps to the cap', () => {
    expect(clampHumanCount(undefined)).toBe(10)
    expect(clampHumanCount(0)).toBe(10)
    expect(clampHumanCount(-5)).toBe(10)
    expect(clampHumanCount(3.9)).toBe(3)
    expect(clampHumanCount(500)).toBe(100)
    expect(clampHumanCount(NaN)).toBe(10)
  })

  it('accepts opaque cursor tokens and rejects anything flag-like or non-token', () => {
    expect(sanitizeCursor('abc123_XYZ')).toBe('abc123_XYZ')
    expect(sanitizeCursor(undefined)).toBeUndefined()
    expect(sanitizeCursor('--inject-flag')).toBeUndefined()
    expect(sanitizeCursor('has space')).toBeUndefined()
    expect(sanitizeCursor('new\nline')).toBeUndefined()
    expect(sanitizeCursor(42 as any)).toBeUndefined()
    expect(sanitizeCursor('x'.repeat(257))).toBeUndefined()
  })
})

describe('human connector — pagination extraction', () => {
  it('extracts items from array, {data:[]} and {items:[]} envelopes', () => {
    expect(extractHumanItems(okResult({ data: [{ id: '1' }] }))).toEqual([{ id: '1' }])
    expect(extractHumanItems(okResult({ data: { data: [{ id: '2' }] } }))).toEqual([{ id: '2' }])
    expect(extractHumanItems(okResult({ data: { items: [{ id: '3' }] } }))).toEqual([{ id: '3' }])
    expect(extractHumanItems(okResult({ data: null }))).toEqual([])
  })

  it('turns a cursor into hasMore and omits it when absent', () => {
    const withCursor = toHumanPage(okResult({ data: [{ id: '1' }], nextCursor: 'next-token' }))
    expect(withCursor).toEqual({ items: [{ id: '1' }], nextCursor: 'next-token', hasMore: true })

    const withoutCursor = toHumanPage(okResult({ data: [{ id: '1' }] }))
    expect(withoutCursor.hasMore).toBe(false)
    expect(withoutCursor.nextCursor).toBeUndefined()
  })
})

describe('human connector — queue (D5)', () => {
  it('caps concurrency per bin and drains FIFO', async () => {
    const queue = new HumanCliQueue(1)
    let active = 0
    let maxActive = 0
    const order: number[] = []

    const task = (n: number) => async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      order.push(n)
      active--
    }

    await Promise.all([queue.run('twitter', task(1)), queue.run('twitter', task(2)), queue.run('twitter', task(3))])
    expect(maxActive).toBe(1)
    expect(order).toEqual([1, 2, 3])
  })

  it('allows up to the configured concurrency in parallel', async () => {
    const queue = new HumanCliQueue(2)
    let active = 0
    let maxActive = 0
    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    }
    await Promise.all(Array.from({ length: 4 }, () => queue.run('twitter', task)))
    expect(maxActive).toBe(2)
  })

  it('tracks bins independently', async () => {
    const queue = new HumanCliQueue(1)
    let active = 0
    let maxActive = 0
    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    }
    await Promise.all([queue.run('twitter', task), queue.run('rdt', task)])
    expect(maxActive).toBe(2)
  })
})

describe('human:feed handler — connector seam', () => {
  it('gates on session first and never invokes the connector when unauthenticated', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: false,
      data: null,
      error: 'No Twitter cookies found',
    } as CliResult)

    const result = await handlers['human:feed']({}, { type: 'for-you' })

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
    expect(result.error.action).toBe('reauthenticate')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('builds full-mode, --json arguments with type, count and cursor', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: true,
      data: { authenticated: true, user: { screenName: 'me' } },
    } as CliResult)
    vi.mocked(runTwitterCli).mockResolvedValue(okResult({ data: [{ id: '1' }], nextCursor: 'tok_1' }))

    const result = await handlers['human:feed']({}, { type: 'following', count: 25, cursor: 'tok_0' })

    expect(runTwitterCli).toHaveBeenCalledWith(
      ['feed', '--json', '-t', 'following', '-n', '25', '--cursor', 'tok_0'],
      { compact: false, timeoutMs: 30_000 },
    )
    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: '1' }], nextCursor: 'tok_1', hasMore: true },
    })
  })

  it('defaults type/count and drops unsafe cursors', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: true,
      data: { authenticated: true, user: null },
    } as CliResult)
    vi.mocked(runTwitterCli).mockResolvedValue(okResult({ data: [] }))

    await handlers['human:feed']({}, { type: 'nonsense' as any, count: 9999, cursor: 'bad cursor!' })

    expect(runTwitterCli).toHaveBeenCalledWith(['feed', '--json', '-t', 'for-you', '-n', '100'], {
      compact: false,
      timeoutMs: 30_000,
    })
  })

  it('maps structured connector errors into the typed error model', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: true,
      data: { authenticated: true, user: null },
    } as CliResult)
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'rate limited',
      errorCode: 'rate_limited',
    } as CliResult)

    const result = await handlers['human:feed']({}, {})

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('rate-limit')
    expect(result.error.retryAfterMs).toBe(5 * 60 * 1000)
  })
})

describe('human:verifySession handler', () => {
  it('returns the session user when authenticated', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: true,
      data: { authenticated: true, user: { screenName: 'alice', name: 'Alice' } },
    } as CliResult)

    const result = await handlers['human:verifySession']({}, undefined)

    expect(result).toEqual({
      ok: true,
      data: { authenticated: true, user: { screenName: 'alice', name: 'Alice' } },
    })
  })

  it('returns a typed auth error when the session is missing', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({
      ok: false,
      data: null,
      error: 'No cookies',
    } as CliResult)

    const result = await handlers['human:verifySession']({}, undefined)

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
  })
})
