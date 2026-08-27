import type { AppError } from '../../src/types/app-error'
import { createAppError } from '../../src/types/app-error'
import { normalizeAppError } from './errors'
import { ensureTwitterAuth, runTwitterCli, type CliResult } from './cli'
import { logger } from './log'

/** Page size every Human surface requests per scroll (per spec #33). */
export const HUMAN_PAGE_SIZE = 10
/** Upper bound for any user-supplied `-n` count (D4). The CLI hard cap is 200. */
export const HUMAN_MAX_COUNT = 100
/** Every Human connector call runs under a hard timeout (runCli kills the child). */
export const HUMAN_CLI_TIMEOUT_MS = 30_000
/**
 * Parallel UI fetches must not hammer the single cookie session. 1–2 per bin
 * (D5). The CLI already self-retries 429 with backoff and sleeps between
 * internal pages — the queue adds ordering only, never its own retry loop.
 */
export const HUMAN_CLI_CONCURRENCY = 2

/** Map a structured connector error code to the app's typed error model (D6). */
const CLI_ERROR_MAP: Record<
  string,
  Pick<AppError, 'category' | 'code' | 'retryable'> & Partial<Pick<AppError, 'action' | 'retryAfterMs'>>
> = {
  not_authenticated: { category: 'auth', code: 'TWITTER_AUTH_REQUIRED', retryable: false, action: 'reauthenticate' },
  rate_limited: { category: 'rate-limit', code: 'TWITTER_RATE_LIMITED', retryable: true, action: 'retry', retryAfterMs: 5 * 60 * 1000 },
  not_found: { category: 'validation', code: 'TWITTER_NOT_FOUND', retryable: false },
  network_error: { category: 'network', code: 'TWITTER_NETWORK', retryable: true, action: 'retry' },
  query_id_error: { category: 'network', code: 'TWITTER_QUERY_ID', retryable: true, action: 'retry' },
  invalid_input: { category: 'validation', code: 'TWITTER_INVALID_INPUT', retryable: false },
  media_upload_error: { category: 'internal', code: 'TWITTER_MEDIA_UPLOAD', retryable: false },
  api_error: { category: 'internal', code: 'TWITTER_API', retryable: false },
}

const FALLBACK_MESSAGE: Record<string, string> = {
  not_authenticated: 'Log in to x.com in your browser, then re-check the session.',
  rate_limited: 'X is rate limiting requests. Try again after the cooldown.',
  not_found: 'That could not be found on X.',
  network_error: 'Could not reach X. Check your connection and retry.',
  query_id_error: 'X connector hiccup. Retry in a moment.',
  invalid_input: 'The request values were not valid.',
}

export function mapCliError(result: { error?: string; errorCode?: string }): AppError {
  const code = result.errorCode
  if (code && CLI_ERROR_MAP[code]) {
    const mapped = CLI_ERROR_MAP[code]
    return createAppError(
      { ...mapped, message: result.error?.trim() || FALLBACK_MESSAGE[code] || mapped.code },
      FALLBACK_MESSAGE[code] || 'The X request failed.',
    )
  }
  // No structured code (older CLI, spawn failure) — fall back to heuristics.
  return normalizeAppError(result.error || 'The X request failed.', { platform: 'twitter' })
}

/** FIFO queue with a per-bin concurrency limit. Ordering only — no retries. */
export class HumanCliQueue {
  private bins = new Map<string, { active: number; waiters: Array<() => void> }>()

  constructor(private readonly concurrency: number = HUMAN_CLI_CONCURRENCY) {}

  run<T>(bin: string, task: () => Promise<T>): Promise<T> {
    let state = this.bins.get(bin)
    if (!state) {
      state = { active: 0, waiters: [] }
      this.bins.set(bin, state)
    }
    return this._enqueue(state, task)
  }

  private async _enqueue<T>(state: { active: number; waiters: Array<() => void> }, task: () => Promise<T>): Promise<T> {
    while (state.active >= this.concurrency) {
      await new Promise<void>((resolve) => state.waiters.push(resolve))
    }
    state.active++
    try {
      return await task()
    } finally {
      state.active--
      state.waiters.shift()?.()
    }
  }
}

export const humanCliQueue = new HumanCliQueue()

/**
 * Every Human connector invocation: full (non-compact) mode with an explicit
 * `--json` (non-TTY stdout defaults to YAML), under a hard timeout, ordered by
 * the per-bin queue. `--json` is the caller's responsibility — keep it an
 * invariant of every handler (contract §1).
 */
export function runHumanTwitterCli(args: string[]): Promise<CliResult> {
  return humanCliQueue.run('twitter', () =>
    runTwitterCli(args, { compact: false, timeoutMs: HUMAN_CLI_TIMEOUT_MS }),
  )
}

export interface HumanSessionUser {
  screenName: string
  name?: string
  profileImageUrl?: string
}

export type HumanSessionOk = { ok: true; data: { authenticated: true; user: HumanSessionUser | null } }
export type HumanSessionErr = { ok: false; error: AppError }
export type HumanSessionResult = HumanSessionOk | HumanSessionErr

/** Session verification used by every Human handler and the auth-gate Re-check. */
export async function verifyHumanSession(): Promise<HumanSessionResult> {
  const status = await humanCliQueue.run('twitter', () => ensureTwitterAuth())
  if (!status.ok) {
    return {
      ok: false,
      error: mapCliError({ error: status.error, errorCode: status.errorCode ?? 'not_authenticated' }),
    }
  }
  const user = status.data?.user ?? null
  return { ok: true, data: { authenticated: true, user } }
}

/** Clamp a renderer-supplied count to 1..HUMAN_MAX_COUNT. Non-positive or
 *  non-numeric values fall back to the default page size. */
export function clampHumanCount(count: unknown): number {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : NaN
  if (!Number.isFinite(n) || n < 1) return HUMAN_PAGE_SIZE
  return Math.min(n, HUMAN_MAX_COUNT)
}

const CURSOR_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,255}$/

/** Cursors are opaque tokens passed through to the CLI; reject anything that
 *  could be parsed as a flag or smuggle whitespace (spawn is array-safe, but
 *  argparse would still read a leading `-` as an option). */
export function sanitizeCursor(cursor: unknown): string | undefined {
  if (typeof cursor !== 'string') return undefined
  if (cursor.startsWith('-')) return undefined
  return CURSOR_RE.test(cursor) ? cursor : undefined
}

/** Tolerant list extraction from a CLI envelope: `[…]`, `{data:[…]}`, or `{items:[…]}`. */
export function extractHumanItems(res: CliResult): unknown[] {
  const d = res.data
  if (Array.isArray(d)) return d
  if (d && typeof d === 'object') {
    if (Array.isArray((d as any).data)) return (d as any).data
    if (Array.isArray((d as any).items)) return (d as any).items
  }
  return []
}

export interface HumanPage<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

/** Shape every Human list handler returns: items + cursor continuation. */
export function toHumanPage<T>(res: CliResult): HumanPage<T> {
  const items = extractHumanItems(res) as T[]
  const nextCursor = res.nextCursor
  logger.debug('human-connector', `page: ${items.length} items, cursor=${nextCursor ? 'yes' : 'no'}`)
  return { items, ...(nextCursor ? { nextCursor } : {}), hasMore: Boolean(nextCursor) }
}

/**
 * Windowed page for cursor-less commands (profile posts/replies, search):
 * hasMore is a page-full heuristic; the renderer advances the date window.
 */
export function toWindowedHumanPage<T>(res: CliResult, requestedCount: number): HumanPage<T> {
  const items = extractHumanItems(res) as T[]
  return { items, hasMore: items.length >= requestedCount }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `--until`/`--since` accept YYYY-MM-DD only (composed into X search operators). */
export function sanitizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? undefined : value
}

/** Normalize a connector user dict (`whoami`/`user`) — keeps connector count
 *  keys (followers/following/tweets), aliases `username` → `screenName`. */
export function normalizeHumanUser(raw: any): {
  id?: string
  screenName: string
  name: string
  bio?: string
  location?: string
  url?: string
  followers?: number
  following?: number
  tweets?: number
  likes?: number
  verified?: boolean
  profileImageUrl?: string
  createdAt?: string
  createdAtISO?: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const screenName = raw.screenName ?? raw.username
  if (typeof screenName !== 'string' || !screenName) return null
  return {
    ...(typeof raw.id === 'string' || typeof raw.id === 'number' ? { id: String(raw.id) } : {}),
    screenName,
    name: typeof raw.name === 'string' ? raw.name : screenName,
    ...(typeof raw.bio === 'string' ? { bio: raw.bio } : {}),
    ...(typeof raw.location === 'string' ? { location: raw.location } : {}),
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(typeof raw.followers === 'number' ? { followers: raw.followers } : {}),
    ...(typeof raw.following === 'number' ? { following: raw.following } : {}),
    ...(typeof raw.tweets === 'number' ? { tweets: raw.tweets } : {}),
    ...(typeof raw.likes === 'number' ? { likes: raw.likes } : {}),
    ...(raw.verified === true ? { verified: true } : {}),
    ...(typeof raw.profileImageUrl === 'string' ? { profileImageUrl: raw.profileImageUrl } : {}),
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.createdAtISO === 'string' ? { createdAtISO: raw.createdAtISO } : {}),
  }
}
