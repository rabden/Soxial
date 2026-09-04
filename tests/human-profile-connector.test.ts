import { describe, expect, it, vi, beforeEach } from 'vitest'

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

const rebuildActive = vi.fn(() => false)
vi.mock('../electron/main/twitter-handle-rebuild', () => ({
  isTwitterHandleRebuildActive: () => rebuildActive(),
}))

import { ipcMain } from 'electron'
import { runTwitterCli, ensureTwitterAuth, type CliResult } from '../electron/main/cli'
import { normalizeHumanUser, sanitizeIsoDate, toWindowedHumanPage } from '../electron/main/human-connector'
import { registerHumanHandlers } from '../electron/main/ipc/human'

const handlers: Record<string, Function> = {}

function authedSession(handle = 'me') {
  return {
    ok: true,
    data: { authenticated: true, user: { screenName: handle, name: 'Me' } },
  } as CliResult
}

function whoamiResult(user: Record<string, unknown>): CliResult {
  return { ok: true, data: { user } }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const channel of Object.keys(handlers)) delete handlers[channel]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    handlers[channel] = handler
  })
  registerHumanHandlers()
})

describe('connector helpers (T4)', () => {
  it('sanitizes ISO dates and rejects anything else', () => {
    expect(sanitizeIsoDate('2026-08-27')).toBe('2026-08-27')
    expect(sanitizeIsoDate('2026-13-99')).toBeUndefined()
    expect(sanitizeIsoDate('2026-08-27T10:00:00Z')).toBeUndefined()
    expect(sanitizeIsoDate('--flag')).toBeUndefined()
    expect(sanitizeIsoDate(undefined)).toBeUndefined()
  })

  it('normalizes connector user dicts, aliasing username and dropping junk', () => {
    const user = normalizeHumanUser({
      id: 42,
      username: 'alice',
      name: 'Alice',
      bio: 'hi',
      followers: 12,
      verified: true,
      bogus: 'dropped',
    })
    expect(user).toEqual({
      id: '42',
      screenName: 'alice',
      name: 'Alice',
      bio: 'hi',
      followers: 12,
      verified: true,
    })
  })

  it('upgrades low-res X avatar suffixes to the 400x400 variant', () => {
    const user = normalizeHumanUser({
      screenName: 'alice',
      profileImageUrl: 'https://pbs.twimg.com/profile_images/1/abc_normal.jpg',
    })
    expect(user?.profileImageUrl).toBe('https://pbs.twimg.com/profile_images/1/abc_400x400.jpg')

    // Already-sized and bare URLs pass through untouched.
    const sized = normalizeHumanUser({ screenName: 'a', profileImageUrl: 'https://pbs.twimg.com/profile_images/1/abc_400x400.jpg' })
    expect(sized?.profileImageUrl).toBe('https://pbs.twimg.com/profile_images/1/abc_400x400.jpg')
    const bare = normalizeHumanUser({ screenName: 'a', profileImageUrl: 'https://x.com/a.png' })
    expect(bare?.profileImageUrl).toBe('https://x.com/a.png')
  })

  it('windowed pages flag hasMore only when the page came back full', () => {
    const full = toWindowedHumanPage({ ok: true, data: [{ id: '1' }] }, 1)
    expect(full.hasMore).toBe(true)
    const partial = toWindowedHumanPage({ ok: true, data: [{ id: '1' }] }, 10)
    expect(partial.hasMore).toBe(false)
  })
})

describe('human:profile handler — connector seam', () => {
  it('returns the normalized whoami user', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession() as any)
    vi.mocked(runTwitterCli).mockResolvedValue(
      whoamiResult({
        id: 7,
        name: 'Alice',
        username: 'alice',
        screenName: 'alice',
        bio: 'building',
        location: 'Berlin',
        url: 'https://alice.dev',
        followers: 1200,
        following: 300,
        tweets: 42,
        verified: true,
        profileImageUrl: 'https://x.com/a.png',
        createdAt: 'Tue Mar 05 12:00:00 +0000 2019',
      }),
    )

    const result = await handlers['human:profile']({}, undefined)

    expect(runTwitterCli).toHaveBeenCalledWith(['whoami', '--json'], {
      compact: false,
      timeoutMs: 30_000,
    })
    expect(result).toEqual({
      ok: true,
      data: {
        id: '7',
        screenName: 'alice',
        name: 'Alice',
        bio: 'building',
        location: 'Berlin',
        url: 'https://alice.dev',
        followers: 1200,
        following: 300,
        tweets: 42,
        verified: true,
        profileImageUrl: 'https://x.com/a.png',
        createdAt: 'Tue Mar 05 12:00:00 +0000 2019',
      },
    })
  })

  it('gates on session before invoking whoami', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue({ ok: false, data: null, error: 'no cookies', errorCode: 'not_authenticated' } as CliResult)

    const result = await handlers['human:profile']({}, undefined)

    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('auth')
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('fails typed when the payload has no usable user', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession() as any)
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: { user: null } } as CliResult)

    const result = await handlers['human:profile']({}, undefined)
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('internal')
  })
})

describe('human:profilePosts handler — connector seam', () => {
  it('builds Posts args: user-posts (native UserTweets timeline), count-growth', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [{ id: '1' }, { id: '2' }] } as CliResult)

    const result = await handlers['human:profilePosts']({}, { subTab: 'posts', count: 10 })

    expect(runTwitterCli).toHaveBeenCalledWith(
      ['user-posts', 'alice', '--json', '-n', '10'],
      { compact: false, timeoutMs: 30_000 },
    )
    expect(result).toEqual({ ok: true, data: { items: [{ id: '1' }, { id: '2' }], hasMore: false } })
  })

  it('builds Replies args with the filter:replies operator, Latest product and until window', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [] } as CliResult)

    await handlers['human:profilePosts']({}, { subTab: 'replies', count: 5, until: '2026-08-01' })

    expect(runTwitterCli).toHaveBeenCalledWith(
      ['search', 'filter:replies', '--json', '-t', 'Latest', '--from', 'alice', '-n', '5', '--until', '2026-08-01'],
      { compact: false, timeoutMs: 30_000 },
    )
  })

  it('marks a full Posts page under the cap as having more (count-growth heuristic)', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession() as any)
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
    } as CliResult)

    const result = await handlers['human:profilePosts']({}, { subTab: 'posts', count: 10 })
    expect(result.data.hasMore).toBe(true)
  })

  it('rejects a malformed until window and an invalid session handle', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('not a handle!') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [] } as CliResult)

    const badHandle = await handlers['human:profilePosts']({}, { subTab: 'posts' })
    expect(badHandle.ok).toBe(false)
    expect(badHandle.error.category).toBe('validation')
    expect(runTwitterCli).not.toHaveBeenCalled()

    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    await handlers['human:profilePosts']({}, { subTab: 'replies', until: 'garbage' })
    expect(runTwitterCli).toHaveBeenCalledWith(
      ['search', 'filter:replies', '--json', '-t', 'Latest', '--from', 'alice', '-n', '10'],
      { compact: false, timeoutMs: 30_000 },
    )
  })

  it('maps connector errors through the typed model', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession() as any)
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'no dice',
      errorCode: 'rate_limited',
    } as CliResult)

    const result = await handlers['human:profilePosts']({}, { subTab: 'posts' })
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('rate-limit')
  })
})

describe('human:reply handler — connector seam', () => {
  it('builds reply args: reply <id> <text> --json with images', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: true,
      data: { success: true, action: 'reply', id: '999', replyTo: '123', url: 'https://x.com/i/status/999' },
    } as CliResult)

    const result = await handlers['human:reply']({}, {
      tweetId: '123',
      text: 'my reply',
      imagePaths: ['/tmp/a.png', '/tmp/b.png'],
    })

    expect(runTwitterCli).toHaveBeenCalledWith(
      ['reply', '123', 'my reply', '--json', '-i', '/tmp/a.png', '-i', '/tmp/b.png'],
      { compact: false, timeoutMs: 30_000 },
    )
    expect(result).toEqual({
      ok: true,
      data: { tweetId: '999', replyTo: '123', url: 'https://x.com/i/status/999' },
    })
  })

  it('validates tweet id, text length and image paths before invoking the CLI', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: null } as CliResult)

    const badId = await handlers['human:reply']({}, { tweetId: 'abc', text: 'hi' })
    expect(badId.ok).toBe(false)
    expect(badId.error.category).toBe('validation')

    const emptyText = await handlers['human:reply']({}, { tweetId: '123', text: '   ' })
    expect(emptyText.ok).toBe(false)
    expect(emptyText.error.category).toBe('validation')

    const longText = await handlers['human:reply']({}, { tweetId: '123', text: 'x'.repeat(25_001) })
    expect(longText.ok).toBe(false)

    const flagPath = await handlers['human:reply']({}, { tweetId: '123', text: 'hi', imagePaths: ['-rf'] })
    expect(flagPath.ok).toBe(false)
    expect(runTwitterCli).not.toHaveBeenCalled()
  })

  it('gates on session and the rebuild lock before writing', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(
      { ok: false, data: null, error: 'no cookies', errorCode: 'not_authenticated' } as CliResult,
    )
    const noSession = await handlers['human:reply']({}, { tweetId: '123', text: 'hi' })
    expect(noSession.ok).toBe(false)
    expect(noSession.error.category).toBe('auth')

    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    rebuildActive.mockReturnValue(true)
    const locked = await handlers['human:reply']({}, { tweetId: '123', text: 'hi' })
    expect(locked.ok).toBe(false)
    expect(runTwitterCli).not.toHaveBeenCalled()
    rebuildActive.mockReturnValue(false)
  })

  it('maps connector errors through the typed model', async () => {
    vi.mocked(ensureTwitterAuth).mockResolvedValue(authedSession('alice') as any)
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'You attempted to reply to a Tweet that is deleted',
      errorCode: 'api_error',
    } as CliResult)

    const result = await handlers['human:reply']({}, { tweetId: '123', text: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.error.category).toBe('internal')
  })
})
