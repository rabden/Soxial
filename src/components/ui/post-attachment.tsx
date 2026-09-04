import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from 'src/lib/utils'
import { Loader2, Link2, FileText } from 'lucide-react'

export interface PostAttachment {
  type?: 'image' | 'gif' | 'video' | 'link'
  url?: string
  mediaId?: string
  alt?: string
  title?: string
  description?: string
  image?: string
}

function decodeUrl(url?: string): string {
  return url?.replace(/&amp;/g, '&') || ''
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) || ''
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function uniqByUrl(atts: PostAttachment[]): PostAttachment[] {
  const seen = new Set<string>()
  return atts.filter((att) => {
    const key = att.mediaId || att.url
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function LocalMedia({ mediaId, alt, fill }: { mediaId: string; alt?: string; fill?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const filename = mediaId.split('/').pop()
    if (!filename) { setLoading(false); return }
    window.api.getMedia(filename).then(r => {
      if (r.success && r.data) setSrc(`data:${r.mime || 'image/png'};base64,${r.data}`)
      setLoading(false)
    })
  }, [mediaId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[120px]">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!src) return null
  return <img src={src} alt={alt || ''} className={cn(fill ? 'size-full' : 'w-full', 'object-cover')} loading="lazy" />
}

function LinkPreview({ url, title, description, image }: { url: string; title?: string; description?: string; image?: string }) {
  const [preview, setPreview] = useState({ title, description, image })
  let domain = url
  try { domain = new URL(url).hostname.replace(/^www\./, '') } catch {}

  useEffect(() => {
    let alive = true
    if (preview.title && preview.description && preview.image) return
    window.api.fetchLinkPreview(url).then((r) => {
      if (!alive || !r?.success || !r?.data) return
      setPreview((prev) => ({
        title: prev.title || r.data.title,
        description: prev.description || r.data.description,
        image: prev.image || r.data.image,
      }))
    }).catch(() => {})
    return () => { alive = false }
  }, [url])

  // Large og-image variant: big image on top, thin strip below with title/description/domain
  // Matches X's summary_large_image card (Image 1).
  if (preview.image) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl border border-white/[0.12] overflow-hidden bg-black hover:bg-white/[0.02] transition-colors group no-underline"
      >
        <div className="w-full aspect-[1.91/1] max-h-[268px] overflow-hidden bg-zinc-900">
          <img src={preview.image} alt={preview.title || ''} className="w-full h-full object-cover" loading="lazy" />
        </div>
        <div className="px-3 py-2.5 bg-white/[0.03] border-t border-white/[0.08]">
          <div className="text-[13px] font-medium text-white truncate leading-tight">{preview.title || domain}</div>
          {preview.description && <div className="text-[12px] text-zinc-400 truncate leading-snug mt-0.5">{preview.description}</div>}
          <div className="flex items-center gap-1 text-[11px] text-zinc-500 truncate mt-1">
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{domain}</span>
          </div>
        </div>
      </a>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-xl border border-white/[0.12] overflow-hidden bg-white/[0.04] hover:bg-white/[0.07] transition-colors group no-underline"
    >
      <div className="w-12 shrink-0 flex items-center justify-center bg-white/[0.05] border-r border-white/[0.08]">
        <FileText className="size-4 text-zinc-500" />
      </div>
      <div className="flex flex-col justify-center gap-0.5 py-2 pr-3 min-w-0 flex-1">
        {preview.title && <span className="text-[13px] font-medium text-white truncate leading-tight">{preview.title}</span>}
        {preview.description && <span className="text-[11px] text-zinc-400 line-clamp-2 leading-snug">{preview.description}</span>}
        <span className="flex items-center gap-1 text-[11px] text-zinc-500 truncate mt-0.5">
          <Link2 className="size-2.5" />
          {domain}
        </span>
      </div>
    </a>
  )
}

let activeVideo: HTMLVideoElement | null = null

/** Remount budget after transient failures — 1 initial load + 2 retries. */
const VIDEO_MAX_ATTEMPTS = 2

function VideoMedia({ src, type, poster, fill }: { src: string; type?: string; poster?: string; fill?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // StrictMode double-invokes state updaters — keep the retry bookkeeping in
  // a ref so handleError stays side-effect-free inside setState.
  const attemptRef = useRef(0)

  // ponytail: proxy twimg.com video URLs through main process (bypasses Referer 403)
  const proxySrc = decodeUrl(src).replace(/^https:\/\/(.*\.twimg\.com\/)/, 'twimg://$1')
  const isGif = type === 'gif'

  // Fresh retry budget per source; clear any pending retry on unmount.
  useEffect(() => {
    attemptRef.current = 0
    setAttempt(0)
    setFailed(false)
    setReady(false)
  }, [proxySrc])
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
  }, [])

  // Transient failures (severed stream, CDN 5xx blip) are common on twimg —
  // remount the <video> after a short backoff so Chromium re-issues the
  // request; only surface the failure UI once the budget is spent.
  const handleError = useCallback(() => {
    setReady(false)
    if (attemptRef.current >= VIDEO_MAX_ATTEMPTS) {
      setFailed(true)
      return
    }
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const delay = 400 * 2 ** attemptRef.current
    const next = attemptRef.current + 1
    retryTimer.current = setTimeout(() => {
      attemptRef.current = next
      setAttempt(next)
    }, delay)
  }, [])

  useEffect(() => {
    if (isGif) return
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const v = entry.target as HTMLVideoElement
          if (entry.isIntersecting) {
            if (activeVideo && activeVideo !== v) {
              activeVideo.pause()
            }
            // muted autoplay — user can unmute via controls
            v.muted = true
            const p = v.play()
            if (p) p.catch(() => {})
            activeVideo = v
          } else {
            v.pause()
            if (activeVideo === v) activeVideo = null
          }
        })
      },
      { threshold: 0.5 },
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      if (activeVideo === video) activeVideo = null
    }
  }, [isGif, proxySrc, attempt])

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 min-h-[120px] p-4">
        <p className="text-xs text-muted-foreground">Video failed to load</p>
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Open in browser</a>
      </div>
    )
  }

  // key={attempt} (passed directly on each <video>) forces a fresh element
  // per retry — Chromium keeps the dead pipeline of an errored <video>, so
  // recovery must be a remount, not a src re-assignment.
  const videoProps = {
    src: proxySrc,
    poster: poster ? decodeUrl(poster) : undefined,
    onError: handleError,
    onCanPlay: () => setReady(true),
    className: cn(fill ? 'size-full' : 'w-full max-h-[400px]', 'object-cover'),
  }

  // While a retry is in flight the element is blank — show a quiet spinner.
  const spinner = !ready && attempt > 0 ? (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  ) : null

  if (isGif) {
    return (
      <div className={cn('relative', fill && 'size-full')}>
        <video key={attempt} {...videoProps} muted autoPlay loop playsInline preload="auto" />
        {spinner}
      </div>
    )
  }

  return (
    <div className={cn('relative', fill && 'size-full')}>
      <video
        key={attempt}
        ref={videoRef}
        {...videoProps}
        controls
        muted
        playsInline
        preload="metadata"
        onPlay={() => {
          if (activeVideo && activeVideo !== videoRef.current) activeVideo.pause()
          if (videoRef.current) activeVideo = videoRef.current
        }}
        onPause={() => {
          if (activeVideo === videoRef.current) activeVideo = null
        }}
      />
      {spinner}
    </div>
  )
}

export function PostAttachments({
  attachments,
  className,
  mediaClassName,
}: {
  attachments?: PostAttachment[]
  className?: string
  mediaClassName?: string
}) {
  if (!attachments || attachments.length === 0) return null

  const media = attachments.filter((a) => a.type !== 'link' && !a.title)
  const links = attachments.filter((a) => a.type === 'link' || a.title)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {media.length > 0 && (
        <div
          className={cn(
            'rounded-xl overflow-hidden border border-border',
            mediaClassName,
            media.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'
          )}
        >
          {media.map((att, i) => {
            const isVideo = att.type === 'video' || att.type === 'gif'
            const fill = media.length > 1
            return (
              <div key={i} className={cn('bg-muted', fill ? 'aspect-square' : '')}>
                {att.mediaId
                  ? <LocalMedia mediaId={att.mediaId} alt={att.alt} fill={fill} />
                  : isVideo && att.url
                    ? <VideoMedia src={att.url} type={att.type} poster={att.image} fill={fill} />
                    : att.url
                      ? <img src={att.url} alt={att.alt || ''} className={cn(fill ? 'size-full' : 'w-full max-h-[400px]', 'object-cover')} loading="lazy" />
                      : null
                }
              </div>
            )
          })}
        </div>
      )}
      {links.map((att, i) => (
        <LinkPreview key={i} url={att.url!} title={att.title} description={att.description} image={att.image} />
      ))}
    </div>
  )
}

export function extractTweetAttachments(raw: any): PostAttachment[] {
  const media = extractTweetMedia(raw)
  // X behavior: native media replaces the link card — when a tweet has an
  // image/video/gif, its URLs render as plain links in the text and never as
  // an og preview next to the media.
  if (media.length > 0) return uniqByUrl(media)
  return uniqByUrl(extractTweetLinks(raw))
}

export function extractTweetMedia(raw: any): PostAttachment[] {
  const atts: PostAttachment[] = []
  if (Array.isArray(raw?.media)) {
    for (const m of raw.media) {
      const type = m?.type === 'photo' ? 'image' : m?.type === 'animated_gif' ? 'gif' : m?.type
      if (type === 'video' || type === 'gif') {
        const url = getBestTweetVideoUrl(m)
        if (url) atts.push({ type, url, alt: m?.altText || m?.alt_text, image: getTweetPosterUrl(m) || undefined })
      } else {
        const url = firstString(m?.mediaUrlHttps, m?.media_url_https, m?.mediaUrl, m?.media_url, m?.url)
        if (url) atts.push({ type: 'image', url: decodeUrl(url), alt: m?.altText || m?.alt_text })
      }
    }
  }
  return atts
}

export function expandTweetLinks(text: string, raw: any): string {
  if (!text) return text
  const mediaUrls = getTweetMediaTcoUrls(raw)
  // Only real url entities (url ≠ expanded_url) participate in the exact
  // replacement pass — synthetic `{url: E, expanded_url: E}` entries built
  // from `raw.urls` are no-ops that used to poison the `used` set below and
  // starve the positional fallback (only the first N links expanded).
  const replacements = getTweetUrlEntities(raw)
    .map((entity) => ({
      from: firstString(entity?.url, entity?.tco, entity?.shortUrl, entity?.short_url),
      to: getExpandedTweetUrl(entity),
    }))
    .filter((item) => item.from && item.to && item.from !== item.to && !mediaUrls.has(item.from))
    .sort((a, b) => b.from.length - a.from.length)

  let expanded = replacements.reduce((acc, item) => acc.split(item.from).join(item.to), text)

  // Fallback for twitter-cli's parser which drops t.co but keeps expanded order (parser.py urls = [expanded_url]).
  // If t.co remains after entity expansion, replace sequentially with raw.urls / expandedUrls.
  if (expanded.includes('https://t.co/')) {
    const urlCandidates = [
      ...(Array.isArray(raw?.urls) ? raw.urls : []),
      ...(Array.isArray(raw?.expandedUrls) ? raw.expandedUrls : []),
    ].filter((u) => typeof u === 'string' && u && !/^https?:\/\/(t\.co|pic\.twitter\.com)\//i.test(u))
    if (urlCandidates.length > 0) {
      // Track which candidates have already been used via the entity map to avoid double-consuming
      const used = new Set(replacements.map((r) => r.to))
      const remaining = urlCandidates.filter((u) => !used.has(u))
      let idx = 0
      expanded = expanded.replace(/https:\/\/t\.co\/\w+/g, (match) => {
        if (mediaUrls.has(match)) return match
        if (idx < remaining.length) return remaining[idx++]
        // fallback to any remaining in order if we exhausted the filtered list
        if (idx < urlCandidates.length) return urlCandidates[idx++]
        return match
      })
    }
  }

  return expanded
}

function extractTweetLinks(raw: any): PostAttachment[] {
  const mediaUrls = getTweetMediaTcoUrls(raw)
  const card = getTweetCardPreview(raw)
  // Intended behaviour (owner-confirmed): the tweet's og card decorates ONLY
  // the first link — every other link renders as a plain expanded link.
  let cardApplied = false
  const links = getTweetUrlEntities(raw)
    .filter((entity) => !mediaUrls.has(firstString(entity?.url, entity?.tco, entity?.shortUrl, entity?.short_url)))
    .map((entity): PostAttachment | null => {
      const url = getExpandedTweetUrl(entity)
      if (!url || /^https?:\/\/(t\.co|pic\.twitter\.com|x\.com|twitter\.com)\//i.test(url)) return null
      const og = !cardApplied && card ? card : undefined
      if (og) cardApplied = true
      return {
        type: 'link',
        url,
        title: firstString(entity?.title, entity?.unwound?.title, entity?.unwoundUrl?.title, og?.title),
        description: firstString(entity?.description, entity?.unwound?.description, entity?.unwoundUrl?.description, og?.description),
        image: firstString(getTweetEntityImage(entity), og?.image),
      }
    })
    .filter((att): att is PostAttachment => Boolean(att))

  if (links.length === 0 && card?.url && !/^https?:\/\/(t\.co|pic\.twitter\.com|x\.com|twitter\.com)\//i.test(card.url)) {
    links.push({ type: 'link', url: card.url, title: card.title, description: card.description, image: card.image })
  }

  return uniqByUrl(links)
}

function getTweetUrlEntities(raw: any): any[] {
  const candidates = [
    Array.isArray(raw?.urls) ? raw.urls.map((url: string) => ({ url, expanded_url: url })) : [],
    raw?.entities?.urls,
    raw?.entities?.url?.urls,
    raw?.legacy?.entities?.urls,
  ]
  return candidates.flatMap((value) => Array.isArray(value) ? value : [])
}

function getExpandedTweetUrl(entity: any): string {
  return decodeUrl(firstString(
    entity?.expandedUrl,
    entity?.expanded_url,
    entity?.unwoundUrl?.url,
    entity?.unwound?.url,
    entity?.unwound_url,
    entity?.url,
  ))
}

function getTweetEntityImage(entity: any): string {
  const images = entity?.images || entity?.unwound?.images || entity?.unwoundUrl?.images
  if (Array.isArray(images)) {
    return decodeUrl(firstString(images[0]?.url, images[0]?.image_url, images[0]?.imageUrl))
  }
  return decodeUrl(firstString(
    entity?.image,
    entity?.imageUrl,
    entity?.image_url,
    entity?.thumbnail,
    entity?.thumbnailUrl,
    entity?.thumbnail_url,
    entity?.unwound?.image,
    entity?.unwoundUrl?.image,
  ))
}

function getTweetMediaTcoUrls(raw: any): Set<string> {
  const urls = new Set<string>()
  if (Array.isArray(raw?.media)) {
    for (const media of raw.media) {
      for (const url of [media?.url, media?.tco, media?.shortUrl, media?.short_url]) {
        if (typeof url === 'string' && url) urls.add(url)
      }
    }
  }
  return urls
}

function getBestTweetVideoUrl(media: any): string | null {
  const directUrls = [
    media?.videoUrl,
    media?.video_url,
    media?.playbackUrl,
    media?.playback_url,
    media?.expandedUrl,
    media?.expanded_url,
    media?.url,
  ].filter((url): url is string => typeof url === 'string' && /\.(mp4)(\?|$)/i.test(url))

  const variants = [
    ...(Array.isArray(media?.variants) ? media.variants : []),
    ...(Array.isArray(media?.videoInfo?.variants) ? media.videoInfo.variants : []),
    ...(Array.isArray(media?.video_info?.variants) ? media.video_info.variants : []),
  ]

  const mp4Variants = variants
    .map((v: any) => ({
      url: typeof v?.url === 'string' ? v.url : typeof v?.src === 'string' ? v.src : '',
      bitrate: Number(v?.bitrate || v?.bit_rate || 0),
      contentType: String(v?.content_type || v?.contentType || ''),
    }))
    .filter((v: { url: string; contentType: string }) =>
      v.url && (v.contentType.includes('mp4') || /\.(mp4)(\?|$)/i.test(v.url))
    )
    .sort((a: { bitrate: number }, b: { bitrate: number }) => b.bitrate - a.bitrate)

  return decodeUrl(mp4Variants[0]?.url || directUrls[0]) || null
}

function getTweetPosterUrl(media: any): string | null {
  const url = firstString(
    media?.mediaUrlHttps,
    media?.media_url_https,
    media?.mediaUrl,
    media?.media_url,
    media?.previewImageUrl,
    media?.preview_image_url,
    media?.thumbnailUrl,
    media?.thumbnail_url
  )
  return url ? decodeUrl(url) : null
}

function getTweetCardPreview(raw: any): { url?: string; title?: string; description?: string; image?: string } | null {
  const card = raw?.card || raw?.twitter_card || raw?.cardLegacy
  if (!card) return null

  const getBinding = (keys: string[]): any => {
    const bindings = card?.binding_values || card?.bindingValues || card?.bindings
    if (Array.isArray(bindings)) {
      for (const key of keys) {
        const found = bindings.find((item: any) => item?.key === key)
        if (found) return found.value
      }
    }
    if (bindings && typeof bindings === 'object') {
      for (const key of keys) {
        if (bindings[key]) return bindings[key]
      }
    }
    return undefined
  }

  const bindingString = (keys: string[]): string => {
    const value = getBinding(keys)
    return decodeUrl(firstString(
      value,
      value?.string_value,
      value?.stringValue,
      value?.url,
      value?.image_value?.url,
      value?.imageValue?.url,
    ))
  }

  const title = firstString(card?.title, bindingString(['title']))
  const description = firstString(card?.description, bindingString(['description']))
  const image = firstString(
    card?.image,
    card?.imageUrl,
    card?.image_url,
    bindingString([
      'thumbnail_image_large',
      'thumbnail_image',
      'summary_photo_image_original',
      'summary_photo_image',
      'photo_image_full_size_original',
      'player_image',
    ])
  )
  const url = firstString(
    card?.url,
    card?.expandedUrl,
    card?.expanded_url,
    bindingString(['card_url', 'vanity_url', 'player_url'])
  )

  if (!url && !title && !description && !image) return null
  return { url, title, description, image }
}

// ponytail: Reddit connector returns raw Reddit API data. Cover common Reddit media shapes:
// native video, gallery media_metadata, direct image/video URLs, preview image, thumbnail.
export function extractRedditMedia(raw: any): PostAttachment[] {
  const source = raw?.crosspost_parent_list?.[0] || raw
  const atts: PostAttachment[] = []

  const redditVideo = source?.secure_media?.reddit_video || source?.media?.reddit_video
  const redditVideoUrl = redditVideo?.fallback_url || redditVideo?.hls_url || redditVideo?.dash_url
  if (redditVideoUrl) {
    atts.push({
      type: 'video',
      url: decodeUrl(redditVideoUrl),
      image: getRedditPreviewImage(source) || undefined,
    })
    return atts
  }

  const gallery = extractRedditGalleryMedia(source)
  if (gallery.length > 0) return gallery

  const mediaUrl = decodeUrl(firstString(source?.url_overridden_by_dest, source?.url))
  if (mediaUrl && isVideoUrl(mediaUrl)) {
    atts.push({ type: 'video', url: mediaUrl, image: getRedditPreviewImage(source) || undefined })
    return atts
  }

  if (source?.post_hint === 'image' && mediaUrl && isImageUrl(mediaUrl)) {
    atts.push({ type: 'image', url: mediaUrl })
    return atts
  }

  const previewImages = source?.preview?.images
  if (Array.isArray(previewImages) && previewImages.length > 0) {
    const previewSource = previewImages[0]?.source
    if (previewSource?.url) {
      atts.push({ type: 'image', url: decodeUrl(previewSource.url) })
      return atts
    }
  }

  if (source?.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(source.thumbnail)) {
    atts.push({ type: 'image', url: decodeUrl(source.thumbnail) })
  }

  return atts
}

function extractRedditGalleryMedia(raw: any): PostAttachment[] {
  const metadata = raw?.media_metadata
  if (!metadata || typeof metadata !== 'object') return []

  const orderedIds = Array.isArray(raw?.gallery_data?.items)
    ? raw.gallery_data.items.map((item: any) => item?.media_id).filter(Boolean)
    : Object.keys(metadata)

  return orderedIds.flatMap((id: string): PostAttachment[] => {
    const item = metadata[id]
    if (!item) return []

    const mime = String(item?.m || '')
    const source = item?.s || {}
    const url = decodeUrl(firstString(source?.mp4, source?.gif, source?.u))
    if (!url) return []

    if (mime.includes('video') || isVideoUrl(url)) {
      return [{ type: item?.e === 'AnimatedImage' ? 'gif' : 'video', url }]
    }
    return [{ type: 'image', url }]
  })
}

function getRedditPreviewImage(raw: any): string | null {
  const source = raw?.preview?.images?.[0]?.source
  if (source?.url) return decodeUrl(source.url)
  if (raw?.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(raw.thumbnail)) {
    return decodeUrl(raw.thumbnail)
  }
  return null
}
