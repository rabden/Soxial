import { ipcMain } from 'electron'
import {
  clampGrowthCount,
  clampHumanCount,
  extractHumanItems,
  HUMAN_CLI_HARD_CAP,
  mapCliError,
  normalizeHumanUser,
  runHumanTwitterCli,
  sanitizeCursor,
  sanitizeIsoDate,
  toHumanPage,
  toWindowedHumanPage,
  verifyHumanSession,
  type HumanSessionResult,
} from '../human-connector'
import { normalizeTwitterHandle } from '../twitter-handle'
import { isTwitterHandleRebuildActive } from '../twitter-handle-rebuild'
// Request shapes live in one place: the renderer contract module.
import type {
  HumanFeedRequest,
  HumanFollowListRequest,
  HumanProfilePostsRequest,
  HumanSearchRequest,
} from '../../../src/features/human/types'

export type { HumanFeedRequest, HumanFollowListRequest, HumanProfilePostsRequest, HumanSearchRequest }

function authError(session: Extract<HumanSessionResult, { ok: false }>) {
  return { ok: false as const, error: session.error }
}

const SEARCH_PRODUCTS = new Set(['Top', 'Latest', 'Photos', 'Videos'])
const SEARCH_HAS = new Set(['links', 'images', 'videos', 'media'])
const SEARCH_EXCLUDE = new Set(['retweets', 'replies', 'links'])
const LANG_RE = /^[a-z]{2}$/i

function invalidError(message: string) {
  return mapCliError({ error: message, errorCode: 'invalid_input' })
}

function searchHandle(value: unknown, flag: string): string | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return { error: `${flag} must be a handle` }
  try {
    return normalizeTwitterHandle(value)
  } catch {
    return { error: `${flag}: invalid X handle "${value}"` }
  }
}


/** Build validated `search` args; every filter the renderer surfaces passes through. */
function buildSearchArgs(request: HumanSearchRequest): { ok: true; args: string[] } | { ok: false; error: ReturnType<typeof mapCliError> } {
  const query = typeof request.query === 'string' ? request.query.trim() : ''
  if (!query) return { ok: false, error: invalidError('Enter a search query.') }
  if (query.length > 500) return { ok: false, error: invalidError('Search query is too long (max 500 characters).') }
  if (query.startsWith('-')) {
    return { ok: false, error: invalidError('Query cannot start with "-" (the connector parses it as a flag).') }
  }

  const product = request.product && SEARCH_PRODUCTS.has(request.product) ? request.product : 'Top'
  const args = ['search', query, '--json', '-t', product, '-n', String(clampHumanCount(request.count))]

  for (const [flag, value] of [['--from', request.from], ['--to', request.to]] as const) {
    const handle = searchHandle(value, flag)
    if (typeof handle === 'object' && handle !== null) return { ok: false, error: invalidError(handle.error) }
    if (handle) args.push(flag, handle)
  }

  if (request.lang !== undefined && request.lang !== '') {
    if (typeof request.lang !== 'string' || !LANG_RE.test(request.lang)) {
      return { ok: false, error: invalidError('Language must be a 2-letter ISO code (e.g. en).') }
    }
    args.push('--lang', request.lang.toLowerCase())
  }

  for (const [flag, value] of [['--since', request.since], ['--until', request.until]] as const) {
    const date = sanitizeIsoDate(value)
    if (value !== undefined && value !== '' && !date) {
      return { ok: false, error: invalidError(`${flag} must be a YYYY-MM-DD date.`) }
    }
    if (date) args.push(flag, date)
  }

  if (request.has !== undefined) {
    if (!Array.isArray(request.has)) return { ok: false, error: invalidError('has must be a list.') }
    for (const item of request.has) {
      if (!SEARCH_HAS.has(String(item))) return { ok: false, error: invalidError(`Unsupported --has value: ${String(item)}`) }
      args.push('--has', String(item))
    }
  }

  if (request.exclude !== undefined) {
    if (!Array.isArray(request.exclude)) return { ok: false, error: invalidError('exclude must be a list.') }
    for (const item of request.exclude) {
      if (!SEARCH_EXCLUDE.has(String(item))) return { ok: false, error: invalidError(`Unsupported --exclude value: ${String(item)}`) }
      args.push('--exclude', String(item))
    }
  }

  for (const [flag, value] of [['--min-likes', request.minLikes], ['--min-retweets', request.minRetweets]] as const) {
    if (value === undefined || value === null) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000_000) {
      return { ok: false, error: invalidError(`${flag} must be a whole number between 0 and 10,000,000.`) }
    }
    args.push(flag, String(value))
  }

  return { ok: true, args }
}

/** Resolve the signed-in handle through the session gate shared by handlers. */
async function requireSessionHandle(): Promise<
  { ok: true; handle: string } | { ok: false; error: ReturnType<typeof mapCliError> }
> {
  const session = await verifyHumanSession()
  if (!session.ok) return { ok: false, error: session.error }
  const screenName = session.data.user?.screenName
  if (!screenName) {
    return {
      ok: false,
      error: mapCliError({ error: 'Signed-in X handle is unknown', errorCode: 'not_authenticated' }),
    }
  }
  try {
    return { ok: true, handle: normalizeTwitterHandle(screenName) }
  } catch {
    return { ok: false, error: mapCliError({ error: `Invalid X handle: ${screenName}`, errorCode: 'invalid_input' }) }
  }
}

/**
 * Human-mode connector handlers. Every handler: verifies the session first,
 * validates/clamps inputs, invokes the connector in full mode with an explicit
 * `--json`, under the shared queue + timeout (see human-connector.ts).
 */
export function registerHumanHandlers(): void {
  ipcMain.handle('human:feed', async (_event, request: HumanFeedRequest = {}) => {
    const session = await verifyHumanSession()
    if (!session.ok) return { ok: false as const, error: session.error }

    const type = request.type === 'following' ? 'following' : 'for-you'
    const args = ['feed', '--json', '-t', type, '-n', String(clampHumanCount(request.count))]
    const cursor = sanitizeCursor(request.cursor)
    if (cursor) args.push('--cursor', cursor)

    const res = await runHumanTwitterCli(args)
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: toHumanPage(res) }
  })

  ipcMain.handle('human:verifySession', async () => {
    const session = await verifyHumanSession()
    if (!session.ok) return { ok: false as const, error: session.error }
    return session
  })

  ipcMain.handle('human:profile', async () => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)

    const res = await runHumanTwitterCli(['whoami', '--json'])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }

    const raw = res.data?.user ?? res.data
    const user = normalizeHumanUser(raw)
    if (!user) {
      return { ok: false as const, error: mapCliError({ error: 'X profile payload was empty', errorCode: 'api_error' }) }
    }
    return { ok: true as const, data: user }
  })

  ipcMain.handle('human:profilePosts', async (_event, request: HumanProfilePostsRequest) => {
    const guarded = await requireSessionHandle()
    if (!guarded.ok) return { ok: false as const, error: guarded.error }

    // Posts: the native UserTweets timeline (`user-posts`) — chronological
    // (newest first), pinned tweet first, no SearchTimeline index gaps (the
    // search `from:` index silently misses recent tweets, which is why this
    // tab used to show a handful of stale posts). Count-growth pagination:
    // no cursor exists, each page grows the requested count by the renderer
    // (same strategy as bookmarks), capped by the connector.
    // Replies: search remains the only source (UserTweets excludes replies)
    // — Latest product + `--until` date-window pagination.
    if (request?.subTab === 'replies') {
      const count = clampHumanCount(request?.count)
      const args = ['search', 'filter:replies', '--json', '-t', 'Latest', '--from', guarded.handle, '-n', String(count)]
      const until = sanitizeIsoDate(request?.until)
      if (until) args.push('--until', until)

      const res = await runHumanTwitterCli(args)
      if (!res.ok) return { ok: false as const, error: mapCliError(res) }
      return { ok: true as const, data: toWindowedHumanPage(res, count) }
    }

    const count = clampGrowthCount(request?.count)
    const res = await runHumanTwitterCli(['user-posts', guarded.handle, '--json', '-n', String(count)])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }

    const items = extractHumanItems(res)
    const hasMore = items.length >= count && count < HUMAN_CLI_HARD_CAP
    return { ok: true as const, data: { items, hasMore } }
  })

  ipcMain.handle('human:bookmarks', async (_event, request: { count?: number } = {}) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)

    // No cursor for bookmarks — pages grow the requested count toward the
    // connector's 200 hard cap, then stop (contract §2).
    const count = clampGrowthCount(request.count)
    const res = await runHumanTwitterCli(['bookmarks', '--json', '-n', String(count)])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }

    const items = extractHumanItems(res)
    const hasMore = items.length >= count && count < HUMAN_CLI_HARD_CAP
    return { ok: true as const, data: { items, hasMore } }
  })

  ipcMain.handle('human:followList', async (_event, request: HumanFollowListRequest) => {
    const guarded = await requireSessionHandle()
    if (!guarded.ok) return { ok: false as const, error: guarded.error }

    // Same count-growth strategy as bookmarks (no cursor, 200 cap).
    const count = clampGrowthCount(request?.count)
    const args = [request?.subTab === 'followers' ? 'followers' : 'following', guarded.handle, '--json', '-n', String(count)]

    const res = await runHumanTwitterCli(args)
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }

    const items = extractHumanItems(res)
      .map((raw) => normalizeHumanUser(raw))
      .filter((user) => user !== null)
    const hasMore = items.length >= count && count < HUMAN_CLI_HARD_CAP
    return { ok: true as const, data: { items, hasMore } }
  })

  ipcMain.handle(
    'human:followAction',
    async (_event, request: { handle?: string; action?: 'follow' | 'unfollow' }) => {
      const session = await verifyHumanSession()
      if (!session.ok) return authError(session)

      // Writes are blocked while a handle rebuild is active (mirrors the
      // profile-update guard) — the rebuild owns the relationship state.
      if (isTwitterHandleRebuildActive()) {
        return {
          ok: false as const,
          error: mapCliError({
            error: 'Profile rebuild in progress — follow actions resume when it finishes.',
            errorCode: 'invalid_input',
          }),
        }
      }

      let handle: string
      try {
        handle = normalizeTwitterHandle(String(request?.handle ?? ''))
      } catch {
        return {
          ok: false as const,
          error: mapCliError({ error: `Invalid X handle: ${request?.handle}`, errorCode: 'invalid_input' }),
        }
      }
      const action = request?.action === 'unfollow' ? 'unfollow' : 'follow'

      const res = await runHumanTwitterCli([action, handle, '--json'])
      if (!res.ok) return { ok: false as const, error: mapCliError(res) }
      return { ok: true as const, data: { handle, following: action === 'follow' } }
    },
  )

  // ——— Tweet actions (like / repost / bookmark) ———
  ipcMain.handle('human:like', async (_event, request: { tweetId?: string; action?: 'like' | 'unlike' }) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)
    const tweetId = String(request?.tweetId ?? '').trim()
    if (!/^\d+$/.test(tweetId)) return { ok: false as const, error: invalidError('Invalid tweet ID') }
    const action = request?.action === 'unlike' ? 'unlike' : 'like'
    const res = await runHumanTwitterCli([action, tweetId, '--json'])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: { tweetId, action } }
  })

  ipcMain.handle('human:retweet', async (_event, request: { tweetId?: string; action?: 'retweet' | 'unretweet' }) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)
    const tweetId = String(request?.tweetId ?? '').trim()
    if (!/^\d+$/.test(tweetId)) return { ok: false as const, error: invalidError('Invalid tweet ID') }
    const action = request?.action === 'unretweet' ? 'unretweet' : 'retweet'
    const res = await runHumanTwitterCli([action, tweetId, '--json'])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: { tweetId, action } }
  })

  ipcMain.handle('human:bookmark', async (_event, request: { tweetId?: string; action?: 'bookmark' | 'unbookmark' }) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)
    const tweetId = String(request?.tweetId ?? '').trim()
    if (!/^\d+$/.test(tweetId)) return { ok: false as const, error: invalidError('Invalid tweet ID') }
    const action = request?.action === 'unbookmark' ? 'unbookmark' : 'bookmark'
    const res = await runHumanTwitterCli([action, tweetId, '--json'])
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: { tweetId, action } }
  })

  ipcMain.handle('human:search', async (_event, request: HumanSearchRequest) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)

    const built = buildSearchArgs(request ?? ({} as HumanSearchRequest))
    if (!built.ok) return { ok: false as const, error: built.error }

    const res = await runHumanTwitterCli(built.args)
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    // No cursor for search — date-window pagination with a page-full heuristic.
    return {
      ok: true as const,
      data: toWindowedHumanPage(res, clampHumanCount(request.count)),
    }
  })
}
