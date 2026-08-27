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

const rebuildActive = vi.fn(() => false)
vi.mock('../electron/main/twitter-handle-rebuild', () => ({
  isTwitterHandleRebuildActive: () => rebuildActive(),
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

function userItem(screenName: string, extra: Record<string, unknown> = {}) {
  return { screenName, name: screenName.toUpperCase(), bio: `bio of ${screenName}`, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  rebuildActive.mockReturnValue(false)
  for (const channel of Object.keys(handlers)) delete handlers[channel]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    handlers[channel] = handler
  })
  registerHumanHandlers()
})

describe('human:followList handler — connector seam (T6)', () => {
  it('builds list args per sub-tab with the own handle and grown count', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [userItem('bob')] } as CliResult)

    await handlers['human:followList']({}, { subTab: 'following', count: 20 })
    expect(runTwitterCli).toHaveBeenCalledWith(['following', 'me', '--json', '-n', '20'], {
      compact: false,
      timeoutMs: 30_000,
    })

    await handlers['human:followList']({}, { subTab: 'followers' })
    expect(runTwitterCli).toHaveBeenLastCalledWith(['followers', 'me', '--json', '-n', '10'], {
      compact: false,
      timeoutMs: 30_000,
    })
  })

  it('normalizes user rows (bio preserved) and stops at the 200 cap', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    const items = Array.from({ length: 200 }, (_, i) => userItem(`u${i}`, { verified: i % 2 === 0 }))
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: items } as CliResult)

    const result = await handlers['human:followList']({}, { subTab: 'followers', count: 5000 })

    expect(runTwitterCli).toHaveBeenCalledWith(['followers', 'me', '--json', '-n', '200'], {
      compact: false,
      timeoutMs: 30_000,
    })
    expect(result.data.items).toHaveLength(200)
    expect(result.data.items[0]).toMatchObject({ screenName: 'u0', bio: 'bio of u0', verified: true })
    expect(result.data.hasMore).toBe(false)
  })

  it('gates on session before invoking the connector', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({ ok: false, data: null, error: 'no cookies' } as CliResult)

    const result = await handlers['human:followList']({}, { subTab: 'following' })
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('maps connector errors through the typed model', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'slow down',
      errorCode: 'rate_limited',
    } as CliResult)

    const result = await handlers['human:followList']({}, { subTab: 'following' })
    expect(result.error.category).toBe('rate-limit')
  })
})

describe('human:followAction handler — connector seam (T6)', () => {
  it('invokes follow/unfollow writes in full mode and reports the new state', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: {} } as CliResult)

    const follow = await handlers['human:followAction']({}, { handle: 'bob', action: 'follow' })
    expect(runTwitterCli).toHaveBeenCalledWith(['follow', 'bob', '--json'], {
      compact: false,
      timeoutMs: 30_000,
    })
    expect(follow).toEqual({ ok: true, data: { handle: 'bob', following: true } })

    const unfollow = await handlers['human:followAction']({}, { handle: '@bob', action: 'unfollow' })
    expect(runTwitterCli).toHaveBeenLastCalledWith(['unfollow', 'bob', '--json'], {
      compact: false,
      timeoutMs: 30_000,
    })
    expect(unfollow.data).toEqual({ handle: 'bob', following: false })
  })

  it('blocks writes while a handle rebuild is active', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    rebuildActive.mockReturnValue(true)

    const result = await handlers['human:followAction']({}, { handle: 'bob', action: 'follow' })

    expect(result.ok).toBe(false)
    expect(result.error.message).toContain('rebuild')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('rejects invalid handles with a validation error', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())

    const result = await handlers['human:followAction']({}, { handle: 'not a handle!', action: 'follow' })

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('validation')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('gates on session first and maps write errors', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({ ok: false, data: null, error: 'nope' } as CliResult)
    const gated = await handlers['human:followAction']({}, { handle: 'bob', action: 'follow' })
    expect(gated.error.category).toBe('auth')

    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession())
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'cannot follow',
      errorCode: 'not_found',
    } as CliResult)
    const failed = await handlers['human:followAction']({}, { handle: 'ghost', action: 'follow' })
    expect(failed.ok).toBe(false)
    expect(failed.error.category).toBe('validation')
    expect(failed.error.code).toBe('TWITTER_NOT_FOUND')
  })
})
