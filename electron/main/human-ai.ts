// One-shot AI reply drafting for the Human-mode composer.
//
// The chat agent drafts replies through a multi-step tool loop (fetch post →
// media check → read voice rules → read examples → draft). This path inverts
// that: the main process pre-gathers the entire dossier the loop would have
// collected — voice rules, curated reply examples, profile, the target post
// with its quote layer, and the reply-crafting/voice/media-safety guides —
// embeds it into one prompt, and makes exactly ONE generation call with no
// tools. The model's only job is judgment + writing.
//
// Safety posture:
// - Draft-only: nothing here can post, like, or mutate anything. Posting
//   stays 100% manual through the existing humanReply flow.
// - Native video/animated-GIF targets are refused deterministically before
//   any model call (media-safety hard rule). Quote-video is left to model
//   judgment: it sees the quoter's text and can tell whether the reply
//   depends on the video at all.
// - Photos are attached inline (multimodal) so the model sees them; a
//   text-only fallback model is instructed to never guess visual content.

import { generateText as aiGenerateText } from 'ai'
import { getProfile, queryAll, getSocialContent, getAvailableApiKeyForModel } from './db'
import { createModelInstance, buildChatFallbackChain, parseModelRef } from './providers'
import { readWorkflowGuide } from './reference-files'
import { logger } from './log'
import { createAppError } from '../../src/types/app-error'
import type {
  HumanReplyDraftRequest,
  HumanReplyDraftResult,
  HumanResult,
} from '../../src/features/human/types'

/** How many fallback-chain models the one-shot may rotate through. */
const MAX_MODEL_ATTEMPTS = 3
/** Wall-clock ceiling for the single generation call. */
const GENERATION_TIMEOUT_MS = 60_000
/** Images bigger than this are not embedded (mirrors inspect_image_url). */
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
/** At most one image rides along — the one the reply is most likely to need. */
const MAX_IMAGE_INPUTS = 1
/** Curated reply examples embedded in the dossier. */
const MAX_EXAMPLES = 15
/** Raw archive fallback when the curated set is thin. */
const MIN_EXAMPLES = 3
const MAX_RAW_SAMPLES = 10

const VIDEO_TYPES = new Set(['video', 'animated_gif', 'gif'])

function isVideoish(item: { type?: string } | undefined | null): boolean {
  return Boolean(item && VIDEO_TYPES.has(String(item.type).toLowerCase()))
}

/** Media types the renderer can attach inline for the model to see. */
function firstPhotoUrl(items: Array<{ type?: string; url?: string }> | undefined | null): string | undefined {
  for (const item of items ?? []) {
    const type = String(item?.type ?? '').toLowerCase()
    if ((type === 'photo' || type === 'image') && typeof item.url === 'string' && /^https?:\/\//.test(item.url)) {
      return item.url
    }
  }
  return undefined
}

// ─── Image fetch (same header treatment as inspect_image_url) ───────────────

async function fetchImageAsFilePart(
  url: string,
): Promise<{ mediaType: string; base64: string } | null> {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return null
    const needsXReferer =
      parsed.hostname.includes('twitter') ||
      parsed.hostname.includes('x.com') ||
      parsed.hostname.includes('twimg')
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    }
    if (needsXReferer) {
      headers.Referer = 'https://x.com/'
      headers.Origin = 'https://x.com'
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS) })
    if (!response.ok) return null
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (!mimeType.startsWith('image/')) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > IMAGE_MAX_BYTES) return null
    return { mediaType: mimeType, base64: buffer.toString('base64') }
  } catch {
    return null
  }
}

// ─── Dossier assembly ────────────────────────────────────────────────────────

/** Strip credential-looking fields before anything enters a prompt. */
function safeProfileFields(profile: any): Record<string, unknown> {
  if (!profile || typeof profile !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (/api[_-]?key|token|secret|password/i.test(key)) continue
    if (value === null || value === undefined || value === '') continue
    out[key] = value
  }
  return out
}

export interface ReplyDraftPrompt {
  system: string
  /** Text part of the user message (image parts are appended separately). */
  userText: string
  /** Resolved photo URL to attach inline, if any. */
  imageUrl?: string
}

/**
 * Compose the full one-shot prompt. Pure apart from DB/reference reads, so
 * tests can drive it with mocked db + reference-files modules.
 */
export function buildReplyDraftPrompt(request: HumanReplyDraftRequest): ReplyDraftPrompt {
  const guides = [
    readWorkflowGuide('reply-crafting'),
    readWorkflowGuide('voice-guide'),
    readWorkflowGuide('media-safety'),
  ].join('\n\n---\n\n')

  const system = `You are Soxial's one-shot reply drafter for the Human-mode composer.

You receive a complete dossier: the user's voice profile, their real writing examples, and the target post (with its quote layer and attached image when present). You have NO tools. You respond exactly once, with strict JSON.

${guides}

MODAL CONTEXT (adjusts the rules above):
- The user explicitly chose to reply to this specific post, so image posts are always worth drafting (inspect the attached image below) rather than skipped — but visual content is NEVER guessed.
- A video/animated-GIF in the TARGET POST's own media = hard refusal ({"refused": true, "reason": "..."}).
- A video inside a QUOTED post = judgment call: if the quoter's text stands alone, draft from it and note the caveat in "why"; if the post's substance is the video, refuse.

OUTPUT — strict JSON on a single line, nothing before or after:
{"reply": "<draft text>", "archetype": "<one of the reply archetypes>", "why": "<one line: what value it adds>"}
or {"refused": true, "reason": "<one line>"}

Reply drafts must respect the given character limit, pass the voice verification checklist, and read like the user typed them on their phone — not like an AI assistant.`

  // ── Voice dossier ──
  const profile = safeProfileFields(getProfile())
  const voiceRules = (queryAll('voice_rules') as any[])
    .slice(0, 30)
    .map((row) => `- [${row?.type ?? 'rule'}] ${row?.content ?? ''}`.trim())
    .filter((line) => line.length > 8)

  const examples = (queryAll('replies') as any[]).slice(0, MAX_EXAMPLES)
  let exampleLines = examples
    .map((row) => `- (${row?.platform ?? 'x'}) ${String(row?.text ?? '').replace(/\s+/g, ' ').trim()}`)
    .filter((line) => line.length > 6)

  // Thin curated set → pad with the raw archive of the user's own writing.
  if (exampleLines.length < MIN_EXAMPLES) {
    const handle = profile.twitter_handle || profile.reddit_username
    const raw = getSocialContent({ author_handle: typeof handle === 'string' ? handle : undefined, limit: MAX_RAW_SAMPLES })
    const rawLines = (Array.isArray(raw) ? raw : [])
      .map((row: any) => `- (${row?.platform ?? 'x'}) ${String(row?.text ?? '').replace(/\s+/g, ' ').trim()}`)
      .filter((line: string) => line.length > 6)
    exampleLines = [...exampleLines, ...rawLines].slice(0, MAX_EXAMPLES)
  }

  // ── Target post block ──
  const mediaDesc = (request.media ?? [])
    .map((m) => `${m.type}${m.url ? ` (${m.url.slice(0, 90)})` : ''}`)
    .join(', ')
  const quote = request.quoted
  const quoteMediaDesc = quote?.media?.map((m) => m.type).join(', ')

  const targetBlock = [
    `Author: @${request.authorHandle ?? 'unknown'}${request.authorName ? ` (${request.authorName})` : ''}`,
    `Text:\n${request.content ?? '(no text captured — refuse if there is nothing to reply to)'}`,
    `Native media: ${mediaDesc || 'none'}`,
    quote
      ? `Quoted post: @${quote.authorHandle ?? 'unknown'}${quote.id ? ` [${quote.id}]` : ''}\n${quote.text ?? '(no text)'}\nQuoted media: ${quoteMediaDesc || 'none'}`
      : 'Quoted post: none',
  ].join('\n')

  // ── Image selection: the native photo first, else the quote's photo ──
  const imageUrl = firstPhotoUrl(request.media) ?? firstPhotoUrl(quote?.media)

  // ── Constraints block ──
  const constraints: string[] = [
    `Character limit for the reply: ${request.charLimit ?? 280}.`,
  ]
  if (request.instruction?.trim()) {
    constraints.push(`User steer (follow unless it conflicts with voice/safety): ${request.instruction.trim()}`)
  }
  if (request.previousDrafts?.length) {
    constraints.push(
      `Previous drafts for this post (do NOT repeat their angle — pick a different archetype):\n${request.previousDrafts
        .slice(-3)
        .map((d) => `- ${d.replace(/\s+/g, ' ').slice(0, 140)}`)
        .join('\n')}`,
    )
  }
  constraints.push(
    imageUrl
      ? `An image from the target post is attached below. Use what it shows ONLY if the reply genuinely depends on it.`
      : `No image is attached. If the post contains photos you cannot see, draft from text only and say so in "why" — never guess visual content.`,
  )

  const userText = `Draft one reply to this post.

=== THE USER YOU DRAFT FOR ===
Profile: ${JSON.stringify(profile)}
Voice rules:
${voiceRules.length ? voiceRules.join('\n') : '(none saved yet — rely on the universal voice guide)'}
Real writing examples (match phrasing and rhythm, not a summary):
${exampleLines.length ? exampleLines.join('\n') : '(no examples saved yet — stay blunt and brief)'}

=== TARGET POST (X) ===
${targetBlock}

=== CONSTRAINTS ===
${constraints.join('\n')}

Respond with the strict JSON now.`

  return { system, userText, imageUrl }
}

// ─── Lenient output parsing ─────────────────────────────────────────────────

function firstBalancedJson(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

export function parseDraftResponse(raw: string): HumanReplyDraftResult {
  const trimmed = raw.trim()
  const candidates: string[] = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) candidates.push(fenced[1].trim())
  const balanced = firstBalancedJson(trimmed)
  if (balanced) candidates.push(balanced)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') {
        if (parsed.refused === true) {
          return { refused: { reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'The drafter declined this post.' } }
        }
        const text = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
        if (text) {
          return {
            text,
            ...(typeof parsed.archetype === 'string' && parsed.archetype.trim() ? { archetype: parsed.archetype.trim() } : {}),
            ...(typeof parsed.why === 'string' && parsed.why.trim() ? { why: parsed.why.trim() } : {}),
          }
        }
      }
    } catch {
      /* next candidate */
    }
  }

  // Fallback: the whole response is the draft.
  const text = trimmed.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim()
  return text ? { text } : { refused: { reason: 'The drafter returned an empty response.' } }
}

// ─── Credential resolution (local, avoids pulling agent.ts's dep graph) ─────

function resolveApiKey(modelId: string): string | null {
  const available = getAvailableApiKeyForModel(modelId, undefined)
  if (available) return available.api_key
  const profile = getProfile()
  const kind = parseModelRef(modelId).kind
  if (kind === 'zhipu' && profile?.zai_api_key) return profile.zai_api_key
  if (kind === 'google' && profile?.gemini_api_key) return profile.gemini_api_key
  if (kind === 'openai' && profile?.openai_api_key) return profile.openai_api_key
  if (kind === 'anthropic' && profile?.anthropic_api_key) return profile.anthropic_api_key
  if (kind === 'google' && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  return null
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * One-shot reply draft: deterministic media refusal → dossier composition →
 * a single multimodal generation call (small model-rotation loop for
 * resilience) → lenient JSON parse.
 */
export async function draftHumanReply(request: HumanReplyDraftRequest): Promise<HumanResult<HumanReplyDraftResult>> {
  const tweetId = String(request?.tweetId ?? '').trim()
  if (!tweetId) {
    return {
      ok: false,
      error: createAppError(
        { code: 'HUMAN_REPLY_DRAFT_INVALID', category: 'validation', retryable: false },
        'A tweet is required to draft a reply.',
      ),
    }
  }

  // Deterministic refusal: native video/animated-GIF targets are never
  // drafted (media-safety hard rule) — no model call is spent.
  if ((request.media ?? []).some(isVideoish)) {
    return { ok: true, data: { refused: { reason: 'Video posts cannot be AI-drafted (media safety). Write your own reply instead.' } } }
  }

  let prompt: ReplyDraftPrompt
  try {
    prompt = buildReplyDraftPrompt({ ...request, tweetId })
  } catch (e: any) {
    logger.warn('human-ai', `dossier composition failed: ${e?.message}`)
    return {
      ok: false,
      error: createAppError(
        { code: 'HUMAN_REPLY_DRAFT_FAILED', category: 'internal', retryable: true, action: 'retry' },
        'The draft context could not be assembled. Try again.',
      ),
    }
  }

  // Attach at most one image (native photo preferred over the quote's).
  const imagePart =
    prompt.imageUrl && MAX_IMAGE_INPUTS > 0 ? await fetchImageAsFilePart(prompt.imageUrl) : null

  const userContent: any[] = [{ type: 'text', text: prompt.userText }]
  if (imagePart) {
    userContent.push({ type: 'file', mediaType: imagePart.mediaType, data: imagePart.base64 })
  }

  const chain = buildChatFallbackChain().slice(0, MAX_MODEL_ATTEMPTS)
  let lastError = 'No model could be reached.'

  for (const modelId of chain) {
    let apiKey: string | null
    try {
      apiKey = resolveApiKey(modelId)
    } catch {
      apiKey = null
    }
    if (!apiKey) {
      logger.warn('human-ai', `no credential for ${modelId}, skipping`)
      continue
    }

    try {
      const modelInstance = await createModelInstance(parseModelRef(modelId), apiKey)
      const { text } = await aiGenerateText({
        model: modelInstance,
        system: prompt.system,
        messages: [{ role: 'user', content: userContent }],
        temperature: 0.7,
        maxOutputTokens: 2048,
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      })
      if (!text || !text.trim()) throw new Error('empty completion')
      const result = parseDraftResponse(text)
      logger.info('human-ai', `draft generated via ${modelId} (${(result.text ?? '').length} chars${result.refused ? ', refused' : ''})`)
      return { ok: true, data: result }
    } catch (e: any) {
      lastError = e?.message || String(e)
      logger.warn('human-ai', `${modelId} draft attempt failed: ${lastError.slice(0, 160)}`)
    }
  }

  return {
    ok: false,
    error: createAppError(
      { code: 'HUMAN_REPLY_DRAFT_FAILED', category: 'internal', retryable: true, action: 'retry', message: lastError.slice(0, 200) },
      'The draft could not be generated. Try again in a moment.',
    ),
  }
}
