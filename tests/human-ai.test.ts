/**
 * One-shot AI reply drafter tests.
 *
 * Locks the contract of `draftHumanReply`: the dossier composition (voice
 * rules, examples, guides, target context embedded in ONE prompt), the
 * deterministic video refusal (no model call spent), inline image attachment,
 * lenient JSON parsing, refusal passthrough, and model rotation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/repo' },
}))

const mocks = vi.hoisted(() => ({
  db: {
    getProfile: vi.fn(),
    queryAll: vi.fn(),
    getSocialContent: vi.fn(),
    getAvailableApiKeyForModel: vi.fn(),
  },
  reference: {
    readWorkflowGuide: vi.fn((name: string) => `# GUIDE:${name}\nGuide body for ${name}.`),
  },
  providers: {
    createModelInstance: vi.fn(async () => ({ provider: 'fake-model' })),
    buildChatFallbackChain: vi.fn(() => ['gemini-3.7-flash', 'glm-5.3']),
  },
  generateText: vi.fn(),
}))

vi.mock('../electron/main/db', () => mocks.db)
vi.mock('../electron/main/reference-files', () => mocks.reference)
vi.mock('../electron/main/providers', () => ({
  createModelInstance: (...args: unknown[]) => mocks.providers.createModelInstance(...args),
  buildChatFallbackChain: () => mocks.providers.buildChatFallbackChain(),
  parseModelRef: (id: string) => ({ kind: 'google', modelId: id }),
}))
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mocks.generateText(...args),
}))
// log.ts touches electron paths only — keep it quiet.
vi.mock('../electron/main/log', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  buildReplyDraftPrompt,
  draftHumanReply,
  parseDraftResponse,
} from '../electron/main/human-ai'

const profileRow = {
  name: 'Test User',
  twitter_handle: 'tester',
  niche: 'indie hacking',
  voice_description: 'blunt, brief, lowercase starts',
  avoid_words: 'synergy',
  zai_api_key: 'SECRET-ZAI',
  gemini_api_key: 'SECRET-GOOGLE',
}

const baseRequest = {
  tweetId: '123456789',
  authorHandle: 'dannypostma',
  authorName: 'Danny Postma',
  content: 'made a little design workbench',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.db.getProfile.mockReturnValue(profileRow)
  mocks.db.queryAll.mockImplementation((table: string) => {
    if (table === 'voice_rules') {
      return [
        { id: 1, type: 'banned_phrase', content: 'Great take!' },
        { id: 2, type: 'natural_element', content: 'contractions' },
      ]
    }
    if (table === 'replies') {
      return [
        { id: 1, platform: 'twitter', category: 'curated', text: 'ngl this fixed my deploy too' },
        { id: 2, platform: 'twitter', category: 'curated', text: 'wait this is the actual answer' },
      ]
    }
    return []
  })
  mocks.db.getSocialContent.mockReturnValue([
    { id: 1, platform: 'twitter', text: 'raw archive sample one' },
    { id: 2, platform: 'twitter', text: 'raw archive sample two' },
  ])
  mocks.db.getAvailableApiKeyForModel.mockReturnValue({ id: 7, api_key: 'key-1' })
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})

describe('parseDraftResponse', () => {
  it('parses strict JSON', () => {
    const result = parseDraftResponse('{"reply":"ngl this rocks","archetype":"blunt one-liner","why":"adds detail"}')
    expect(result).toEqual({ text: 'ngl this rocks', archetype: 'blunt one-liner', why: 'adds detail' })
  })

  it('parses fenced JSON with surrounding prose', () => {
    const result = parseDraftResponse('Here you go:\n```json\n{"reply":"draft text","archetype":"question"}\n```')
    expect(result.text).toBe('draft text')
    expect(result.archetype).toBe('question')
  })

  it('extracts the first balanced JSON object from garbage', () => {
    const result = parseDraftResponse('Sure! {"reply":"embedded draft","why":"x"} hope this helps')
    expect(result.text).toBe('embedded draft')
    expect(result.why).toBe('x')
  })

  it('falls back to the raw text when nothing parses', () => {
    const result = parseDraftResponse('just a plain draft, no json at all')
    expect(result).toEqual({ text: 'just a plain draft, no json at all' })
  })

  it('passes refusals through with the reason', () => {
    const result = parseDraftResponse('{"refused":true,"reason":"video post"}')
    expect(result).toEqual({ refused: { reason: 'video post' } })
  })

  it('refuses on empty responses', () => {
    expect(parseDraftResponse('   ').refused).toBeTruthy()
  })
})

describe('buildReplyDraftPrompt', () => {
  it('embeds the full dossier: guides, voice rules, examples, target, quote layer', () => {
    const prompt = buildReplyDraftPrompt({
      ...baseRequest,
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg' }],
      quoted: { id: 'q1', authorHandle: 'sama', text: 'quoted text', media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/q.jpg' }] },
      charLimit: 280,
      previousDrafts: ['first attempt'],
    })

    // The three guides are embedded in the system prompt, verbatim source-of-truth.
    expect(prompt.system).toContain('# GUIDE:reply-crafting')
    expect(prompt.system).toContain('# GUIDE:voice-guide')
    expect(prompt.system).toContain('# GUIDE:media-safety')

    // Voice dossier in the user message.
    expect(prompt.userText).toContain('[banned_phrase] Great take!')
    expect(prompt.userText).toContain('ngl this fixed my deploy too')
    // Raw archive pads the thin curated set.
    expect(prompt.userText).toContain('raw archive sample one')

    // Credentials never enter a prompt.
    expect(prompt.userText).not.toContain('SECRET')

    // Target + quote + constraints.
    expect(prompt.userText).toContain('@dannypostma')
    expect(prompt.userText).toContain('made a little design workbench')
    expect(prompt.userText).toContain('Quoted post: @sama')
    expect(prompt.userText).toContain('Character limit for the reply: 280')
    expect(prompt.userText).toContain('first attempt')

    // Native photo wins over the quote's photo.
    expect(prompt.imageUrl).toBe('https://pbs.twimg.com/media/pic.jpg')
  })

  it('falls back to the quoted post photo when the target has none', () => {
    const prompt = buildReplyDraftPrompt({
      ...baseRequest,
      quoted: { media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/q.jpg' }] },
    })
    expect(prompt.imageUrl).toBe('https://pbs.twimg.com/media/q.jpg')
  })
})

describe('draftHumanReply', () => {
  it('refuses native video targets deterministically, without a model call', async () => {
    const result = await draftHumanReply({
      ...baseRequest,
      media: [{ type: 'video', url: 'https://video.twimg.com/x.mp4' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.refused?.reason).toMatch(/video/i)
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('also refuses animated GIF targets (video-equivalent per media safety)', async () => {
    const result = await draftHumanReply({
      ...baseRequest,
      media: [{ type: 'animated_gif', url: 'https://video.twimg.com/x.gif' }],
    })
    expect(result.ok && result.data.refused).toBeTruthy()
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('makes exactly ONE generation call and returns the parsed draft', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"reply":"on brand","archetype":"one-liner","why":"value"}' })

    const result = await draftHumanReply(baseRequest)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.text).toBe('on brand')
    expect(mocks.generateText).toHaveBeenCalledTimes(1)

    const call = mocks.generateText.mock.calls[0][0]
    // One user message, system present, no tools anywhere.
    expect(call.system).toContain('GUIDE:reply-crafting')
    expect(call.messages).toHaveLength(1)
    expect(call.tools).toBeUndefined()
    // Text-only content when no photo exists.
    expect(call.messages[0].content).toEqual([{ type: 'text', text: expect.stringContaining('@dannypostma') }])
  })

  it('attaches the photo inline as a multimodal file part', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4])
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => imageBytes.buffer,
    })
    mocks.generateText.mockResolvedValue({ text: '{"reply":"saw the image"}' })

    await draftHumanReply({ ...baseRequest, media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg' }] })

    const call = mocks.generateText.mock.calls[0][0]
    const parts = call.messages[0].content
    expect(parts).toHaveLength(2)
    expect(parts[0].type).toBe('text')
    expect(parts[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    // The X referer treatment for twimg fetches.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers.Referer).toBe('https://x.com/')
  })

  it('rotates to the next model when the first fails', async () => {
    mocks.generateText
      .mockRejectedValueOnce(new Error('429 quota exceeded'))
      .mockResolvedValueOnce({ text: '{"reply":"second model worked"}' })

    const result = await draftHumanReply(baseRequest)

    expect(result.ok && result.data.text).toBe('second model worked')
    expect(mocks.generateText).toHaveBeenCalledTimes(2)
  })

  it('surfaces a typed error when the whole chain fails', async () => {
    mocks.generateText.mockRejectedValue(new Error('boom'))

    const result = await draftHumanReply(baseRequest)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.retryable).toBe(true)
    expect(result.error.action).toBe('retry')
  })

  it('rejects a missing tweet id before anything else', async () => {
    const result = await draftHumanReply({ tweetId: '' })
    expect(result.ok).toBe(false)
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('passes model refusals (e.g. substance-is-video quotes) through as data', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"refused":true,"reason":"the post is just a video clip"}' })

    const result = await draftHumanReply({
      ...baseRequest,
      quoted: { text: '', media: [{ type: 'video', url: 'https://v/x.mp4' }] },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.refused?.reason).toContain('video')
  })
})
