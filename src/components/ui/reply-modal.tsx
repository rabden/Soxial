import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, Image as ImageIcon, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { cn } from 'src/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from 'src/components/ui/dialog'
import type { HumanUser, HumanQuotedTweet } from 'src/features/human/types'

const MAX_IMAGES = 4
const VERIFIED_LIMIT = 25_000
const STANDARD_LIMIT = 280

interface PendingImage {
  path: string
  dataUrl: string
}

/** Inline AI-draft hint under the composer (archetype/why, refusal, failure). */
interface DraftHint {
  kind: 'info' | 'refused' | 'error'
  text: string
}

/** Signed-in X account — fetched once per session for the composer avatar. */
let meCache: Promise<HumanUser | null> | null = null
function fetchMe(): Promise<HumanUser | null> {
  if (!meCache) {
    meCache = window.api
      .humanProfile()
      .then((res) => (res.ok ? res.data : null))
      .catch(() => null)
  }
  return meCache
}

export interface ReplyModalProps {
  open: boolean
  onClose: () => void
  /** Called after a successful reply — parent bumps its reply count. */
  onPosted?: () => void
  tweet: {
    id?: string
    authorName?: string
    authorHandle?: string
    authorImage?: string
    verified?: boolean
    content?: string
    /** Preformatted relative timestamp label (e.g. "8m"). */
    timestampLabel?: string
    quotedTweet?: HumanQuotedTweet | null
    /** Native media of the target tweet (links excluded) — AI-draft context. */
    media?: Array<{ type: string; url: string }>
  }
}

function upgradeAvatarUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string' || !url) return url
  return url.replace(/_(mini|normal|bigger)(\.\w+)(\?.*)?$/, '_400x400$2$3')
}

/**
 * Lighter-card reply dialog: card background (`bg-card`), 11-line clamp with
 * Show more, conditional quote preview (hidden when the quoted tweet's own
 * text exceeds 11 lines), max-height with inner scroll, and verified-aware
 * char limit (25k vs 280). Only the media attach button remains in the footer.
 */
export function ReplyModal({ open, onClose, onPosted, tweet }: ReplyModalProps) {
  const [me, setMe] = useState<HumanUser | null>(null)
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // One-shot AI draft: spinner state + inline hint; regenerate varies archetype.
  const [drafting, setDrafting] = useState(false)
  const [draftHint, setDraftHint] = useState<DraftHint | null>(null)
  const previousDraftsRef = useRef<string[]>([])

  // 11-line clamp for the quoted tweet's text
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const tweetId = tweet.id
  const maxChars = me?.verified ? VERIFIED_LIMIT : STANDARD_LIMIT

  // Reset per open; seed the signed-in avatar + clamp state.
  useEffect(() => {
    if (!open) return
    setText('')
    setImages([])
    setSubmitting(false)
    setError(null)
    setPosted(false)
    setExpanded(false)
    setIsOverflowing(false)
    setDrafting(false)
    setDraftHint(null)
    previousDraftsRef.current = []
    fetchMe().then(setMe)
    // Reset composer height so an empty draft starts compact.
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const t = setTimeout(() => textareaRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Keep the composer growing with content — the modal (not the textarea) scrolls.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  // Measure whether the tweet content overflows 11 lines (clamped)
  useEffect(() => {
    if (!open) return
    const el = contentRef.current
    if (!el) return
    const check = () => {
      if (expanded) return
      // When clamped, scrollHeight > clientHeight indicates >11 lines
      if (el.scrollHeight > el.clientHeight + 4) {
        setIsOverflowing(true)
      } else {
        // Keep false if not overflowing; don't flip back from true due to
        // re-renders after images load — only set once per open unless expanded resets
        // Heuristic fallback for long text that wraps
        if ((tweet.content?.length ?? 0) > 360 || (tweet.content?.match(/\n/g) || []).length > 10) {
          requestAnimationFrame(() => {
            if (el.scrollHeight > el.clientHeight + 4) setIsOverflowing(true)
          })
        }
      }
    }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, tweet.content, expanded])

  const addImages = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return
      setError(null)
      const previews: PendingImage[] = []
      for (const path of paths) {
        if (previews.length + images.length >= MAX_IMAGES) {
          setError(`Up to ${MAX_IMAGES} images per reply.`)
          break
        }
        const res = await window.api.mediaDataUrl(path)
        if (!res.success || !res.dataUrl) {
          setError(res.error || 'Image could not be attached.')
          continue
        }
        previews.push({ path, dataUrl: res.dataUrl })
      }
      if (previews.length) {
        setImages((prev) => [...prev, ...previews].slice(0, MAX_IMAGES))
      }
    },
    [images.length],
  )

  const removeImage = useCallback((path: string) => {
    setImages((prev) => prev.filter((img) => img.path !== path))
  }, [])

  // ── One-shot AI draft ──────────────────────────────────────────────────
  // Native video/GIF targets are never drafted (media-safety hard rule).
  const hasVideoMedia = Boolean(
    tweet.media?.some((m) => ['video', 'animated_gif', 'gif'].includes(String(m.type).toLowerCase())),
  )

  const draftReply = useCallback(async () => {
    if (!tweet.id || drafting || hasVideoMedia) return
    setDrafting(true)
    setDraftHint(null)
    try {
      const quoted = tweet.quotedTweet as HumanQuotedTweet | null | undefined
      const res = await window.api.humanReplyDraft({
        tweetId: tweet.id,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName,
        content: tweet.content,
        media: tweet.media,
        quoted: quoted
          ? {
              id: quoted.id,
              authorHandle: quoted.author?.screenName,
              text: quoted.text,
              media: (quoted.media ?? []).map((m) => ({ type: m.type, url: m.url })),
            }
          : undefined,
        charLimit: maxChars,
        previousDrafts: previousDraftsRef.current.slice(),
      })
      if (!res.ok) {
        setDraftHint({ kind: 'error', text: 'Draft failed — try again in a moment.' })
        return
      }
      if (res.data.refused) {
        setDraftHint({ kind: 'refused', text: res.data.refused.reason })
        return
      }
      const draft = res.data.text ?? ''
      previousDraftsRef.current = [...previousDraftsRef.current, draft].slice(-3)
      setText(draft)
      // Auto-grow the textarea — no cap; the modal body scrolls when full.
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
        }
      })
      setDraftHint({
        kind: 'info',
        text: `AI draft${res.data.archetype ? ` · ${res.data.archetype}` : ''}${res.data.why ? ` — ${res.data.why}` : ''}. Edit before posting.`,
      })
    } catch {
      setDraftHint({ kind: 'error', text: 'Draft failed — try again in a moment.' })
    } finally {
      setDrafting(false)
    }
  }, [tweet.id, tweet.authorHandle, tweet.authorName, tweet.content, tweet.media, tweet.quotedTweet, drafting, hasVideoMedia, maxChars, me?.verified])

  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || !tweetId || submitting) return
    if (trimmed.length > maxChars) {
      setError(`Reply exceeds ${maxChars.toLocaleString()} characters.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await window.api.humanReply({
        tweetId,
        text: trimmed,
        imagePaths: images.map((img) => img.path),
      })
      if (!res.ok) {
        setError(res.error.message || 'The reply could not be posted. Retry.')
        setSubmitting(false)
        return
      }
      setPosted(true)
      onPosted?.()
      setTimeout(() => onClose(), 700)
    } catch (e: any) {
      setError(e?.message || 'The reply could not be posted. Retry.')
      setSubmitting(false)
    }
  }, [text, tweetId, submitting, images, onPosted, onClose, maxChars])

  const remaining = maxChars - text.length
  const overLimit = remaining < 0
  const canSubmit = text.trim().length > 0 && !overLimit && !submitting
  const ratio = Math.min(text.length / maxChars, 1)
  const ringColor = overLimit ? '#F4212E' : remaining <= 20 ? '#FFD400' : '#1D9BF0'

  const shouldShowQuote = Boolean(tweet.quotedTweet) && !isOverflowing

  const q = tweet.quotedTweet as HumanQuotedTweet | null | undefined
  const qAuthor = q?.author
  const qName = qAuthor?.name || ''
  const qHandle = qAuthor?.screenName || ''
  const qAvatar = upgradeAvatarUrl(qAuthor?.profileImageUrl)
  const qVerified = Boolean(qAuthor?.verified)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-card p-0 sm:max-w-[600px]"
        aria-label="Reply to post"
        onInteractOutside={(e) => {
          if (submitting) e.preventDefault()
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle className="sr-only">Reply to @{tweet.authorHandle ?? 'post'}</DialogTitle>
        <DialogDescription className="sr-only">
          Write a reply to @{tweet.authorHandle ?? 'this post'}
        </DialogDescription>

        {/* Header: close left, Drafts right */}
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-full p-2 text-foreground transition-colors hover:bg-white/10 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            className="px-3 py-1 text-[14px] font-bold leading-none text-[#1D9BF0] hover:underline"
            aria-label="Drafts"
          >
            Drafts
          </button>
        </div>

        {/* Body: thread — quoted tweet + composer — scrolls internally */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 pb-2 pt-3">
            {/* Quoted tweet with thread line */}
            <div className="flex gap-3">
              {/* Avatar column with vertical thread line */}
              <div className="flex flex-col items-center">
                <div className="size-10 shrink-0 overflow-hidden rounded-full bg-muted">
                  {tweet.authorImage ? (
                    <img src={tweet.authorImage} alt={tweet.authorName} className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-sm font-medium text-muted-foreground">
                      {tweet.authorName?.[0] ?? '?'}
                    </div>
                  )}
                </div>
                <div className="mt-2 w-0.5 flex-1 bg-border min-h-[12px]" aria-hidden="true" />
              </div>

              <div className="min-w-0 flex-1 pb-3">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[15px] font-bold leading-5 text-foreground">{tweet.authorName}</span>
                  {tweet.verified && <BadgeCheck className="size-[18px] shrink-0 text-[#1D9BF0]" />}
                  <span className="text-[15px] leading-5 text-muted-foreground">@{tweet.authorHandle}</span>
                  {tweet.timestampLabel && (
                    <>
                      <span className="text-[15px] leading-5 text-muted-foreground">·</span>
                      <span className="shrink-0 text-[15px] leading-5 text-muted-foreground">{tweet.timestampLabel}</span>
                    </>
                  )}
                </div>
                {/* 11-line clamp with Show more */}
                <div
                  ref={contentRef}
                  className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-5 text-foreground"
                  style={
                    !expanded
                      ? { display: '-webkit-box', WebkitLineClamp: 11, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                      : undefined
                  }
                >
                  {tweet.content}
                </div>
                {isOverflowing && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-1 text-[14px] leading-none text-[#1D9BF0] hover:underline"
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
                {shouldShowQuote && q && (
                  <div className="mt-3 rounded-2xl border border-border overflow-hidden bg-card">
                    <div className="p-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="size-5 rounded-full overflow-hidden bg-muted flex-shrink-0">
                          {qAvatar ? (
                            <img src={qAvatar} alt={qName} className="size-full object-cover" />
                          ) : (
                            <div className="size-full flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                              {qName?.[0] || qHandle[0] || '?'}
                            </div>
                          )}
                        </div>
                        <span className="text-[13px] font-bold text-foreground truncate">{qName || qHandle}</span>
                        {qVerified && <BadgeCheck className="size-3.5 text-[#1D9BF0] shrink-0" />}
                        <span className="text-[13px] text-muted-foreground truncate">@{qHandle}</span>
                      </div>
                      <div className="mt-1.5 text-[14px] leading-[19px] text-foreground whitespace-pre-wrap break-words line-clamp-3">
                        {q.text}
                      </div>
                    </div>
                  </div>
                )}
                {tweet.authorHandle && (
                  <div className="mt-3 text-[15px] leading-5 text-muted-foreground">
                    Replying to <span className="text-[#1D9BF0]">@{tweet.authorHandle}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Composer row */}
            <div className="flex gap-3 pt-1">
              <div className="size-10 shrink-0 overflow-hidden rounded-full bg-muted">
                {me?.profileImageUrl ? (
                  <img src={me.profileImageUrl} alt={me.name} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-sm font-medium text-muted-foreground">
                    {me?.name?.[0] ?? me?.screenName?.[0] ?? '?'}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Post your reply"
                  rows={1}
                  disabled={submitting}
                  className="min-h-[52px] w-full resize-none overflow-hidden bg-transparent py-2 text-[20px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                  onInput={(e) => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }}
                  data-testid="reply-textarea"
                />

                {/* Attached images */}
                {images.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {images.map((img) => (
                      <div key={img.path} className="relative overflow-hidden rounded-2xl border border-border">
                        <img src={img.dataUrl} alt={`attachment ${img.path}`} className="h-36 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImage(img.path)}
                          disabled={submitting}
                          className="absolute right-2 top-2 rounded-full bg-black/75 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/90 disabled:opacity-40"
                          aria-label={`Remove image ${img.path}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {me?.verified !== undefined && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {me.verified ? 'Premium: up to 25,000 characters' : '280 characters max'}
                  </div>
                )}

                {/* AI draft hint — archetype/why, refusal, or soft failure */}
                {draftHint && (
                  <div
                    className={cn(
                      'mt-2 flex items-start gap-1.5 text-xs leading-snug',
                      draftHint.kind === 'error' ? 'text-[#F4212E]' : draftHint.kind === 'refused' ? 'text-muted-foreground' : 'text-[#1D9BF0]',
                    )}
                    data-testid="ai-draft-hint"
                  >
                    <span className="min-w-0 flex-1">{draftHint.text}</span>
                    <button
                      type="button"
                      onClick={() => setDraftHint(null)}
                      className="mt-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground/70 hover:bg-white/10 hover:text-foreground"
                      aria-label="Dismiss draft hint"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-lg border border-[#F4212E]/30 bg-[#F4212E]/10 px-3 py-2 text-[13px] text-[#F4212E]">
              {error}
            </div>
          )}
          {posted && (
            <div className="mx-4 mb-2 text-sm font-medium text-[#00BA7C]">Reply posted</div>
          )}
        </div>

        {/* Footer toolbar — media attach + one-shot AI draft */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => window.api.pickReplyImages().then((r) => addImages(r.paths))}
              disabled={submitting || images.length >= MAX_IMAGES}
              className="rounded-full p-2 text-[#1D9BF0] transition-colors hover:bg-[#1D9BF0]/10 disabled:opacity-40"
              aria-label="Add images"
              title={images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images` : 'Add images'}
            >
              <ImageIcon className="size-[20px]" strokeWidth={1.75} />
            </button>

            {/* One-shot AI draft (never posts — the composer is the approval gate) */}
            <button
              type="button"
              onClick={draftReply}
              disabled={drafting || submitting || hasVideoMedia}
              className="rounded-full p-2 text-[#1D9BF0] transition-colors hover:bg-[#1D9BF0]/10 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label={previousDraftsRef.current.length > 0 ? 'Regenerate AI draft' : 'Draft with AI'}
              title={
                hasVideoMedia
                  ? 'Video posts cannot be AI-drafted (media safety)'
                  : previousDraftsRef.current.length > 0
                    ? 'Draft again — new angle'
                    : 'Draft with AI'
              }
              data-testid="ai-draft-button"
            >
              {drafting ? (
                <Loader2 className="size-[20px] animate-spin" strokeWidth={1.75} />
              ) : previousDraftsRef.current.length > 0 ? (
                <RefreshCw className="size-[20px]" strokeWidth={1.75} />
              ) : (
                <Sparkles className="size-[20px]" strokeWidth={1.75} />
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {text.length > 0 && (
              <>
                <span className={cn('text-[13px]', overLimit ? 'text-[#F4212E]' : 'text-muted-foreground')}>
                  {overLimit ? `${Math.abs(remaining)} over` : remaining.toLocaleString()}
                </span>
                <svg className="-rotate-90" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
                  <circle cx="15" cy="15" r="12" fill="none" stroke="currentColor" className="text-white/10" strokeWidth="2" />
                  <circle
                    cx="15"
                    cy="15"
                    r="12"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 12}
                    strokeDashoffset={2 * Math.PI * 12 * (1 - ratio)}
                  />
                </svg>
                <div className="h-7 w-px bg-border" aria-hidden="true" />
              </>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center gap-2 rounded-full px-5 py-1.5 text-[15px] font-bold leading-5 transition-colors',
                canSubmit
                  ? 'bg-white text-black hover:bg-[#D7DBDC]'
                  : 'bg-white/20 text-white/60',
              )}
              aria-label="Reply"
              data-testid="reply-submit"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Reply
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
