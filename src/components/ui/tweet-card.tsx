import { useState, useEffect, useRef, type ReactNode } from 'react'
import { cn } from 'src/lib/utils'
import {
  Send,
  Loader2,
  Clock,
  Repeat2,
  MessageCircle,
  Heart,
  BarChart2,
  Bookmark,
  Share2,
  Pin,
} from 'lucide-react'
import { PostAttachments, PostAttachment, extractTweetAttachments, expandTweetLinks } from 'src/components/ui/post-attachment'
import { ReplyModal } from 'src/components/ui/reply-modal'
import { getCachedPost, cachePost } from 'src/lib/post-cache'

const fetchCache = new Map<string, Promise<any>>()

// ponytail: strip trailing t.co media links from text when media is shown as attachment
function stripMediaLinks(text: string, media: any[]): string {
  if (!Array.isArray(media) || media.length === 0) return text
  return text.replace(/(\s*https:\/\/t\.co\/\S+)+\s*$/, '').trim()
}

/** X avatar URLs carry a size suffix (mini 24 / normal 48 / bigger 73 px);
 *  request the 400×400 variant so rendered avatars are never upscaled. */
function upgradeAvatarUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string' || !url) return url
  return url.replace(/_(mini|normal|bigger)(\.\w+)(\?.*)?$/, '_400x400$2$3')
}

export function parseTweetData(raw: any): TweetCardProps {
  const author = typeof raw.author === 'object' && raw.author ? raw.author : null
  const authorStr = typeof raw.author === 'string' ? raw.author.replace(/^@/, '') : null
  const handle = author?.screenName || author?.username || authorStr || raw.screenName || raw.userName || raw.username
  const name = author?.name || author?.displayName || raw.name || raw.displayName || handle
  const metrics = raw.metrics || {}
  return {
    id: raw.id,
    authorName: name,
    authorHandle: handle,
    authorImage: upgradeAvatarUrl(author?.profileImageUrl || author?.profileImageURL || raw.profileImageUrl),
    content: stripMediaLinks(expandTweetLinks(raw.text || raw.full_text || '', raw), raw.media),
    likes: metrics.likes ?? raw.likes ?? 0,
    retweets: metrics.retweets ?? raw.rts ?? raw.retweets ?? 0,
    replies: metrics.replies ?? raw.replies ?? 0,
    bookmarks: metrics.bookmarks ?? raw.bookmarks ?? 0,
    views: metrics.views ?? raw.views ?? 0,
    quotes: metrics.quotes ?? raw.quotes ?? 0,
    isRetweet: Boolean(raw.isRetweet ?? raw.is_retweet),
    retweetedBy: raw.retweetedBy ?? raw.retweeted_by,
    quotedTweet: raw.quotedTweet ?? raw.quoted_tweet,
    timestamp: raw.createdAtLocal || raw.createdAtISO || raw.createdAt || raw.time,
    verified: author?.verified ?? raw.verified,
    isPinned: Boolean(raw.pinned ?? raw.isPinned),
    // Viewer state (X `favorited`/`retweeted`) — distinct from isRetweet
    // ("this tweet IS a repost of someone else").
    isLiked: Boolean(raw.liked ?? raw.isLiked),
    isRetweeted: Boolean(raw.retweeted ?? raw.isRetweeted),
    attachments: extractTweetAttachments(raw),
  }
}

export function timeAgo(timestampStr?: string): string {
  if (!timestampStr) return ''
  const parsedTime = Date.parse(timestampStr)
  if (isNaN(parsedTime)) {
    // If it's already a relative time like "2h" or custom string, return as is
    return timestampStr
  }

  const now = Date.now()
  const diffSec = Math.floor((now - parsedTime) / 1000)

  if (diffSec < 0) return timestampStr
  if (diffSec < 60) return `${Math.max(1, diffSec)}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`

  const date = new Date(parsedTime)
  const nowDate = new Date(now)
  const isSameYear = date.getFullYear() === nowDate.getFullYear()
  const monthStr = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()

  if (isSameYear) {
    return `${monthStr} ${day}`
  }
  return `${monthStr} ${day}, ${date.getFullYear()}`
}

function pickTweetData(list: any[] | null | undefined, targetId?: string): any | null {
  if (!Array.isArray(list) || list.length === 0) return null
  if (!targetId) return list[0]
  return list.find((item) => String(item?.id) === String(targetId)) || list[0]
}

function dedupedFetch(id: string): Promise<any> {
  if (!fetchCache.has(id)) {
    fetchCache.set(id, window.api.twitterTweet(id))
    fetchCache.get(id)!.finally(() => fetchCache.delete(id))
  }
  return fetchCache.get(id)!
}

export interface TweetCardProps {
  id?: string
  tweetId?: string
  replyId?: string
  authorName?: string
  authorHandle?: string
  authorImage?: string
  content?: string
  likes?: number
  retweets?: number
  replies?: number
  bookmarks?: number
  views?: number
  quotes?: number
  isRetweet?: boolean
  retweetedBy?: string
  quotedTweet?: {
    id: string
    text: string
    author?: { screenName: string; name: string; profileImageUrl?: string; verified?: boolean }
    /** Present via quote-media patch — enables the quote's own preview. */
    media?: Array<{ type: string; url: string; width?: number; height?: number }>
    urls?: string[]
    createdAtISO?: string
    createdAt?: string
    createdAtLocal?: string
  }
  onLike?: () => void
  onRetweet?: () => void
  onBookmark?: () => void
  onShare?: () => void
  timestamp?: string
  verified?: boolean
  replyTo?: { authorName: string; authorHandle: string }
  onPost?: () => void
  posting?: boolean
  className?: string
  repliesList?: TweetCardProps[]
  preview?: boolean
  attachments?: PostAttachment[]
  showPostButton?: boolean
  variant?: 'card' | 'feed'
  isLiked?: boolean
  isRetweeted?: boolean
  isBookmarked?: boolean
  /** Profile Posts only — the pinned tweet lands first (X convention). */
  isPinned?: boolean
}

function VerifiedBadge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 22" className={cn('size-4 fill-current', className)} aria-label="Verified">
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
    </svg>
  )
}

function fmt(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function shortDisplayUrl(url: string): string {
  try {
    const u = new URL(url)
    let display = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '')
    if (display.endsWith('/')) display = display.slice(0, -1)
    if (u.search) display += u.search
    if (display.length > 27) return display.slice(0, 27) + '\u2026'
    return display
  } catch {
    return url.length > 30 ? url.slice(0, 30) + '\u2026' : url
  }
}

function formatRichContent(text: string): ReactNode {
  if (!text) return text

  // Regex to match URLs, #hashtags, and @mentions
  const tokenRegex = /(https?:\/\/[^\s]+|#[\w\u0590-\u05ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|@\w+)/g
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('http://') || token.startsWith('https://')) {
      const display = shortDisplayUrl(token)
      parts.push(
        <a
          key={match.index}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#1D9BF0] hover:underline"
          title={token}
        >
          {display}
        </a>
      )
    } else if (token.startsWith('@')) {
      const handle = token.slice(1)
      parts.push(
        <a
          key={match.index}
          href={`https://x.com/${handle}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#1D9BF0] hover:underline"
        >
          {token}
        </a>
      )
    } else if (token.startsWith('#')) {
      const tag = token.slice(1)
      parts.push(
        <a
          key={match.index}
          href={`https://x.com/hashtag/${tag}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#1D9BF0] hover:underline"
        >
          {token}
        </a>
      )
    }
    lastIndex = tokenRegex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function ExpandableTweetContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      if (expanded) return
      // Check overflow when clamped to 11 lines
      if (el.scrollHeight > el.clientHeight + 4) {
        setIsOverflowing(true)
      } else if (text.length > 360 || (text.match(/\n/g) || []).length > 8) {
        // Heuristic for long text that might overflow due to wrapping
        requestAnimationFrame(() => {
          if (el.scrollHeight > el.clientHeight + 4) setIsOverflowing(true)
        })
      }
    }
    check()
    // ResizeObserver is unavailable in some embedders (jsdom) — the initial
    // check already covers the static case.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])

  return (
    <div>
      <div
        ref={ref}
        className="text-[15px] leading-snug text-foreground whitespace-pre-wrap break-words"
        style={
          !expanded
            ? { display: '-webkit-box', WebkitLineClamp: 11, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : undefined
        }
      >
        {formatRichContent(text)}
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="mt-1 text-[14px] leading-none text-[#1D9BF0] hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function TweetReplyNode({ reply, depth = 0 }: { reply: TweetCardProps; depth: number }) {
  const displayContent = reply.content || ''
  return (
    <div className="mt-3 pl-3.5 border-l border-border/60 hover:border-border transition-colors py-1">
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-full overflow-hidden bg-muted flex-shrink-0">
          {reply.authorImage ? (
            <img src={reply.authorImage} alt={reply.authorName} className="size-full object-cover" />
          ) : (
            <div className="size-full flex items-center justify-center text-[10px] font-medium text-muted-foreground">
              {reply.authorName?.[0]}
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <span className="flex items-center gap-0.5 text-xs font-semibold text-foreground">
            {reply.authorName}
            {reply.verified && <VerifiedBadge className="text-[#1C9BF1] size-3" />}
          </span>
          <span className="text-[10px] text-muted-foreground -mt-0.5">@{reply.authorHandle}</span>
        </div>
        {reply.timestamp && (
          <span className="text-[10px] text-muted-foreground ml-auto">{reply.timestamp}</span>
        )}
      </div>

      <p className="mt-1 text-[13.5px] leading-snug text-foreground whitespace-pre-wrap">{displayContent}</p>

      <PostAttachments attachments={reply.attachments} className="mt-1" />

      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
        {(reply.likes !== undefined && reply.likes > 0) && <span><strong>{fmt(reply.likes)}</strong> Likes</span>}
        {(reply.retweets !== undefined && reply.retweets > 0) && <span><strong>{fmt(reply.retweets)}</strong> Reposts</span>}
      </div>

      {reply.repliesList && reply.repliesList.length > 0 && (
        <div className="mt-1 space-y-1">
          {reply.repliesList.map((child, i) => (
            <TweetReplyNode key={child.id || i} reply={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TweetCard({
  id, tweetId, replyId, authorName, authorHandle, authorImage, content, likes = 0, retweets = 0,
  replies = 0, bookmarks = 0, views = 0, quotes = 0, isRetweet, retweetedBy, quotedTweet,
  onLike, onRetweet, onBookmark, onShare, timestamp, verified, replyTo, onPost, posting, className,
  repliesList, preview, attachments, showPostButton, variant = 'card',
  isLiked, isRetweeted, isBookmarked, isPinned,
}: TweetCardProps) {
  const [loadedData, setLoadedData] = useState<TweetCardProps | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedReply, setLoadedReply] = useState<TweetCardProps | null>(null)

  const activeId = tweetId || id

  useEffect(() => {
    if (!activeId || content) return
    const cacheKey = `tw:${activeId}`
    const cached = getCachedPost(cacheKey)

    const cachedTweet = pickTweetData(cached?.data, activeId)
    if (cachedTweet) {
      setLoadedData(parseTweetData(cachedTweet))
      setLoading(false)
      if (cached?.isStale) {
        dedupedFetch(activeId).then((res: any) => {
          if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
            cachePost(cacheKey, res.data)
            const freshTweet = pickTweetData(res.data, activeId)
            if (freshTweet) setLoadedData(parseTweetData(freshTweet))
          }
        }).catch(() => {})
      }
      return
    }

    setLoading(true)
    setError(null)
    dedupedFetch(activeId)
      .then((res: any) => {
        if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
          cachePost(cacheKey, res.data)
          const tweet = pickTweetData(res.data, activeId)
          if (tweet) setLoadedData(parseTweetData(tweet))
        } else if (res.error?.code === 'rate_limited') {
          setError('Rate limited. Try again in a few minutes.')
        } else {
          setError('Failed to fetch tweet details')
        }
        setLoading(false)
      })
      .catch((err: any) => {
        setError(err.message || 'Error loading tweet')
        setLoading(false)
      })
  }, [activeId, content])

  useEffect(() => {
    if (!replyId) { setLoadedReply(null); return }
    const cacheKey = `tw:${replyId}`
    const cached = getCachedPost(cacheKey)

    const cachedReply = pickTweetData(cached?.data, replyId)
    if (cachedReply) {
      setLoadedReply(parseTweetData(cachedReply))
      if (cached?.isStale) {
        dedupedFetch(replyId).then((res: any) => {
          if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
            cachePost(cacheKey, res.data)
            const freshReply = pickTweetData(res.data, replyId)
            if (freshReply) setLoadedReply(parseTweetData(freshReply))
          }
        }).catch(() => {})
      }
      return
    }

    dedupedFetch(replyId).then((res: any) => {
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        cachePost(cacheKey, res.data)
        const reply = pickTweetData(res.data, replyId)
        if (reply) setLoadedReply(parseTweetData(reply))
      }
    }).catch(() => {})
  }, [replyId])

  if (loading) {
    return (
      <div className={cn('w-full max-w-[560px] rounded-xl p-6 bg-card border border-border flex flex-col items-center justify-center min-h-[140px] gap-2.5', className)}>
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground font-medium">Loading tweet thread...</span>
      </div>
    )
  }

  if (error) {
    const isRateLimit = error === 'Rate limited. Try again in a few minutes.'
    return (
      <div className={cn('w-full max-w-[560px] rounded-xl p-4 bg-card border border-destructive/30 text-destructive text-sm', className)}>
        <div className="flex items-center gap-2 mb-1">
          {isRateLimit && <Clock className="size-4 shrink-0" />}
          <p className="font-semibold">{isRateLimit ? 'Rate limited' : 'Failed to load tweet'}</p>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  const displayData = loadedData || {
    authorName, authorHandle, authorImage, content, likes, retweets,
    replies, bookmarks, views, quotes, isRetweet, retweetedBy, quotedTweet,
    onLike, onRetweet, onBookmark, onShare,
    timestamp, verified, replyTo, onPost, posting, repliesList, attachments, showPostButton, variant,
    isLiked, isRetweeted, isBookmarked, isPinned,
  }

  const resolvedReplies = loadedReply
    ? [loadedReply, ...(displayData.repliesList || [])]
    : displayData.repliesList

  const tweetIdForLink = activeId || displayData.id
  const tweetUrl = displayData.authorHandle && tweetIdForLink
    ? `https://x.com/${displayData.authorHandle}/status/${tweetIdForLink}`
    : displayData.authorHandle
      ? `https://x.com/${displayData.authorHandle}`
      : 'https://x.com'

  const isFeed = (variant || displayData.variant) === 'feed'

  // Optimistic state for Human actions — local UI updates instantly, reverts on IPC failure
  const [liked, setLiked] = useState(displayData.isLiked ?? false)
  const [likeCount, setLikeCount] = useState(displayData.likes ?? 0)
  const [retweeted, setRetweeted] = useState(displayData.isRetweeted ?? false)
  const [retweetCount, setRetweetCount] = useState(displayData.retweets ?? 0)
  const [bookmarked, setBookmarked] = useState(displayData.isBookmarked ?? false)
  const [showCopied, setShowCopied] = useState(false)
  // Human reply modal (comment button)
  const [replyOpen, setReplyOpen] = useState(false)
  const [extraReplies, setExtraReplies] = useState(0)

  useEffect(() => {
    setLiked(displayData.isLiked ?? false)
    setLikeCount(displayData.likes ?? 0)
    setRetweeted(displayData.isRetweeted ?? false)
    setRetweetCount(displayData.retweets ?? 0)
    setBookmarked(displayData.isBookmarked ?? false)
  }, [displayData.id, displayData.isLiked, displayData.likes, displayData.isRetweeted, displayData.retweets, displayData.isBookmarked])

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onLike) { onLike(); return }
    const tid = tweetIdForLink
    if (!tid || !/^\d+$/.test(String(tid))) return
    const next = !liked
    setLiked(next); setLikeCount((c) => c + (next ? 1 : -1))
    try {
      const res: any = await (window as any).api?.humanLike?.({ tweetId: String(tid), action: next ? 'like' : 'unlike' })
      if (res && res.ok === false) {
        const msg = res.error?.message || res.error || ''
        if (/already/i.test(msg)) return
        throw new Error(msg || 'like failed')
      }
    } catch {
      setLiked(!next); setLikeCount((c) => c + (next ? -1 : 1))
    }
  }

  const handleRetweet = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onRetweet) { onRetweet(); return }
    const tid = tweetIdForLink
    if (!tid || !/^\d+$/.test(String(tid))) return
    const next = !retweeted
    setRetweeted(next); setRetweetCount((c) => c + (next ? 1 : -1))
    try {
      const res: any = await (window as any).api?.humanRetweet?.({ tweetId: String(tid), action: next ? 'retweet' : 'unretweet' })
      if (res && res.ok === false) {
        const msg = res.error?.message || res.error || ''
        if (/already/i.test(msg)) return
        throw new Error(msg)
      }
    } catch {
      setRetweeted(!next); setRetweetCount((c) => c + (next ? -1 : 1))
    }
  }

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onBookmark) { onBookmark(); return }
    const tid = tweetIdForLink
    if (!tid || !/^\d+$/.test(String(tid))) return
    const next = !bookmarked
    setBookmarked(next)
    try {
      const res: any = await (window as any).api?.humanBookmark?.({ tweetId: String(tid), action: next ? 'bookmark' : 'unbookmark' })
      if (res && res.ok === false) {
        const msg = res.error?.message || res.error || ''
        if (/already/i.test(msg)) return
        throw new Error(msg)
      }
    } catch {
      setBookmarked(!next)
    }
  }

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onShare) { onShare(); return }
    const url = tweetUrl
    try {
      await navigator.clipboard.writeText(url)
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 1500)
    } catch {
      // Fallback: open prompt
      window.prompt('Copy link', url)
    }
  }

  if (isFeed) {
    const isRetweet = displayData.isRetweet || Boolean(displayData.retweetedBy)

    return (
      // No row-level click-through: opening x.com happens only through
      // explicit affordances (text links, the card's X anchor, share).
      <div
        className={cn(
          'w-full border-b border-border/60 hover:bg-white/[0.02] transition-colors px-4 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_180px]',
          className
        )}
      >
        {/* Pinned header (profile Posts) — X convention, above attribution */}
        {displayData.isPinned && !isRetweet && (
          <div className="flex items-center gap-2 mb-1.5 ml-8 text-xs font-semibold text-muted-foreground">
            <Pin className="size-3.5" />
            <span>Pinned</span>
          </div>
        )}

        {/* Retweet header attribution */}
        {isRetweet && (
          <div className="flex items-center gap-2 mb-1.5 ml-8 text-xs font-semibold text-muted-foreground">
            <Repeat2 className="size-3.5" />
            <span>{displayData.retweetedBy ? `${displayData.retweetedBy} reposted` : 'Reposted'}</span>
          </div>
        )}

        {/* Reply to context */}
        {displayData.replyTo && (
          <div className="text-xs text-muted-foreground mb-1 ml-12">
            Replying to <span className="text-[#1D9BF0]">@{displayData.replyTo.authorHandle}</span>
          </div>
        )}

        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="size-10 rounded-full overflow-hidden bg-muted flex-shrink-0">
            {displayData.authorImage ? (
              <img src={displayData.authorImage} alt={displayData.authorName} className="size-full object-cover" />
            ) : (
              <div className="size-full flex items-center justify-center text-sm font-medium text-muted-foreground">
                {displayData.authorName?.[0]}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Inline Header */}
            <div className="flex items-center gap-1 leading-5 min-w-0 overflow-hidden text-[15px]">
              <span className="font-bold text-foreground hover:underline truncate">
                {displayData.authorName}
              </span>
              {displayData.verified && <VerifiedBadge className="text-[#1D9BF0] shrink-0" />}
              <span className="text-muted-foreground text-sm truncate">@{displayData.authorHandle}</span>
              {displayData.timestamp && (
                <>
                  <span className="text-muted-foreground text-sm">·</span>
                  <span className="text-muted-foreground text-sm shrink-0">{timeAgo(displayData.timestamp)}</span>
                </>
              )}
            </div>

            {/* Content with rich highlights — 11-line clamp with Show more */}
            {displayData.content && (
              <div className="mt-1">
                <ExpandableTweetContent text={displayData.content} />
              </div>
            )}

            {/* Attachments */}
            {displayData.attachments && displayData.attachments.length > 0 && (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <PostAttachments attachments={displayData.attachments} mediaClassName="rounded-2xl" />
              </div>
            )}

            {/* Quoted Tweet — X-style quote (Image 2) */}
            {displayData.quotedTweet && (() => {
              const q = displayData.quotedTweet as any
              const qa = q.author as any
              const qName = qa?.name || qa?.screenName || ''
              const qHandle = qa?.screenName || ''
              const qAvatar = upgradeAvatarUrl(qa?.profileImageUrl || qa?.profileImageURL)
              const qVerified = Boolean(qa?.verified)
              const qTime = q.createdAtISO || q.createdAt || q.createdAtLocal
              // X behavior: the quote shows its own media/og preview only when
              // the quoting tweet has no attachment of its own — never both.
              const qAttachments =
                displayData.attachments && displayData.attachments.length > 0
                  ? []
                  : extractTweetAttachments(q)
              return (
              // No click-through to x.com — the quote is content, not a link.
              <div className="mt-3 rounded-2xl border border-white/[0.12] overflow-hidden">
                <div className="p-3 pb-0">
                  {qHandle && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="size-5 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0">
                        {qAvatar ? (
                          <img src={qAvatar} alt={qName} className="size-full object-cover" />
                        ) : (
                          <div className="size-full flex items-center justify-center text-[10px] font-medium text-zinc-400">
                            {qName?.[0] || qHandle[0] || '?'}
                          </div>
                        )}
                      </div>
                      <span className="text-[13px] font-bold text-foreground truncate">{qName || qHandle}</span>
                      {qVerified && <VerifiedBadge className="size-3.5 text-[#1D9BF0] shrink-0" />}
                      <span className="text-[13px] text-zinc-500 truncate">@{qHandle}</span>
                      {qTime && (
                        <>
                          <span className="text-zinc-500 text-[13px]">·</span>
                          <span className="text-[13px] text-zinc-500 shrink-0">{timeAgo(qTime)}</span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-1.5 pb-3 text-[14px] leading-[19px] text-foreground whitespace-pre-wrap break-words line-clamp-4">
                    {formatRichContent(stripMediaLinks(expandTweetLinks(q.text || '', q), q.media))}
                  </div>
                </div>
                {qAttachments.length > 0 && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <PostAttachments
                      attachments={qAttachments}
                      // Flush inside the quote card: square media, bottom edge-to-edge.
                      mediaClassName="rounded-none rounded-b-2xl border-x-0 border-b-0 border-t-0"
                    />
                  </div>
                )}
              </div>
              )
            })()}

            {/* Action Bar — full-width, bookmark+share grouped (Image 1) */}
            <div
              className="mt-3 flex w-full items-center justify-between text-muted-foreground text-[13px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Reply — comment not yet implemented, keep inert */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!preview) setReplyOpen(true)
                }}
                className="group flex items-center gap-1.5 hover:text-[#1D9BF0] transition-colors -ml-1.5"
                aria-label="Reply"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <MessageCircle className="size-4" />
                </div>
                {(displayData.replies ?? 0) + extraReplies > 0 && (
                  <span className="text-xs">{fmt((displayData.replies ?? 0) + extraReplies)}</span>
                )}
              </button>

              {/* Repost */}
              <button
                type="button"
                onClick={handleRetweet}
                className={cn(
                  'group flex items-center gap-1.5 transition-colors',
                  retweeted ? 'text-[#00BA7C]' : 'hover:text-[#00BA7C]'
                )}
                aria-label={retweeted ? 'Unrepost' : 'Repost'}
                aria-pressed={retweeted}
              >
                <div className={cn('p-1.5 rounded-full transition-colors', retweeted ? 'bg-[#00BA7C]/10' : 'group-hover:bg-[#00BA7C]/10')}>
                  <Repeat2 className={cn('size-4', retweeted && 'fill-current')} />
                </div>
                {retweetCount > 0 && (
                  <span className="text-xs">{fmt(retweetCount)}</span>
                )}
              </button>

              {/* Like */}
              <button
                type="button"
                onClick={handleLike}
                className={cn(
                  'group flex items-center gap-1.5 transition-colors',
                  liked ? 'text-[#F91880]' : 'hover:text-[#F91880]'
                )}
                aria-label={liked ? 'Unlike' : 'Like'}
                aria-pressed={liked}
              >
                <div className={cn('p-1.5 rounded-full transition-colors', liked ? 'bg-[#F91880]/10' : 'group-hover:bg-[#F91880]/10')}>
                  <Heart className={cn('size-4', liked && 'fill-[#F91880] text-[#F91880]')} />
                </div>
                {likeCount > 0 && (
                  <span className="text-xs">{fmt(likeCount)}</span>
                )}
              </button>

              {/* Views */}
              <div className="group flex items-center gap-1.5 hover:text-[#1D9BF0] transition-colors">
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <BarChart2 className="size-4" />
                </div>
                {displayData.views !== undefined && displayData.views > 0 && (
                  <span className="text-xs">{fmt(displayData.views)}</span>
                )}
              </div>

              {/* Bookmark + Share grouped */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={handleBookmark}
                  className={cn(
                    'group flex items-center transition-colors',
                    bookmarked ? 'text-[#1D9BF0]' : 'hover:text-[#1D9BF0]'
                  )}
                  aria-label={bookmarked ? 'Unbookmark' : 'Bookmark'}
                  aria-pressed={bookmarked}
                >
                  <div className={cn('p-1.5 rounded-full transition-colors', bookmarked ? 'bg-[#1D9BF0]/10' : 'group-hover:bg-[#1D9BF0]/10')}>
                    <Bookmark className={cn('size-4', bookmarked && 'fill-[#1D9BF0] text-[#1D9BF0]')} />
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="group flex items-center hover:text-[#1D9BF0] transition-colors -mr-1.5"
                  aria-label={showCopied ? 'Copied' : 'Share'}
                >
                  <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                    {showCopied ? (
                      // Fixed 16×16 box — same footprint as the Share2 icon.
                      // A bare text span's line box grew the action row by a
                      // few px while the checkmark was showing.
                      <span className="flex size-4 items-center justify-center text-[10px] font-bold leading-none">✓</span>
                    ) : (
                      <Share2 className="size-4" />
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Replies List for feed variant */}
            {resolvedReplies && resolvedReplies.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-2 space-y-1">
                {resolvedReplies.map((reply, i) => (
                  <TweetReplyNode key={reply.id || i} reply={reply} depth={1} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Human reply dialog (comment button) */}
        {!preview && replyOpen && (
          <ReplyModal
            open={replyOpen}
            onClose={() => setReplyOpen(false)}
            onPosted={() => setExtraReplies((n) => n + 1)}
            tweet={{
              id: tweetIdForLink,
              authorName: displayData.authorName,
              authorHandle: displayData.authorHandle,
              authorImage: displayData.authorImage,
              verified: displayData.verified,
              content: displayData.content,
              timestampLabel: timeAgo(displayData.timestamp),
              quotedTweet: displayData.quotedTweet as any,
              // Media (fast-path refusal + drafting context) — links excluded.
              media: (displayData.attachments ?? [])
                .filter((a) => a.type !== 'link' && a.url)
                .map((a) => ({ type: a.type === 'image' ? 'photo' : String(a.type ?? ''), url: a.url ?? '' })),
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'w-full max-w-[560px] rounded-xl p-4',
      'bg-card border border-border shadow-sm',
      className
    )}>
      {displayData.replyTo && (
        <div className="text-xs text-muted-foreground mb-2">
          Replying to @{displayData.replyTo.authorHandle}
        </div>
      )}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-full overflow-hidden bg-muted flex-shrink-0">
            {displayData.authorImage
              ? <img src={displayData.authorImage} alt={displayData.authorName} className="size-full object-cover" />
              : <div className="size-full flex items-center justify-center text-sm font-medium text-muted-foreground">{displayData.authorName?.[0]}</div>
            }
          </div>
          <div className="flex flex-col">
            <span className="flex items-center gap-1 text-[15px] font-semibold text-foreground">
              {displayData.authorName}
              {displayData.verified && <VerifiedBadge className="text-[#1C9BF1]" />}
            </span>
            <span className="-mt-0.5 text-[13px] text-muted-foreground">@{displayData.authorHandle}</span>
          </div>
        </div>
        {!preview && (
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
        )}
      </div>

      <p className="mt-3 text-[15px] leading-6 text-foreground whitespace-pre-wrap">{displayData.content}</p>

      <PostAttachments attachments={displayData.attachments} className="mt-2" />

      {displayData.timestamp && (
        <div className="mt-3 text-[13px] text-muted-foreground">{displayData.timestamp}</div>
      )}

      <div className="mt-3 flex items-center gap-5 border-t border-border pt-3 text-[13px] text-muted-foreground">
        {displayData.replies !== undefined && displayData.replies > 0 && <span><strong className="text-foreground">{fmt(displayData.replies)}</strong> Replies</span>}
        {displayData.retweets !== undefined && displayData.retweets > 0 && <span><strong className="text-foreground">{fmt(displayData.retweets)}</strong> Reposts</span>}
        {displayData.likes !== undefined && displayData.likes > 0 && <span><strong className="text-foreground">{fmt(displayData.likes)}</strong> Likes</span>}
        {displayData.bookmarks !== undefined && displayData.bookmarks > 0 && <span><strong className="text-foreground">{fmt(displayData.bookmarks)}</strong> Bookmarks</span>}
        {displayData.views !== undefined && displayData.views > 0 && <span><strong className="text-foreground">{fmt(displayData.views)}</strong> Views</span>}
        {displayData.quotes !== undefined && displayData.quotes > 0 && <span><strong className="text-foreground">{fmt(displayData.quotes)}</strong> Quotes</span>}
        {showPostButton && onPost && (
          <button onClick={onPost} disabled={posting} className="ml-auto flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Post
          </button>
        )}
      </div>

      {resolvedReplies && resolvedReplies.length > 0 && (
        <div className="mt-4 border-t border-border pt-2 space-y-1">
          {resolvedReplies.map((reply, i) => (
            <TweetReplyNode key={reply.id || i} reply={reply} depth={1} />
          ))}
        </div>
      )}
    </div>
  )
}

interface TweetThreadProps {
  tweets: TweetCardProps[]
  className?: string
}

export function TweetThread({ tweets, className }: TweetThreadProps) {
  return (
    <div className={cn('w-full max-w-[560px] space-y-1', className)}>
      {tweets.map((tweet, i) => (
        <div key={i} className={cn(i < tweets.length - 1 && 'border-l-2 border-border pl-4 ml-4')}>
          <TweetCard {...tweet} />
        </div>
      ))}
    </div>
  )
}

interface TwitterReplyPreviewProps {
  original?: TweetCardProps
  originalId?: string
  replyContent?: string
  replyId?: string
  replyHandle?: string
  replyName?: string
  onPost?: () => void
  showPostButton?: boolean
  className?: string
}

export function TwitterReplyPreview({ original, originalId, replyContent, replyId, replyHandle, replyName, onPost, showPostButton, className }: TwitterReplyPreviewProps) {
  return (
    <div className={cn('w-full max-w-[560px]', className)}>
      {originalId ? <TweetCard tweetId={originalId} /> : <TweetCard {...original} />}
      <div className="ml-6 mt-1 border-l-2 border-border pl-4">
        <div className="rounded-xl bg-muted/50 border border-border p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {replyId ? 'Reply' : `Proposed reply ${replyName ? `as ${replyName}` : ''}`}
            </span>
            {showPostButton && onPost && (
              <button onClick={onPost} className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                <Send className="size-3.5" />
                Send
              </button>
            )}
          </div>
          {replyId ? <TweetCard tweetId={replyId} /> : <p className="text-[14px] leading-5 text-foreground whitespace-pre-wrap">{replyContent}</p>}
        </div>
      </div>
    </div>
  )
}

export const ReplyPreview = TwitterReplyPreview
