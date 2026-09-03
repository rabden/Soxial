import { useState, useEffect } from 'react'
import { cn } from 'src/lib/utils'
import { ArrowBigUp, ArrowBigDown, MessageCircle, Send, Loader2, Clock } from 'lucide-react'
import { PostAttachments, PostAttachment, extractRedditMedia } from 'src/components/ui/post-attachment'
import { getCachedPost, cachePost } from 'src/lib/post-cache'

const fetchCache = new Map<string, Promise<any>>()

function parseRedditPostData(rawPost: any): RedditPostCardProps {
  return {
    title: rawPost.title,
    subreddit: rawPost.subreddit,
    author: rawPost.author,
    score: rawPost.score,
    numComments: rawPost.num_comments,
    url: rawPost.url || `https://reddit.com${rawPost.permalink}`,
    selftext: rawPost.selftext,
    createdUtc: rawPost.created_utc,
    attachments: extractRedditMedia(rawPost),
  }
}

function dedupedFetch(id: string): Promise<any> {
  if (!fetchCache.has(id)) {
    fetchCache.set(id, window.api.redditRead(id))
    fetchCache.get(id)!.finally(() => fetchCache.delete(id))
  }
  return fetchCache.get(id)!
}

export interface RedditComment {
  id?: string
  author: string
  content: string
  score?: number
  createdUtc?: number
  replies?: RedditComment[]
}

export interface RedditPostCardProps {
  id?: string
  postId?: string
  commentId?: string
  title?: string
  subreddit?: string
  author?: string
  score?: number
  numComments?: number
  url?: string
  selftext?: string
  createdUtc?: number
  comments?: RedditComment[]
  onPost?: () => void
  posting?: boolean
  className?: string
  preview?: boolean
  attachments?: PostAttachment[]
  showPostButton?: boolean
}

function timeAgo(utc: number): string {
  const diff = Date.now() / 1000 - utc
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`
  if (diff < 86400) return `${Math.max(1, Math.floor(diff / 3600))}h ago`
  return `${Math.max(1, Math.floor(diff / 86400))}d ago`
}

function RedditCommentTree({ comment, depth = 0 }: { comment: RedditComment; depth?: number }) {
  return (
    <div className="mt-2 pl-3 border-l border-border/50 hover:border-border transition-colors py-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">u/{comment.author}</span>
        {comment.score !== undefined && <span>{comment.score} pts</span>}
        {comment.createdUtc && <span>{timeAgo(comment.createdUtc)}</span>}
      </div>
      <p className="mt-1 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{comment.content}</p>
      
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-1.5 space-y-2">
          {comment.replies.map((reply, i) => (
            <RedditCommentTree key={reply.id || i} comment={reply} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function findCommentInTree(comments: RedditComment[], targetId: string): RedditComment | null {
  for (const c of comments) {
    if (c.id === targetId) return c
    if (c.replies) {
      const found = findCommentInTree(c.replies, targetId)
      if (found) return found
    }
  }
  return null
}

function parseRedditComments(listing: any): RedditComment[] {
  if (!listing || !listing.data || !Array.isArray(listing.data.children)) return []
  return listing.data.children
    .filter((c: any) => c.kind === 't1')
    .map((c: any): RedditComment => {
      const d = c.data
      return {
        id: d.id,
        author: d.author,
        content: d.body || d.selftext || '',
        score: d.score,
        createdUtc: d.created_utc,
        replies: d.replies ? parseRedditComments(d.replies) : []
      }
    })
}

export function RedditPostCard({
  id, postId, commentId, title, subreddit, author, score = 0, numComments = 0,
  url, selftext, createdUtc, comments, onPost, posting, className, preview, attachments, showPostButton
}: RedditPostCardProps) {
  const [loadedData, setLoadedData] = useState<RedditPostCardProps | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedComment, setLoadedComment] = useState<RedditComment | null>(null)

  const activeId = postId || id

  useEffect(() => {
    if (!activeId || title) return
    const cacheKey = `rd:${activeId}`
    const cached = getCachedPost(cacheKey)

    if (cached?.data) {
      const rawPost = cached.data[0]?.data?.children?.[0]?.data
      if (rawPost) {
        setLoadedData(parseRedditPostData(rawPost))
        setLoading(false)
        if (cached.isStale) {
          dedupedFetch(activeId).then((res: any) => {
            if (res.ok && Array.isArray(res.data) && res.data.length >= 2) {
              cachePost(cacheKey, res.data)
              const fresh = res.data[0]?.data?.children?.[0]?.data
              if (fresh) setLoadedData(parseRedditPostData(fresh))
            }
          }).catch(() => {})
        }
        return
      }
    }

    setLoading(true)
    setError(null)
    dedupedFetch(activeId)
      .then((res: any) => {
        if (res.ok && Array.isArray(res.data) && res.data.length >= 2) {
          cachePost(cacheKey, res.data)
          const rawPost = res.data[0]?.data?.children?.[0]?.data
          if (rawPost) {
            setLoadedData(parseRedditPostData(rawPost))
          } else {
            setError('Failed to parse Reddit post details')
          }
        } else if (res.error?.code === 'rate_limited') {
          setError('Rate limited. Try again in a few minutes.')
        } else {
          setError('Failed to fetch Reddit post')
        }
        setLoading(false)
      })
      .catch((err: any) => {
        setError(err.message || 'Error loading Reddit post')
        setLoading(false)
      })
  }, [activeId, title])

  useEffect(() => {
    if (!commentId || !activeId) { setLoadedComment(null); return }
    const cacheKey = `rd:${activeId}`
    const cached = getCachedPost(cacheKey)

    if (cached?.data?.[1]) {
      const parsed = parseRedditComments(cached.data[1])
      const found = findCommentInTree(parsed, commentId)
      if (found) setLoadedComment(found)
      if (cached.isStale) return // main useEffect handles refresh
    }

    if (!cached || cached.isStale) {
      dedupedFetch(activeId).then((res: any) => {
        if (res.ok && Array.isArray(res.data) && res.data.length >= 2) {
          const parsed = parseRedditComments(res.data[1])
          const found = findCommentInTree(parsed, commentId)
          if (found) setLoadedComment(found)
        }
      }).catch(() => {})
    }
  }, [commentId, activeId])

  if (loading) {
    return (
      <div className={cn('w-full max-w-[560px] rounded-xl p-6 bg-card border border-border flex flex-col items-center justify-center min-h-[140px] gap-2.5', className)}>
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground font-medium">Loading Reddit post and comments...</span>
      </div>
    )
  }

  if (error) {
    const isRateLimit = error === 'Rate limited. Try again in a few minutes.'
    return (
      <div className={cn('w-full max-w-[560px] rounded-xl p-4 bg-card border border-destructive/30 text-destructive text-sm', className)}>
        <div className="flex items-center gap-2 mb-1">
          {isRateLimit && <Clock className="size-4 shrink-0" />}
          <p className="font-semibold">{isRateLimit ? 'Rate limited' : 'Failed to load Reddit post'}</p>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  const displayData = loadedData || {
    title, subreddit, author, score, numComments, url, selftext, createdUtc, comments, onPost, posting, attachments, showPostButton
  }

  const resolvedComments = loadedComment
    ? [loadedComment, ...(displayData.comments || [])]
    : displayData.comments

  // The agent sometimes includes the r//u/ prefixes the prompt used to show —
  // normalize so the card never renders r/r/example or u/u/name.
  const cleanSubreddit = (displayData.subreddit || '').replace(/^r\//, '')
  const cleanAuthor = (displayData.author || '').replace(/^u\//, '')

  const postUrl = displayData.url || `https://reddit.com/r/${cleanSubreddit}`
  const displayText = displayData.selftext ? (displayData.selftext.length > 280 ? displayData.selftext.slice(0, 280) + '...' : displayData.selftext) : null

  const renderCardContent = () => (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {cleanSubreddit && (
          <>
            <span className="font-medium text-foreground">r/{cleanSubreddit}</span>
            <span>·</span>
          </>
        )}
        {cleanAuthor && <span>u/{cleanAuthor}</span>}
        {displayData.createdUtc && (<><span>·</span><span>{timeAgo(displayData.createdUtc)}</span></>)}
      </div>

      <h3 className="mt-2 text-[15px] font-semibold text-foreground leading-snug">{displayData.title}</h3>

      {displayText && (
        <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{displayText}</p>
      )}

      <PostAttachments attachments={displayData.attachments} className="mt-2" />

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ArrowBigUp className="size-4" />
          <span className="font-medium text-foreground">{displayData.score}</span>
          <ArrowBigDown className="size-4" />
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="size-3.5" />
          {displayData.numComments} comments
        </span>
        {showPostButton && onPost && (
          <button onClick={onPost} disabled={posting} className="ml-auto flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Post
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className={cn('w-full max-w-[560px]', className)}>
      <div className="rounded-xl p-4 bg-card border border-border shadow-sm">
        {renderCardContent()}
      </div>

      {resolvedComments && resolvedComments.length > 0 && (
        <div className="ml-4 mt-3 space-y-3">
          {resolvedComments.map((c, i) => (
            <RedditCommentTree key={c.id || i} comment={c} />
          ))}
        </div>
      )}
    </div>
  )
}

interface RedditReplyPreviewProps {
  original?: RedditPostCardProps
  originalId?: string
  postId?: string
  commentId?: string
  replyContent?: string
  reply?: string
  replyId?: string
  replyName?: string
  onPost?: () => void
  showPostButton?: boolean
  className?: string
}

export function RedditReplyPreview({
  original,
  originalId,
  postId,
  commentId,
  replyContent,
  reply,
  replyId,
  replyName,
  onPost,
  showPostButton,
  className,
}: RedditReplyPreviewProps) {
  const resolvedPostId = postId || originalId
  const draftText = replyContent || reply || ''
  const isDraft = !replyId || !resolvedPostId
  const draftAuthor = (replyName || 'You').replace(/^u\//, '')

  // Posted reply: one post card with the reply highlighted in its comment
  // tree. (Previously the post rendered twice — once on top, once inside.)
  if (!isDraft) {
    return (
      <div className={cn('w-full max-w-[560px]', className)}>
        <RedditPostCard id={resolvedPostId} commentId={replyId} />
      </div>
    )
  }

  return (
    // Reddit-native thread: post card + comment-tree draft. Same width and
    // card chrome as reddit-post — deliberately no Twitter visuals.
    <div className={cn('w-full max-w-[560px]', className)}>
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Proposed comment{draftAuthor !== 'You' ? ` as ${draftAuthor}` : ''}
        </span>
        {showPostButton && onPost && (
          <button onClick={onPost} className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
            <Send className="size-3.5" />
            Send
          </button>
        )}
      </div>
      {resolvedPostId ? (
        <RedditPostCard id={resolvedPostId} commentId={commentId} />
      ) : (
        <RedditPostCard {...original} />
      )}
      <div className="ml-4 mt-3">
        <div className="pl-3 border-l border-border/50 py-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">u/{draftAuthor}</span>
            <span>just now</span>
          </div>
          <p className="mt-1 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{draftText}</p>
          <div className="mt-2 flex items-center gap-3 text-muted-foreground opacity-50 pointer-events-none" aria-hidden>
            <ArrowBigUp className="size-4" />
            <ArrowBigDown className="size-4" />
            <MessageCircle className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  )
}
