import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Agent context-gate integration tests (spec #53): the runAgent seam with the
 * AI SDK, providers, and db mocked — compaction triggers before sampling when
 * the context gate crosses the model's high-water mark, provider-reported
 * usage is captured as the session's context snapshot, and a classified
 * context-overflow error compacts once and resubmits instead of dying.
 */
vi.mock('electron', () => ({
  app: { getAppPath: () => '/repo' },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}))

const mocks = vi.hoisted(() => ({
  db: {
    getProfile: vi.fn(() => ({})),
    getAvailableApiKeyForModel: vi.fn(() => ({ id: 1, api_key: 'key-1' })),
    markModelExhausted: vi.fn(),
    isModelExhaustedForAllKeys: vi.fn(() => false),
    updateApiKeyLastUsed: vi.fn(),
    getChatSessionSteps: vi.fn(() => null),
    updateChatSessionSteps: vi.fn(),
    getDb: vi.fn(() => ({ prepare: () => ({ get: () => undefined, run: () => undefined, all: () => [] }) })),
    getCustomProviderCredential: vi.fn(() => null),
    getChatSessionContextSummary: vi.fn(() => null),
    getChatSessionContextTokens: vi.fn(() => null),
    updateChatSessionContextTokens: vi.fn(),
    updateChatSessionContextSummary: vi.fn(),
  },
  providers: {
    createModelInstance: vi.fn(async () => ({ provider: 'fake' })),
    buildChatFallbackChain: vi.fn(() => ['test-model-a']),
  },
  streamText: vi.fn(),
  aiGenerateText: vi.fn(),
}))

vi.mock('../electron/main/db', () => mocks.db)
vi.mock('../electron/main/providers', () => ({
  createModelInstance: mocks.providers.createModelInstance,
  buildChatFallbackChain: mocks.providers.buildChatFallbackChain,
}))
vi.mock('../electron/main/log', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mocks.streamText(...args),
  generateText: (...args: unknown[]) => mocks.aiGenerateText(...args),
  isStepCount: (max: number) => ({ stepNumber }: { stepNumber: number }) => stepNumber >= max,
}))

import { runAgent } from '../electron/main/agent'
import { COMPACTION_CARRIER_OPEN } from '../electron/main/compaction'

/** The chain-head window's high-water mark — 'test-model-a' falls back to defaults. */
const THRESHOLD = Math.floor(0.85 * (131_072 - 8_192))

function okStreamResult(opts: { text?: string; responseMessages?: any[]; usage?: any } = {}) {
  const text = opts.text ?? 'here is the answer'
  return {
    stream: (async function* () {
      yield { type: 'text-delta', text }
    })(),
    responseMessages: Promise.resolve(opts.responseMessages ?? []),
    steps: Promise.resolve(opts.usage ? [{ usage: opts.usage }] : []),
    totalUsage: Promise.resolve(opts.usage ?? {}),
  }
}

function failStreamResult(errorMessage: string) {
  return {
    stream: (async function* () {
      yield { type: 'error', error: new Error(errorMessage) }
    })(),
    responseMessages: Promise.resolve([]),
    steps: Promise.resolve([]),
    totalUsage: Promise.resolve({}),
  }
}

function baseRun(overrides: Partial<Parameters<typeof runAgent>[0]> = {}) {
  return {
    messages: [{ role: 'user' as const, content: 'new question' }],
    onDone: vi.fn(),
    onError: vi.fn(),
    sessionId: 1,
    ...overrides,
  }
}

/** Stored transcript from a previous turn — big enough that the tail budget
 * (15k tokens) cannot swallow it, so the gate has something to summarize. */
const storedTurn = {
  steps: [
    ...Array.from({ length: 6 }, (_, i) => ({ role: 'user', content: `earlier question ${i} ${'q'.repeat(6000)}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ role: 'assistant', content: `earlier answer ${i} ${'a'.repeat(6000)}` })),
  ],
  userCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.db.getChatSessionSteps.mockReturnValue(null)
  mocks.db.getChatSessionContextTokens.mockReturnValue(null)
  mocks.db.getChatSessionContextSummary.mockReturnValue(null)
  mocks.db.isModelExhaustedForAllKeys.mockReturnValue(false)
  mocks.db.getAvailableApiKeyForModel.mockReturnValue({ id: 1, api_key: 'key-1' })
  mocks.providers.buildChatFallbackChain.mockReturnValue(['test-model-a'])
  mocks.streamText.mockImplementation(() => okStreamResult())
  // agent.generateText destructures `{ text }` from the ai SDK result.
  mocks.aiGenerateText.mockResolvedValue({ text: `summary body. `.repeat(60) })
})

describe('runAgent context gate', () => {
  it('compacts before sampling when the stored context snapshot crosses the threshold', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.db.getChatSessionContextTokens.mockReturnValue(THRESHOLD + 5_000)

    const run = baseRun()
    await runAgent(run)

    expect(mocks.aiGenerateText).toHaveBeenCalledTimes(1)
    const summaryCall = mocks.aiGenerateText.mock.calls[0][0]
    expect(summaryCall.messages[0].content).toContain('Summarize the conversation history below')

    // The model must see the carrier, not the raw stored transcript.
    const sentMessages = mocks.streamText.mock.calls[0][0].messages
    expect(sentMessages[0].role).toBe('user')
    expect(JSON.stringify(sentMessages[0])).toContain(COMPACTION_CARRIER_OPEN)
    expect(sentMessages.at(-1)?.role).toBe('user')

    // Compaction state persists for the next turn and the badge.
    expect(mocks.db.updateChatSessionContextSummary).toHaveBeenCalledTimes(1)
    expect(mocks.db.updateChatSessionSteps).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      1,
    )
    expect(run.onDone).toHaveBeenCalledWith('here is the answer')
    expect(run.onError).not.toHaveBeenCalled()
  })

  it('leaves the request untouched under the threshold', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.db.getChatSessionContextTokens.mockReturnValue(1_000)

    const run = baseRun()
    await runAgent(run)

    expect(mocks.aiGenerateText).not.toHaveBeenCalled()
    expect(mocks.db.updateChatSessionContextSummary).not.toHaveBeenCalled()
    const sentMessages = mocks.streamText.mock.calls[0][0].messages
    expect(JSON.stringify(sentMessages)).not.toContain(COMPACTION_CARRIER_OPEN)
  })

  it('re-checks the gate when rotating onto a smaller-window fallback model', async () => {
    // gemini (1M window) is exhausted; glm (128k window) takes over — its
    // threshold is below the stored snapshot, so the gate must fire for it.
    mocks.providers.buildChatFallbackChain.mockReturnValue(['gemini-3.7-flash', 'glm-5.3'])
    mocks.db.isModelExhaustedForAllKeys.mockImplementation((model: string) => model === 'gemini-3.7-flash')
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.db.getChatSessionContextTokens.mockReturnValue(100_000) // ≥ glm threshold (94_872), ≪ gemini's

    const run = baseRun()
    await runAgent(run)

    expect(mocks.aiGenerateText).toHaveBeenCalledTimes(1)
    const sentMessages = mocks.streamText.mock.calls[0][0].messages
    expect(JSON.stringify(sentMessages[0])).toContain(COMPACTION_CARRIER_OPEN)
    expect(run.onDone).toHaveBeenCalledWith('here is the answer')
  })

  it('captures provider-reported usage as the session context snapshot', async () => {
    mocks.streamText.mockImplementation(() =>
      okStreamResult({ usage: { inputTokens: 5_000, outputTokens: 500 } }),
    )
    await runAgent(baseRun())
    expect(mocks.db.updateChatSessionContextTokens).toHaveBeenCalledWith(1, 5_500)
  })

  it('compacts once and resubmits on a classified context-overflow error', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.streamText
      .mockImplementationOnce(() => failStreamResult('prompt is too long: 200000 tokens > 180000 maximum'))
      .mockImplementationOnce(() => okStreamResult())

    const run = baseRun()
    await runAgent(run)

    expect(mocks.streamText).toHaveBeenCalledTimes(2)
    expect(mocks.aiGenerateText).toHaveBeenCalledTimes(1)
    const retryMessages = mocks.streamText.mock.calls[1][0].messages
    expect(JSON.stringify(retryMessages[0])).toContain(COMPACTION_CARRIER_OPEN)
    expect(run.onDone).toHaveBeenCalledWith('here is the answer')
    expect(run.onError).not.toHaveBeenCalled()
  })

  it('surfaces a typed context error when overflow persists after the recovery budget', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.streamText.mockImplementation(() => failStreamResult('prompt is too long'))
    const run = baseRun()
    await runAgent(run)

    // Gate compaction → resubmit → still overflowing → recovery budget spent
    // → the run terminates naming the real cause.
    expect(mocks.streamText).toHaveBeenCalledTimes(2)
    expect(mocks.aiGenerateText).toHaveBeenCalledTimes(1)
    expect(run.onDone).not.toHaveBeenCalled()
    expect(run.onError).toHaveBeenCalledTimes(1)
    expect(run.onError.mock.calls[0][0]).toContain('outgrew the available models')
    expect(run.onError.mock.calls[0][1]?.errorKind).toBe('context-overflow')
  })

  it('fails open (run fails normally) when the summarizer is unavailable', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.streamText.mockImplementation(() => failStreamResult('prompt is too long'))
    mocks.aiGenerateText.mockRejectedValue(new Error('provider on fire'))
    const run = baseRun()
    await runAgent(run)

    // One compaction attempt was made and refused; the run then exhausted the
    // chain instead of looping forever.
    expect(mocks.streamText).toHaveBeenCalledTimes(1)
    expect(mocks.aiGenerateText).toHaveBeenCalledTimes(1)
    expect(run.onDone).not.toHaveBeenCalled()
    expect(run.onError).toHaveBeenCalledTimes(1)
    expect(run.onError.mock.calls[0][1]?.errorKind).toBe('context-overflow')
  })

  it('runs without compaction when no session is given', async () => {
    const run = baseRun({ sessionId: undefined })
    await runAgent(run)
    expect(mocks.aiGenerateText).not.toHaveBeenCalled()
    expect(mocks.db.updateChatSessionContextTokens).not.toHaveBeenCalled()
    expect(run.onDone).toHaveBeenCalled()
  })
})
