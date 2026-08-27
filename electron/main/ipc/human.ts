import { ipcMain } from 'electron'
import {
  clampHumanCount,
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
}
