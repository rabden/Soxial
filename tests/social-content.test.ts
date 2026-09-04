/**
 * Social gathering parity tests (#44, #47).
 *
 * Locks the SearchTimeline-404 resilience: `fetchTwitterUserPosts` falls back
 * to UserTweets, `fetchTwitterReplies` degrades to ok-empty, Reddit pagination
 * keeps its cursor loop, and onboarding persists rows even when search 404s.
 *
 * Manual tight-loop repro (30 s, live cookies, documented per #47):
 *   PYTHONPATH="$HOME/.local/share/uv/tools/twitter-cli/lib/python3.x/site-packages" \
 *   python3 -c "
 *   from x_client_transaction import ClientTransaction
 *   import json
 *   cache = json.load(open('$HOME/.twitter-cli/transaction_cache.json'))
 *   ct = ClientTransaction(home_page_response=cache['home_html'], ondemand_file_response=cache['ondemand_text'])
 *   tid = ct.generate_transaction_id(method='GET', path='/i/api/graphql/<qid>/SearchTimeline')
 *   print('tid:', tid[:8] + '...')  # with tid -> 200, without -> 404
 *   "
 * (or `npm run parity:check` for the patch-state guard)
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userDataDir = mkdtempSync(join(tmpdir(), 'soxial-social-content-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
}))

vi.mock('../electron/main/cli', () => ({
  runCli: vi.fn(),
  runTwitterCli: vi.fn(),
  ensureTwitterAuth: vi.fn(),
  ensureRdtAuth: vi.fn(),
}))

import { runCli, runTwitterCli, type CliResult } from '../electron/main/cli'
import { getDb } from '../electron/main/db'
import {
  extractDataArray,
  compactTwitterForModel,
  compactTwitterItem,
  fetchTwitterUserPosts,
  fetchTwitterReplies,
  fetchRedditUserPosts,
  gatherOnboardingSocialData,
} from '../electron/main/social-content'

const now = Date.now()
const iso = (offsetDays: number) => new Date(now - offsetDays * 86400_000).toISOString()

function tweet(id: string, ageDays = 1): any {
  return {
    id,
    text: `tweet ${id}`,
    author: { screenName: 'tester' },
    metrics: { likes: 5, retweets: 2, replies: 1, views: 40, quotes: 0 },
    createdAtISO: iso(ageDays),
  }
}

function notFound(message = 'Twitter API error (HTTP 404): Twitter API error 404: '): CliResult {
  return { ok: false, data: null, error: message, errorCode: 'not_found' }
}

beforeAll(() => {
  getDb()
})

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks does not drop queued mockResolvedValueOnce implementations.
  vi.mocked(runCli).mockReset()
  vi.mocked(runTwitterCli).mockReset()
  getDb().prepare('DELETE FROM social_content').run()
})

describe('extractDataArray / compactTwitterForModel edges', () => {
  it('tolerates array, {data:[]} and reddit children envelopes', () => {
    expect(extractDataArray({ ok: true, data: [1, 2] } as CliResult)).toEqual([1, 2])
    expect(extractDataArray({ ok: true, data: { data: [3] } } as CliResult)).toEqual([3])
    expect(
      extractDataArray({ ok: true, data: { data: { children: [{ data: 4 }, { data: 5 }] } } } as CliResult),
    ).toEqual([4, 5])
    expect(extractDataArray({ ok: false, data: null, error: 'x' } as CliResult)).toEqual([])
    expect(extractDataArray({ ok: true, data: null } as CliResult)).toEqual([])
  })

  it('compactTwitterItem keeps views/quotes from full mode and media pairs', () => {
    const compact = compactTwitterItem(tweet('9', 0))
    expect(compact).toMatchObject({
      id: '9',
      author: '@tester',
      likes: 5,
      views: 40,
      quotes: 0,
      isRetweet: false,
    })
  })

  it('compactTwitterForModel passes failures through and compacts lists', () => {
    const failed = { ok: false, data: null, error: 'x' } as CliResult
    expect(compactTwitterForModel(failed)).toBe(failed)
    const compacted = compactTwitterForModel({ ok: true, data: [tweet('1', 0)] } as CliResult)
    expect(compacted.ok).toBe(true)
    expect((compacted as any).data[0].id).toBe('1')
  })
})

describe('fetchTwitterUserPosts — SearchTimeline 404 fallback (#44)', () => {
  it('falls back to user-posts when search 404s and returns ok:true with trimmed data', async () => {
    vi.mocked(runTwitterCli).mockImplementation(async (args: string[]) => {
      if (args[0] === 'search') return notFound()
      return { ok: true, data: [tweet('p1', 3), tweet('p2', 90)] } as CliResult
    })

    const result = await fetchTwitterUserPosts('EaseMizeUI')

    expect(result.ok).toBe(true)
    expect((result.data as any[]).map((t) => t.id)).toEqual(['p1']) // 90d old is trimmed by lookback
    const fallbackArgs = vi.mocked(runTwitterCli).mock.calls.find(([a]) => a[0] === 'user-posts')
    expect(fallbackArgs?.[0]).toEqual(['user-posts', 'EaseMizeUI', '--max', '100', '--json'])
  })

  it('does not invoke the fallback when search succeeds', async () => {
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [tweet('s1', 1)] } as CliResult)

    const result = await fetchTwitterUserPosts('tester')

    expect(result.ok).toBe(true)
    expect((result.data as any[])[0].id).toBe('s1')
    expect(vi.mocked(runTwitterCli).mock.calls.every(([a]) => a[0] === 'search')).toBe(true)
  })

  it('returns the error only when both search and user-posts fail', async () => {
    vi.mocked(runTwitterCli).mockResolvedValue(notFound())

    const result = await fetchTwitterUserPosts('tester')

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_found')
  })
})

describe('fetchTwitterReplies — 404 degrades to ok-empty (#45)', () => {
  it('returns ok:true with an empty list when search 404s', async () => {
    vi.mocked(runTwitterCli).mockResolvedValue(notFound())

    const result = await fetchTwitterReplies('tester')

    expect(result).toEqual({ ok: true, data: [] })
  })

  it('returns trimmed replies when search succeeds', async () => {
    vi.mocked(runTwitterCli).mockResolvedValue({ ok: true, data: [tweet('r1', 2), tweet('r2', 70)] } as CliResult)

    const result = await fetchTwitterReplies('tester')

    expect(result.ok).toBe(true)
    expect((result.data as any[]).map((t) => t.id)).toEqual(['r1'])
  })

  it('propagates non-404 errors', async () => {
    vi.mocked(runTwitterCli).mockResolvedValue({
      ok: false,
      data: null,
      error: 'rate limited',
      errorCode: 'rate_limited',
    } as CliResult)

    const result = await fetchTwitterReplies('tester')
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('rate_limited')
  })
})

describe('fetchRedditPaginated — cursor + lookback (#46)', () => {
  it('caps at 100 items in one full page (max-count-reached keeps the page as-is)', async () => {
    const batch = [
      // 98 fresh posts inside the 2-month window…
      ...Array.from({ length: 98 }, (_, i) => ({
        id: `rp${i}`,
        author: 'redditor',
        subreddit: 'frontend',
        title: `post ${i}`,
        created_utc: Math.floor(now / 1000) - i * 60,
      })),
      // …and two ancient ones. A FULL page hits MAX_SOCIAL_ITEMS, and the
      // documented trim semantics return the capped page unfiltered.
      { id: 'rpOld1', author: 'redditor', subreddit: 'frontend', title: 'ancient', created_utc: Math.floor(now / 1000) - 90 * 86400 },
      { id: 'rpOld2', author: 'redditor', subreddit: 'frontend', title: 'older', created_utc: Math.floor(now / 1000) - 120 * 86400 },
    ]

    vi.mocked(runCli).mockResolvedValue({
      ok: true,
      data: { data: { children: batch.map((c) => ({ data: c })), after: 't1_cursor' } },
    } as CliResult)

    const result = await fetchRedditUserPosts('redditor')

    expect(result.ok).toBe(true)
    const ids = (result.data as any[]).map((item) => item.id)
    expect(ids).toHaveLength(100)
    expect(ids).toContain('rp0')
    // A full first page hits MAX_SOCIAL_ITEMS — no second `--after` request.
    expect(vi.mocked(runCli)).toHaveBeenCalledTimes(1)
  })

  it('stops on a partial page, trimming anything beyond the lookback', async () => {
    // A partial batch ends pagination — no further `--after` request — and a
    // partial page is filtered to the 2-month lookback.
    const partial = [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `rp${i}`,
        author: 'redditor',
        subreddit: 'frontend',
        title: `post ${i}`,
        created_utc: Math.floor(now / 1000) - i * 60,
      })),
      { id: 'rpOld', author: 'redditor', subreddit: 'frontend', title: 'ancient', created_utc: Math.floor(now / 1000) - 90 * 86400 },
    ]
    vi.mocked(runCli).mockResolvedValue({
      ok: true,
      data: { data: { children: partial.map((c) => ({ data: c })) } },
    } as CliResult)

    const result = await fetchRedditUserPosts('redditor')

    expect(result.ok).toBe(true)
    expect((result.data as any[]).map((item) => item.id)).toEqual(['rp0', 'rp1', 'rp2'])
    expect(vi.mocked(runCli)).toHaveBeenCalledTimes(1)
  })

  it('empty listings are ok:true data:[] not not_found', async () => {
    vi.mocked(runCli).mockResolvedValue({ ok: true, data: { data: { children: [] } } } as CliResult)

    const result = await fetchRedditUserPosts('redditor')

    expect(result).toEqual({ ok: true, data: [] })
  })
})

describe('gatherOnboardingSocialData persists despite search 404s (#44)', () => {
  it('stores twitter_user_posts rows from the UserTweets fallback', async () => {
    vi.mocked(runCli).mockImplementation(async (_bin, args: string[]) => {
      if (args[0] === 'whoami') {
        return { ok: true, data: { user: { screenName: 'tester', name: 'Tester' } } } as CliResult
      }
      return { ok: true, data: {} } as CliResult
    })
    vi.mocked(runTwitterCli).mockImplementation(async (args: string[]) => {
      if (args[0] === 'search') return notFound()
      if (args[0] === 'user-posts') return { ok: true, data: [tweet('gp1', 2), tweet('gp2', 5)] } as CliResult
      return { ok: true, data: [] } as CliResult
    })

    const gathered = await gatherOnboardingSocialData({ twitter_handle: 'tester' }, {
      onToolCall: () => {},
      onToolResult: () => {},
    })

    expect(gathered.twitter_user_posts.ok).toBe(true)
    expect(gathered._social_persist?.twitter_user_posts).toMatchObject({ skipped: false, total: 2 })

    const rows = getDb()
      .prepare("SELECT external_id, content_type FROM social_content WHERE platform = 'twitter' ORDER BY external_id")
      .all() as Array<{ external_id: string; content_type: string }>
    expect(rows).toEqual([
      { external_id: 'gp1', content_type: 'post' },
      { external_id: 'gp2', content_type: 'post' },
    ])
  })
})
