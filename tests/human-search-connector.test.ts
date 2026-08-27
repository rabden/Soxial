import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

vi.mock('../electron/main/cli', () => ({
  runCli: vi.fn(),
  runTwitterCli: vi.fn(),
  ensureTwitterAuth: vi.fn(),
}))

import { ipcMain } from 'electron'
import { runTwitterCli, ensureTwitterAuth, type CliResult } from '../electron/main/cli'
import { registerHumanHandlers } from '../electron/main/ipc/human'

const handlers: Record<string, Function> = {}

function authedSession(): CliResult {
  return {
    ok: true,
    data: { authenticated: true, user: { screenName: 'me', name: 'Me' } },
  } as CliResult
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const channel of Object.keys(handlers)) delete handlers[channel]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    handlers[channel] = handler
  })
  registerHumanHandlers()
})

describe('human:search handler — connector seam (T7)', () => {
  it('builds a minimal query in full mode with --json and the default product', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [{ id: '1' }] } as CliResult)

    await handlers['human:search']({}, { query: 'hello world' })

    expect(runTwitterCli).toHaveBeenCalledWith(['search', 'hello world', '--json', '-t', 'Top', '-n', '10'], {
      compact: false,
      timeoutMs: 30_000,
    })
  })

  it('passes through product, count and the until window', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [] } as CliResult)

    await handlers['human:search']({}, { query: 'cats', product: 'Latest', count: 5, until: '2026-08-01' })

    expect(runTwitterCli).toHaveBeenCalledWith(
      ['search', 'cats', '--json', '-t', 'Latest', '-n', '5', '--until', '2026-08-01'],
      { compact: false, timeoutMs: 30_000 },
    )
  })

  it('passes through surfaced filters with validated handles, lang and dates', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [] } as CliResult)

    await handlers['human:search'](
      {},
      {
        query: 'ship it',
        product: 'Videos',
        from: '@elonmusk',
        to: 'naval',
        lang: 'EN',
        since: '2026-01-01',
        has: ['videos', 'links'],
        exclude: ['retweets'],
        minLikes: 50,
        minRetweets: 0,
      },
    )

    expect(runTwitterCli).toHaveBeenCalledWith(
      [
        'search',
        'ship it',
        '--json',
        '-t',
        'Videos',
        '-n',
        '10',
        '--from',
        'elonmusk',
        '--to',
        'naval',
        '--lang',
        'en',
        '--since',
        '2026-01-01',
        '--has',
        'videos',
        '--has',
        'links',
        '--exclude',
        'retweets',
        '--min-likes',
        '50',
        '--min-retweets',
        '0',
      ],
      { compact: false, timeoutMs: 30_000 },
    )
  })

  it('rejects empty, flag-like and oversized queries with a validation error', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())

    for (const query of ['', '   ', '-filter:replies', 'x'.repeat(501)]) {
      const result = await handlers['human:search']({}, { query })
      expect(result.ok).toBe(false)
      expect(result.error.category).toBe('validation')
    }
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('rejects invalid filter values without invoking the connector', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())

    const badFrom = await handlers['human:search']({}, { query: 'x', from: 'not a handle!' })
    expect(badFrom.error.category).toBe('validation')

    const badLang = await handlers['human:search']({}, { query: 'x', lang: 'eng' })
    expect(badLang.error.category).toBe('validation')

    const badSince = await handlers['human:search']({}, { query: 'x', since: 'yesterday' })
    expect(badSince.error.category).toBe('validation')

    const badHas = await handlers['human:search']({}, { query: 'x', has: ['audio' as any] })
    expect(badHas.error.category).toBe('validation')

    const badMin = await handlers['human:search']({}, { query: 'x', minLikes: 1.5 })
    expect(badMin.error.category).toBe('validation')

    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('gates on session first', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({ ok: false, data: null, error: 'no cookies' } as CliResult)

    const result = await handlers['human:search']({}, { query: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('maps connector errors and applies the windowed hasMore heuristic', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())

    vi.mocked(runTwitterCli).mockResolvedValueOnce({
      ok: false,
      data: null,
      error: 'slow down',
      errorCode: 'rate_limited',
    } as CliResult)
    const errored = await handlers['human:search']({}, { query: 'x' })
    expect(errored.error.category).toBe('rate-limit')

    vi.mocked(runTwitterCli).mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
    } as CliResult)
    const full = await handlers['human:search']({}, { query: 'x' })
    expect(full.data.hasMore).toBe(true)

    vi.mocked(runTwitterCli).mockResolvedValueOnce({ ok: true, data: [{ id: '1' }] } as CliResult)
    const partial = await handlers['human:search']({}, { query: 'x' })
    expect(partial.data.hasMore).toBe(false)
  })
})
