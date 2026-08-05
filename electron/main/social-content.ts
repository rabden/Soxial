import { runCli, runTwitterCli, ensureRdtAuth, type CliResult } from './cli'
import { upsertSocialContent, type SocialContentRow } from './db'
import { logger } from './log'

export const MAX_SOCIAL_ITEMS = 100
export const LOOKBACK_MONTHS = 2

export const SOCIAL_FETCH_TOOLS = new Set([
  'twitter_user',
  'twitter_user_posts',
  'twitter_replies',
  'twitter_status',
  'twitter_whoami',
  'twitter_following',
  'twitter_likes',
  'twitter_bookmarks',
  'reddit_user_posts',
  'reddit_user_comments',
  'reddit_whoami',
  'reddit_feed',
])

export function getSinceDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - LOOKBACK_MONTHS)
  return d.toISOString().slice(0, 10)
}

export function getSinceTimestamp(): number {
  const d = new Date()
  d.setMonth(d.getMonth() - LOOKBACK_MONTHS)
  return d.getTime()
}

export function extractDataArray(result: CliResult): any[] {
  if (!result.ok || result.data == null) return []
  const d = result.data
  if (Array.isArray(d)) return d
  if (Array.isArray(d.data)) return d.data
  if (d.data?.children && Array.isArray(d.data.children)) {
    return d.data.children.map((c: any) => c.data ?? c)
  }
  return []
}

/** Compact a full X item for the model: KEEP media (type+url), drop noise. */
export function compactTwitterItem(t: any): any {
  if (!t) return null
  const a = t.author
  const author = typeof a === 'string' ? a : a?.screenName ? `@${a.screenName}` : null
  const m = t.metrics || {}
  const media = Array.isArray(t.media)
    ? t.media
        .map((x: any) => (x?.type && x?.url ? { type: x.type, url: x.url } : null))
        .filter(Boolean)
    : []
  return {
    id: t.id,
    author,
    text: t.text || t.full_text || '',
    likes: m.likes ?? t.likes ?? 0,
    retweets: m.retweets ?? t.rts ?? t.retweets ?? 0,
    replies: m.replies ?? t.replies ?? 0,
    quotes: m.quotes ?? t.quotes ?? 0,
    views: m.views ?? t.views ?? 0,
    bookmarks: m.bookmarks ?? t.bookmarks ?? 0,
    time: t.createdAtLocal || t.createdAt || t.time,
    media,
    urls: Array.isArray(t.urls) ? t.urls.slice(0, 4) : [],
    isRetweet: !!t.isRetweet,
  }
}

/** Best-effort direct media URL for a reddit post (image/gif/video). */
function redditMediaUrl(it: any): string | undefined {
  if (!it) return undefined
  const vid = it.media?.reddit_video?.fallback_url || it.secure_media?.reddit_video?.fallback_url
  if (it.is_video) return vid
  const hint = it.post_hint
  if (hint === 'image' || hint === 'gallery') {
    return it.url && !it.is_self ? it.url : it.preview?.images?.[0]?.source?.url || undefined
  }
  if (hint === 'hosted:video' || hint === 'rich:video') return vid
  return undefined
}

/** Compact a full reddit post/comment item for the model, preserving media signals. */
export function compactRedditItem(it: any): any {
  if (!it) return null
  return {
    id: it.id || it.name,
    name: it.name,
    title: it.title || null,
    subreddit: it.subreddit,
    author: it.author,
    score: it.score,
    num_comments: it.num_comments,
    created_utc: it.created_utc,
    permalink: it.permalink,
    is_self: !!it.is_self,
    is_video: !!it.is_video,
    post_hint: it.post_hint || null,
    media_url: redditMediaUrl(it) || null,
    url: it.url,
    text: ((it.selftext || it.body || '') as string).slice(0, 500),
  }
}

/** Compact a non-compact X listing result for the model (media preserved). */
export function compactTwitterForModel(result: CliResult): CliResult {
  if (!result?.ok) return result
  const items = extractDataArray(result)
  if (items.length === 0) return { ok: true, data: [], error: undefined }
  return { ok: true, data: items.map(compactTwitterItem).filter(Boolean), error: undefined }
}

/** Compact a non-compact rdt listing result for the model (media preserved). */
export function compactRedditForModel(result: CliResult): CliResult {
  if (!result?.ok) return result
  const items = extractDataArray(result)
  if (items.length === 0) return { ok: true, data: [], error: undefined }
  return { ok: true, data: items.map(compactRedditItem).filter(Boolean), error: undefined }
}

function twitterItemTimestamp(item: any): number {
  if (item.createdAtISO) return new Date(item.createdAtISO).getTime()
  if (item.createdAt) return new Date(item.createdAt).getTime()
  return 0
}

function redditItemTimestamp(item: any): number {
  if (item.created_utc) return item.created_utc * 1000
  if (item.createdUtc) return item.createdUtc * 1000
  return 0
}

function getRedditAfterCursor(result: CliResult): string | undefined {
  const d = result.data
  if (!d) return undefined
  if (typeof d.data?.after === 'string' && d.data.after) return d.data.after
  if (typeof d.after === 'string' && d.after) return d.after
  return undefined
}

/** Keep items until 2-month lookback is covered or max count reached. */
function trimToLookback(items: any[], getTs: (item: any) => number): any[] {
  if (items.length === 0) return items
  const sinceMs = getSinceTimestamp()
  const capped = items.slice(0, MAX_SOCIAL_ITEMS)
  const oldestTs = Math.min(...capped.map(getTs).filter(Boolean))
  if (oldestTs >= sinceMs || capped.length >= MAX_SOCIAL_ITEMS) {
    return capped
  }
  return capped.filter(item => {
    const ts = getTs(item)
    return !ts || ts >= sinceMs
  })
}

export function toTwitterRows(items: any[], contentType: 'post' | 'reply', authorHandle?: string): SocialContentRow[] {
  return items
    .filter(item => item?.id != null)
    .map(item => {
      const authorRaw = item.author
      const handle =
        (typeof authorRaw === 'string' ? authorRaw.replace(/^@/, '') : authorRaw?.screenName) ||
        authorHandle ||
        null
      const metrics = item.metrics || {
        likes: item.likes,
        retweets: item.rts ?? item.retweets,
        replies: item.replies,
        quotes: item.quotes,
        views: item.views,
        bookmarks: item.bookmarks,
      }
      return {
        platform: 'twitter',
        content_type: contentType,
        external_id: String(item.id),
        author_handle: handle,
        subreddit: null,
        title: null,
        text: item.text || item.full_text || null,
        metrics_json: JSON.stringify(metrics),
        data_json: JSON.stringify(item),
        posted_at: item.createdAtISO || item.createdAt || item.time || null,
      }
    })
}

function toRedditPostRows(items: any[], username?: string): SocialContentRow[] {
  return items
    .filter(item => item?.id != null || item?.name)
    .map(item => ({
      platform: 'reddit',
      content_type: 'post',
      external_id: String(item.id || item.name),
      author_handle: item.author || username || null,
      subreddit: item.subreddit || null,
      title: item.title || null,
      text: item.selftext || item.title || item.body || null,
      metrics_json: JSON.stringify({ score: item.score, num_comments: item.num_comments }),
      data_json: JSON.stringify(item),
      posted_at: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
    }))
}

function toRedditCommentRows(items: any[], username?: string): SocialContentRow[] {
  return items
    .filter(item => item?.id != null || item?.name)
    .map(item => ({
      platform: 'reddit',
      content_type: 'comment',
      external_id: String(item.id || item.name),
      author_handle: item.author || username || null,
      subreddit: item.subreddit || null,
      title: item.link_title || null,
      text: item.body || null,
      metrics_json: JSON.stringify({ score: item.score ?? item.ups }),
      data_json: JSON.stringify(item),
      posted_at: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
    }))
}

export const SOCIAL_PERSIST_TOOLS = new Set([
  'twitter_user_posts',
  'twitter_replies',
  'reddit_user_posts',
  'reddit_user_comments',
])

export function persistSocialToolResult(
  toolName: string,
  args: Record<string, any>,
  result: CliResult | any,
): { inserted: number; updated: number; total: number; skipped: boolean } {
  const empty = { inserted: 0, updated: 0, total: 0, skipped: true }
  if (!SOCIAL_PERSIST_TOOLS.has(toolName)) return empty
  if (!result?.ok) return empty
  try {
    const items = extractDataArray(result as CliResult)
    if (items.length === 0) {
      logger.warn('social-content', `persist ${toolName}: 0 items in result`)
      return empty
    }

    let rows: SocialContentRow[] = []
    switch (toolName) {
      case 'twitter_user_posts':
        rows = toTwitterRows(items, 'post', args.handle)
        break
      case 'twitter_replies':
        rows = toTwitterRows(items, 'reply', args.handle)
        break
      case 'reddit_user_posts':
        rows = toRedditPostRows(items, args.username)
        break
      case 'reddit_user_comments':
        rows = toRedditCommentRows(items, args.username)
        break
      default:
        return empty
    }

    if (rows.length === 0) {
      logger.warn('social-content', `persist ${toolName}: ${items.length} items but 0 mappable rows`)
      return empty
    }

    const stats = upsertSocialContent(rows)
    logger.info('social-content', `persisted ${toolName}: ${stats.inserted} new, ${stats.updated} updated (${rows.length} items)`)
    return { ...stats, total: rows.length, skipped: false }
  } catch (e: any) {
    logger.warn('social-content', `persist failed for ${toolName}: ${e.message}`)
    return empty
  }
}

export async function fetchTwitterUserPosts(handle: string): Promise<CliResult> {
  const since = getSinceDate()
  const searchResult = await runTwitterCli([
    'search', '--from', handle, '--exclude', 'replies', '--since', since,
    '-n', String(MAX_SOCIAL_ITEMS), '--json',
  ], { compact: false })

  let items = extractDataArray(searchResult)
  if (!searchResult.ok || items.length === 0) {
    const fallback = await runTwitterCli(['user-posts', handle, '--max', String(MAX_SOCIAL_ITEMS), '--json'], { compact: false })
    if (!fallback.ok) return fallback
    items = extractDataArray(fallback)
    return { ok: true, data: trimToLookback(items, twitterItemTimestamp) }
  }

  return { ok: true, data: trimToLookback(items, twitterItemTimestamp) }
}

export async function fetchTwitterReplies(handle: string): Promise<CliResult> {
  const since = getSinceDate()
  const result = await runTwitterCli([
    'search', `from:${handle} filter:replies`, '--since', since,
    '-n', String(MAX_SOCIAL_ITEMS), '--json',
  ], { compact: false })
  if (!result.ok) return result
  const items = trimToLookback(extractDataArray(result), twitterItemTimestamp)
  return { ok: true, data: items }
}

async function fetchRedditPaginated(
  command: 'user-posts' | 'user-comments',
  username: string,
  getTs: (item: any) => number,
): Promise<CliResult> {
  const sinceMs = getSinceTimestamp()
  const allItems: any[] = []
  let after: string | undefined

  while (allItems.length < MAX_SOCIAL_ITEMS) {
      const batchSize = Math.min(100, MAX_SOCIAL_ITEMS - allItems.length)
      const args = [command, username, '--json', '-n', String(batchSize)]
      if (after) args.push('--after', after)

    const result = await runCli('rdt', args)
    if (!result.ok) {
      if (allItems.length > 0) return { ok: true, data: allItems }
      return result
    }

    const batch = extractDataArray(result)
    if (batch.length === 0) break

    for (const item of batch) {
      allItems.push(item)
      if (allItems.length >= MAX_SOCIAL_ITEMS) break
    }

    const oldestTs = Math.min(...allItems.map(getTs).filter(Boolean))
    if (oldestTs < sinceMs || allItems.length >= MAX_SOCIAL_ITEMS) break

    const nextAfter = getRedditAfterCursor(result)
    if (!nextAfter || batch.length < batchSize) break
    after = nextAfter
  }

  return { ok: true, data: trimToLookback(allItems, getTs) }
}

export async function fetchRedditUserPosts(username: string): Promise<CliResult> {
  return fetchRedditPaginated('user-posts', username, redditItemTimestamp)
}

export async function fetchRedditUserComments(username: string): Promise<CliResult> {
  return fetchRedditPaginated('user-comments', username, redditItemTimestamp)
}

function compactWhoamiProfile(data: Record<string, any>) {
  return {
    username: data.name,
    link_karma: data.link_karma,
    comment_karma: data.comment_karma,
    total_karma: data.total_karma,
    created_utc: data.created_utc,
    is_gold: data.is_gold,
    is_mod: data.is_mod,
    verified: data.verified,
    has_verified_email: data.has_verified_email,
    authenticated: true,
    capabilities: data._session?.capabilities,
  }
}

/** whoami requires auth; fall back to status + public user profile when session is missing. */
export async function fetchRedditWhoami(fallbackUsername?: string): Promise<CliResult> {
  await ensureRdtAuth()
  const whoami = await runCli('rdt', ['whoami', '--json'])
  if (whoami.ok && whoami.data && typeof whoami.data === 'object' && whoami.data.name) {
    return {
      ok: true,
      data: {
        ...compactWhoamiProfile(whoami.data),
        profile: whoami.data,
      },
    }
  }

  const status = await runCli('rdt', ['status', '--json'])
  const merged: Record<string, any> = {
    authenticated: Boolean(status.ok && status.data?.authenticated),
    username: status.data?.username || fallbackUsername || null,
    capabilities: status.data?.capabilities,
    source: status.data?.source,
    cookie_count: status.data?.cookie_count,
    modhash_present: status.data?.modhash_present,
    status_error: status.data?.error || whoami.error || null,
  }

  const lookupUser = fallbackUsername || status.data?.username
  if (lookupUser) {
    const pub = await runCli('rdt', ['user', lookupUser, '--json'])
    const profile = pub.ok ? (pub.data?.data ?? pub.data) : null
    if (profile && typeof profile === 'object') {
      merged.username = profile.name || lookupUser
      merged.link_karma = profile.link_karma
      merged.comment_karma = profile.comment_karma
      merged.total_karma = profile.total_karma ?? ((profile.link_karma || 0) + (profile.comment_karma || 0))
      merged.created_utc = profile.created_utc
      merged.public_profile = profile
    }
  }

  const hasData = merged.authenticated || merged.public_profile || merged.username
  return {
    ok: hasData,
    data: hasData ? merged : null,
    error: hasData ? undefined : (whoami.error || status.error || 'Reddit session not authenticated — log in to reddit.com in your browser, then retry onboarding'),
  }
}

export interface GatherCallbacks {
  onToolCall: (name: string, args: any) => void
  onToolResult: (name: string, result: any) => void
}

/** Pre-fetch social profile data for onboarding (2 months / max 100). */
export async function gatherOnboardingSocialData(
  profile: { twitter_handle?: string; reddit_username?: string },
  callbacks: GatherCallbacks,
): Promise<Record<string, any>> {
  const gathered: Record<string, any> = {}

  if (profile.twitter_handle) {
    const handle = profile.twitter_handle

    callbacks.onToolCall('twitter_whoami', {})
    const whoamiResult = await runCli('twitter', ['whoami', '--json'])
    callbacks.onToolResult('twitter_whoami', whoamiResult)
    gathered.twitter_whoami = whoamiResult

    callbacks.onToolCall('twitter_user', { handle })
    const userResult = await runCli('twitter', ['user', handle, '--json'])
    callbacks.onToolResult('twitter_user', userResult)
    gathered.twitter_user = userResult

    callbacks.onToolCall('twitter_user_posts', { handle, max: MAX_SOCIAL_ITEMS, since: getSinceDate() })
    const postsResult = await fetchTwitterUserPosts(handle)
    const postsPersist = persistSocialToolResult('twitter_user_posts', { handle }, postsResult)
    callbacks.onToolResult('twitter_user_posts', { ...postsResult, _persist: postsPersist })
    gathered.twitter_user_posts = postsResult
    gathered._social_persist = { ...(gathered._social_persist || {}), twitter_user_posts: postsPersist }

    callbacks.onToolCall('twitter_replies', { handle, max: MAX_SOCIAL_ITEMS, since: getSinceDate() })
    const repliesResult = await fetchTwitterReplies(handle)
    const repliesPersist = persistSocialToolResult('twitter_replies', { handle }, repliesResult)
    callbacks.onToolResult('twitter_replies', { ...repliesResult, _persist: repliesPersist })
    gathered.twitter_replies = repliesResult
    gathered._social_persist = { ...(gathered._social_persist || {}), twitter_replies: repliesPersist }

    // Following — niche map, competitors, potential targets
    callbacks.onToolCall('twitter_following', { handle, max: 50 })
    const followingResult = await runTwitterCli(['following', handle, '--json', '-n', '50'])
    callbacks.onToolResult('twitter_following', followingResult)
    gathered.twitter_following = followingResult

    // Likes — content taste and preferences (authenticated user only)
    const screenName = whoamiResult.data?.user?.screenName || whoamiResult.data?.user?.username || handle
    callbacks.onToolCall('twitter_likes', { handle: screenName, max: 30 })
    const likesResult = await runTwitterCli(['likes', screenName, '--json', '-n', '30'], { compact: false })
    callbacks.onToolResult('twitter_likes', likesResult)
    gathered.twitter_likes = likesResult

    // Bookmarks — reference-worthy content the user saved
    callbacks.onToolCall('twitter_bookmarks', { max: 20 })
    const bookmarksResult = await runTwitterCli(['bookmarks', '--json', '-n', '20'], { compact: false })
    callbacks.onToolResult('twitter_bookmarks', bookmarksResult)
    gathered.twitter_bookmarks = bookmarksResult
  }

  if (profile.reddit_username) {
    const username = profile.reddit_username

    callbacks.onToolCall('reddit_user_posts', { username, max: MAX_SOCIAL_ITEMS, since: getSinceDate() })
    const postsResult = await fetchRedditUserPosts(username)
    const postsPersist = persistSocialToolResult('reddit_user_posts', { username }, postsResult)
    callbacks.onToolResult('reddit_user_posts', { ...postsResult, _persist: postsPersist })
    gathered.reddit_user_posts = postsResult
    gathered._social_persist = { ...(gathered._social_persist || {}), reddit_user_posts: postsPersist }

    callbacks.onToolCall('reddit_user_comments', { username, max: MAX_SOCIAL_ITEMS, since: getSinceDate() })
    const commentsResult = await fetchRedditUserComments(username)
    const commentsPersist = persistSocialToolResult('reddit_user_comments', { username }, commentsResult)
    callbacks.onToolResult('reddit_user_comments', { ...commentsResult, _persist: commentsPersist })
    gathered.reddit_user_comments = commentsResult
    gathered._social_persist = { ...(gathered._social_persist || {}), reddit_user_comments: commentsPersist }

    callbacks.onToolCall('reddit_whoami', {})
    const whoamiResult = await fetchRedditWhoami(profile.reddit_username)
    callbacks.onToolResult('reddit_whoami', whoamiResult)
    gathered.reddit_whoami = whoamiResult

    // Subscribed subreddits — communities the user already participates in
    callbacks.onToolCall('reddit_feed', { subs_only: true, max: 25 })
    const feedResult = await runCli('rdt', ['feed', '--json', '--subs-only', '-n', '25'])
    callbacks.onToolResult('reddit_feed', feedResult)
    gathered.reddit_feed = feedResult
  }

  return gathered
}
