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

describe('human:bookmarks handler — connector seam (T5)', () => {
  it('gates on session before invoking the connector', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({ ok: false, data: null, error: 'no cookies' } as CliResult)

    const result = await handlers['human:bookmarks']({}, {})

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('requests the grown count in full mode with --json', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: true,
      data: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })),
    } as CliResult)

    const result = await handlers['human:bookmarks']({}, { count: 20 })

    expect(runTwitterCli).toHaveBeenCalledWith(['bookmarks', '--json', '-n', '20'], {
      compact: false,
      timeoutMs: 30_000,
    })
    expect(result.ok).toBe(true)
    expect(result.data.items).toHaveLength(20)
  })

  it('clamps the requested count to the connector hard cap of 200', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [] } as CliResult)

    await handlers['human:bookmarks']({}, { count: 5000 })

    expect(runTwitterCli).toHaveBeenCalledWith(['bookmarks', '--json', '-n', '200'], {
      compact: false,
      timeoutMs: 30_000,
    })
  })

  it('reports hasMore only while a full page sits under the cap', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())

    // Full page of 10 under the cap → probably more.
    vi.mocked(runTwitterCli).mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
    } as CliResult)
    expect((await handlers['human:bookmarks']({}, { count: 10 })).data.hasMore).toBe(true)

    // Partial page → done.
    vi.mocked(runTwitterCli).mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 3 }, (_, i) => ({ id: String(i) })),
    } as CliResult)
    expect((await handlers['human:bookmarks']({}, { count: 10 })).data.hasMore).toBe(false)

    // Full page at the cap → done.
    vi.mocked(runTwitterCli).mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })),
    } as CliResult)
    expect((await handlers['human:bookmarks']({}, { count: 200 })).data.hasMore).toBe(false)
  })

  it('maps connector errors through the typed model', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'slow down',
      errorCode: 'rate_limited',
    } as CliResult)

    const result = await handlers['human:bookmarks']({}, {})
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('rate-limit')
    expect(result.error.retryAfterMs).toBe(5 * 60 * 1000)
  })
})
