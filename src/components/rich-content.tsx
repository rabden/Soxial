import { useEffect, useState } from 'react'
import { MessageResponse } from 'src/components/ai-elements/message'
import { TweetCard, TweetThread, TwitterReplyPreview } from 'src/components/ui/tweet-card'
import { RedditPostCard, RedditReplyPreview } from 'src/components/ui/reddit-post-card'
import { RenderErrorBoundary } from 'src/components/ui/render-error-boundary'
import { cn } from 'src/lib/utils'

interface Segment {
  type: 'text' | 'tweet-card' | 'tweet-thread' | 'reddit-post' | 'twitter-reply-preview' | 'tweet-reply-preview' | 'reddit-reply-preview' | 'reply-preview' | 'image-card'
  content: string
  data?: any
}

function isPartialCard(s: string): boolean {
  return /^:::/.test(s.trim())
}

function isDraftId(id: string): boolean {
  return /^(drft|rpl|nxan)/.test(id)
}

/**
 * The agent sometimes emits a Reddit reply under a Twitter/generic fence
 * (the prompt historically showed the JSON without the ::: fence name).
 * Route by payload: Reddit previews carry postId, X ones carry originalId —
 * so Reddit content never renders through the Twitter card path.
 */
function isRedditReplyPayload(data: any): boolean {
  if (!data || typeof data !== 'object') return false
  return Boolean(data.postId) && !data.originalId
}

function forceIdOnly(data: any, type: string): any {
  if (type === 'tweet-card') {
    if (data.id && !isDraftId(data.id)) {
      return { id: data.id, replyId: data.replyId, showPostButton: data.showPostButton }
    }
  }
  if (type === 'tweet-thread' && Array.isArray(data.tweets)) {
    return { ...data, tweets: data.tweets.map((t: any) =>
      t.id && !isDraftId(t.id) ? { id: t.id, replyId: t.replyId, showPostButton: t.showPostButton } : t
    )}
  }
  if (type === 'reddit-post') {
    if (data.id && !isDraftId(data.id)) {
      return { id: data.id, commentId: data.commentId, showPostButton: data.showPostButton }
    }
  }
  if (type === 'reply-preview' || type === 'twitter-reply-preview' || type === 'tweet-reply-preview') {
    if (data.originalId) {
      return { ...data, original: undefined }
    }
    if (data.original?.id && !isDraftId(data.original.id)) {
      return { ...data, originalId: data.original.id, original: undefined }
    }
  }
  if (type === 'reddit-reply-preview') {
    if (data.postId || data.originalId) {
      return { ...data, original: undefined }
    }
    if (data.original?.id && !isDraftId(data.original.id)) {
      return { ...data, originalId: data.original.id, original: undefined }
    }
  }
  return data
}

function extractValidJSON(str: string): { data: any, remainder: string } {
  const trimmed = str.trim()
  try {
    return { data: JSON.parse(trimmed), remainder: '' }
  } catch (e) {}

  let lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
  while (lastBrace !== -1) {
    const possibleJSON = trimmed.slice(0, lastBrace + 1)
    try {
      const data = JSON.parse(possibleJSON)
      return { data, remainder: trimmed.slice(lastBrace + 1) }
    } catch (e) {
      lastBrace = Math.max(
        trimmed.lastIndexOf('}', lastBrace - 1),
        trimmed.lastIndexOf(']', lastBrace - 1)
      )
    }
  }
  throw new Error("Invalid JSON")
}

function parseSegments(text: string, isAnimating?: boolean): Segment[] {
  // Lenient pre-pass: the reply-crafter sometimes emits `tweet-reply-preview {…}`
  // without the `:::` fence (see [Image 1] — raw lines fell through as text).
  // Normalize bare leading `type {` at line starts to `:::type {` so the
  // fence-based parser below can handle both forms and the card from [Image 2]
  // (post + vertical line + reply) renders again.
  const normalized = text.replace(
    /^\s*(tweet-card|tweet-thread|reddit-post|twitter-reply-preview|tweet-reply-preview|reddit-reply-preview|reply-preview|image-card)\s*\{/gm,
    ':::$1 {'
  )
  const segments: Segment[] = []
  const regex = /:::(tweet-card|tweet-thread|reddit-post|twitter-reply-preview|tweet-reply-preview|reddit-reply-preview|reply-preview|image-card)\s+([\s\S]*?)(?:\s*:::(?!\S)|(?=\s*:::|$))/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      const rawSkipped = normalized.slice(lastIndex, match.index)
      const content = rawSkipped.replace(/:::/g, '').trim()
      if (content && !(isAnimating && isPartialCard(content))) {
        segments.push({ type: 'text', content })
      }
    }
    const cardType = match[1] as Segment['type']
    const rawJsonStr = match[2]
    
    try {
      const { data, remainder } = extractValidJSON(rawJsonStr)
      segments.push({ type: cardType, content: JSON.stringify(data), data: forceIdOnly(data, cardType) })
      
      if (remainder.trim()) {
        const cleanRemainder = remainder.replace(/:::/g, '').trim()
        if (cleanRemainder && !(isAnimating && isPartialCard(cleanRemainder))) {
          segments.push({ type: 'text', content: cleanRemainder })
        }
      }
    } catch {
      segments.push({ type: 'text', content: match[0].replace(/:::/g, '').trim() })
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < normalized.length) {
    const rawRemaining = normalized.slice(lastIndex)
    const remaining = rawRemaining.replace(/:::/g, '').trim()
    if (remaining && !(isAnimating && isPartialCard(remaining))) {
      segments.push({ type: 'text', content: remaining })
    }
  }

  return segments
}

function ImageCard({ path, prompt, className }: { path: string; prompt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const filename = path.split('/').pop()
    if (!filename) { setLoading(false); return }
    window.api.getMedia(filename).then(r => {
      if (r.success && r.data) setSrc(`data:${r.mime || 'image/png'};base64,${r.data}`)
      setLoading(false)
    })
  }, [path])

  return (
    <div className={cn('w-full max-w-[560px] rounded-xl overflow-hidden bg-card border border-border', className)}>
      {loading ? (
        <div className="aspect-video flex items-center justify-center text-muted-foreground text-sm">Loading image...</div>
      ) : src ? (
        <img src={src} alt={prompt || 'Generated image'} className="w-full" loading="lazy" />
      ) : (
        <div className="aspect-video flex items-center justify-center text-muted-foreground text-sm">Image not found</div>
      )}
      {prompt && <p className="p-2 text-xs text-muted-foreground border-t border-border">{prompt}</p>}
    </div>
  )
}

export function RichContent({ children, isAnimating, onCardAction }: { children: string; isAnimating?: boolean; onCardAction?: (type: string, data: any) => void }) {
  const segments = parseSegments(children, isAnimating)

  if (segments.length === 1 && segments[0].type === 'text') {
    return <MessageResponse isAnimating={isAnimating}>{segments[0].content}</MessageResponse>
  }

  return (
    <div className="space-y-3">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          if (!seg.content) return null
          return <MessageResponse key={i} isAnimating={isAnimating && i === segments.length - 1}>{seg.content}</MessageResponse>
        }
        if (seg.type === 'tweet-card') {
          return (
            <RenderErrorBoundary key={i} label="the tweet card">
              <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-black [&>div]:!border-b-0">
                <TweetCard variant="feed" {...seg.data} onPost={seg.data?.showPostButton && onCardAction ? () => onCardAction('tweet-card', seg.data) : undefined} />
              </div>
            </RenderErrorBoundary>
          )
        }
        if (seg.type === 'tweet-thread') {
          return (
            <RenderErrorBoundary key={i} label="the tweet thread">
              <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-black [&>div]:!border-b-0">
                <TweetThread tweets={seg.data?.tweets || []} />
              </div>
            </RenderErrorBoundary>
          )
        }
        if (seg.type === 'reddit-post') {
          return (
            <RenderErrorBoundary key={i} label="the reddit post card">
              <RedditPostCard {...seg.data} onPost={seg.data?.showPostButton && onCardAction ? () => onCardAction('reddit-post', seg.data) : undefined} />
            </RenderErrorBoundary>
          )
        }
        if (seg.type === 'reply-preview' || seg.type === 'twitter-reply-preview' || seg.type === 'tweet-reply-preview') {
          if (isRedditReplyPayload(seg.data)) {
            return (
              <RenderErrorBoundary key={i} label="the reddit reply preview">
                <RedditReplyPreview originalId={seg.data.originalId} postId={seg.data.postId} commentId={seg.data.commentId} original={seg.data.original} replyContent={seg.data.reply || seg.data.replyContent} replyId={seg.data.replyId} replyName={seg.data.replyName} showPostButton={seg.data?.showPostButton} onPost={seg.data?.showPostButton && onCardAction ? () => onCardAction(seg.type, seg.data) : undefined} />
              </RenderErrorBoundary>
            )
          }
          return (
            <RenderErrorBoundary key={i} label="the reply preview">
              <TwitterReplyPreview originalId={seg.data.originalId} original={seg.data.original} replyContent={seg.data.reply || seg.data.replyContent} replyId={seg.data.replyId} replyHandle={seg.data.replyHandle} replyName={seg.data.replyName} showPostButton={seg.data?.showPostButton} onPost={seg.data?.showPostButton && onCardAction ? () => onCardAction(seg.type, seg.data) : undefined} />
            </RenderErrorBoundary>
          )
        }
        if (seg.type === 'reddit-reply-preview') {
          return (
            <RenderErrorBoundary key={i} label="the reddit reply preview">
              <RedditReplyPreview key={i} originalId={seg.data.originalId} postId={seg.data.postId} commentId={seg.data.commentId} original={seg.data.original} replyContent={seg.data.reply || seg.data.replyContent} replyId={seg.data.replyId} replyName={seg.data.replyName} showPostButton={seg.data?.showPostButton} onPost={seg.data?.showPostButton && onCardAction ? () => onCardAction('reddit-reply-preview', seg.data) : undefined} />
            </RenderErrorBoundary>
          )
        }
        if (seg.type === 'image-card') {
          return <ImageCard key={i} path={seg.data?.path || ''} prompt={seg.data?.prompt} />
        }
        return null
      })}
    </div>
  )
}
