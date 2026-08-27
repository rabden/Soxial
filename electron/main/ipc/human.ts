import { ipcMain } from 'electron'
import {
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

export interface HumanFeedRequest {
  type?: 'for-you' | 'following'
  count?: number
  cursor?: string
}

export interface HumanProfilePostsRequest {
  subTab: 'posts' | 'replies'
  count?: number
  /** Date window (YYYY-MM-DD): only items older than this day (X `until:`). */
  until?: string
}

export interface HumanFollowListRequest {
  subTab: 'following' | 'followers'
  count?: number
}

function authError(session: Extract<HumanSessionResult, { ok: false }>) {
  return { ok: false as const, error: session.error }
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

    const count = clampHumanCount(request?.count)
    // Posts = authored non-replies; Replies = authored minus retweets
    // (contract §7 — `filter:replies` semantics via the exclude set).
    const args = [
      'search',
      '--json',
      '--from',
      guarded.handle,
      '--exclude',
      request?.subTab === 'replies' ? 'retweets' : 'replies',
      '-n',
      String(count),
    ]
    const until = sanitizeIsoDate(request?.until)
    if (until) args.push('--until', until)

    const res = await runHumanTwitterCli(args)
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: toWindowedHumanPage(res, count) }
  })

  ipcMain.handle('human:bookmarks', async (_event, request: { count?: number } = {}) => {
    const session = await verifyHumanSession()
    if (!session.ok) return authError(session)

    // No cursor for bookmarks — pages grow the requested count toward the
    // connector's 200 hard cap, then stop (contract §2). Note: this clamp
    // allows up to 200 (unlike the generic 100-count clamp for feed/search).
    const rawCount = typeof request.count === 'number' && Number.isFinite(request.count)
      ? Math.floor(request.count)
      : 10
    const count = Math.min(Math.max(rawCount, 1), HUMAN_CLI_HARD_CAP)
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
    const rawCount =
      typeof request?.count === 'number' && Number.isFinite(request.count) ? Math.floor(request.count) : 10
    const count = Math.min(Math.max(rawCount, 1), HUMAN_CLI_HARD_CAP)
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
}
