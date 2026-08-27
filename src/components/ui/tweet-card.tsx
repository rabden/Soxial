import { useState, useEffect, type ReactNode } from 'react'
import { cn, openExternalUrl } from 'src/lib/utils'
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
  Ellipsis,
} from 'lucide-react'
import { PostAttachments, PostAttachment, extractTweetAttachments, expandTweetLinks } from 'src/components/ui/post-attachment'
import { getCachedPost, cachePost } from 'src/lib/post-cache'

const fetchCache = new Map<string, Promise<any>>()

// ponytail: strip trailing t.co media links from text when media is shown as attachment
function stripMediaLinks(text: string, media: any[]): string {
  if (!Array.isArray(media) || media.length === 0) return text
  return text.replace(/(\s*https:\/\/t\.co\/\S+)+\s*$/, '').trim()
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
    authorImage: author?.profileImageUrl || author?.profileImageURL || raw.profileImageUrl,
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
  quotedTweet?: { id: string; text: string; author?: { screenName: string; name: string } }
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
      parts.push(
        <a
          key={match.index}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#1D9BF0] hover:underline"
        >
          {token}
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
  repliesList, preview, attachments, showPostButton, variant = 'card'
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
    timestamp, verified, replyTo, onPost, posting, repliesList, attachments, showPostButton, variant
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

  if (isFeed) {
    const isRetweet = displayData.isRetweet || Boolean(displayData.retweetedBy)

    return (
      <div
        onClick={() => {
          if (!preview && tweetUrl) {
            openExternalUrl(tweetUrl)
          }
        }}
        className={cn(
          'w-full border-b border-border/60 hover:bg-white/[0.02] transition-colors px-4 py-3 cursor-pointer',
          className
        )}
      >
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
            <div className="flex items-center justify-between gap-1 leading-5">
              <div className="flex items-center gap-1 min-w-0 overflow-hidden text-[15px] truncate">
                <span className="font-bold text-foreground hover:underline truncate">
                  {displayData.authorName}
                </span>
                {displayData.verified && <VerifiedBadge className="text-[#1D9BF0] shrink-0" />}
                <span className="text-muted-foreground text-sm truncate">
                  @{displayData.authorHandle}
                </span>
                {displayData.timestamp && (
                  <>
                    <span className="text-muted-foreground text-sm">·</span>
                    <span className="text-muted-foreground text-sm shrink-0">
                      {timeAgo(displayData.timestamp)}
                    </span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                }}
                className="text-muted-foreground hover:text-foreground p-1 -mr-1 rounded-full hover:bg-white/10 transition-colors"
                aria-label="More options"
              >
                <Ellipsis className="size-4" />
              </button>
            </div>

            {/* Content with rich highlights */}
            {displayData.content && (
              <p className="mt-1 text-[15px] leading-snug text-foreground whitespace-pre-wrap">
                {formatRichContent(displayData.content)}
              </p>
            )}

            {/* Attachments */}
            {displayData.attachments && displayData.attachments.length > 0 && (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <PostAttachments attachments={displayData.attachments} mediaClassName="rounded-2xl" />
              </div>
            )}

            {/* Quoted Tweet */}
            {displayData.quotedTweet && (
              <div
                className="mt-2.5 rounded-2xl border border-border/80 p-3 bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!preview && displayData.quotedTweet?.author?.screenName && displayData.quotedTweet.id) {
                    openExternalUrl(`https://x.com/${displayData.quotedTweet.author.screenName}/status/${displayData.quotedTweet.id}`)
                  }
                }}
              >
                {displayData.quotedTweet.author && (
                  <div className="flex items-center gap-1 text-[13px] mb-1">
                    <span className="font-semibold text-foreground">
                      {displayData.quotedTweet.author.name || displayData.quotedTweet.author.screenName}
                    </span>
                    <span className="text-muted-foreground">
                      @{displayData.quotedTweet.author.screenName}
                    </span>
                  </div>
                )}
                <p className="text-[13.5px] leading-snug text-foreground whitespace-pre-wrap">
                  {formatRichContent(displayData.quotedTweet.text)}
                </p>
              </div>
            )}

            {/* Action Bar (6 groups) */}
            <div
              className="mt-3 flex items-center justify-between max-w-[450px] text-muted-foreground text-[13px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. Reply */}
              <button
                type="button"
                className="group flex items-center gap-1.5 hover:text-[#1D9BF0] transition-colors -ml-1.5"
                aria-label="Reply"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <MessageCircle className="size-4" />
                </div>
                {displayData.replies !== undefined && displayData.replies > 0 && (
                  <span className="text-xs">{fmt(displayData.replies)}</span>
                )}
              </button>

              {/* 2. Repost */}
              <button
                type="button"
                onClick={displayData.onRetweet}
                className="group flex items-center gap-1.5 hover:text-[#00BA7C] transition-colors"
                aria-label="Repost"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#00BA7C]/10 transition-colors">
                  <Repeat2 className="size-4" />
                </div>
                {displayData.retweets !== undefined && displayData.retweets > 0 && (
                  <span className="text-xs">{fmt(displayData.retweets)}</span>
                )}
              </button>

              {/* 3. Like */}
              <button
                type="button"
                onClick={displayData.onLike}
                className="group flex items-center gap-1.5 hover:text-[#F91880] transition-colors"
                aria-label="Like"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#F91880]/10 transition-colors">
                  <Heart className="size-4" />
                </div>
                {displayData.likes !== undefined && displayData.likes > 0 && (
                  <span className="text-xs">{fmt(displayData.likes)}</span>
                )}
              </button>

              {/* 4. Views */}
              <div className="group flex items-center gap-1.5 hover:text-[#1D9BF0] transition-colors">
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <BarChart2 className="size-4" />
                </div>
                {displayData.views !== undefined && displayData.views > 0 && (
                  <span className="text-xs">{fmt(displayData.views)}</span>
                )}
              </div>

              {/* 5. Bookmark */}
              <button
                type="button"
                onClick={displayData.onBookmark}
                className="group flex items-center hover:text-[#1D9BF0] transition-colors"
                aria-label="Bookmark"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <Bookmark className="size-4" />
                </div>
              </button>

              {/* 6. Share */}
              <button
                type="button"
                onClick={displayData.onShare}
                className="group flex items-center hover:text-[#1D9BF0] transition-colors"
                aria-label="Share"
              >
                <div className="p-1.5 rounded-full group-hover:bg-[#1D9BF0]/10 transition-colors">
                  <Share2 className="size-4" />
                </div>
              </button>
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
