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
import { compactionThresholdTokens } from '../electron/main/context-budget'

/** The flat compaction line (owner decision): 180k tokens, model-independent. */
const THRESHOLD = compactionThresholdTokens()

function okStreamResult(opts: { text?: string; responseMessages?: any[]; usage?: any } = {}) {
  const text = opts.text ?? 'here is the answer'
  return {
    stream: (async function* () {
      yield { type: 'text-delta', text }
      yield { type: 'finish-step', usage: opts.usage ?? {} }
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

  it('re-checks the gate when rotating onto the fallback model', async () => {
    // The first model is exhausted and skipped; the gate still runs for the
    // fallback before it samples.
    mocks.providers.buildChatFallbackChain.mockReturnValue(['gemini-3.7-flash', 'glm-5.3'])
    mocks.db.isModelExhaustedForAllKeys.mockImplementation((model: string) => model === 'gemini-3.7-flash')
    mocks.db.getChatSessionSteps.mockReturnValue(storedTurn)
    mocks.db.getChatSessionContextTokens.mockReturnValue(THRESHOLD + 5_000)

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

  it('emits live context tokens per sampling step mid-turn', async () => {
    const onContextTokens = vi.fn()
    mocks.streamText.mockImplementation(() =>
      okStreamResult({ usage: { inputTokens: 42_000, outputTokens: 2_000 } }),
    )
    await runAgent(baseRun({ onContextTokens }))
    expect(onContextTokens).toHaveBeenCalledWith(44_000, 'test-model-a')
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

describe('step-boundary persistence (ticket #68)', () => {
  it('persists the transcript at each step boundary and anchors userCount at turn start', async () => {
    const onCheckpoint = vi.fn()
    mocks.streamText.mockImplementation((opts: any) => {
      // Simulate the SDK invoking prepareStep at each step boundary — step 0
      // (turn start) and step 1 (after the first step's response messages).
      opts.prepareStep?.({ stepNumber: 0, messages: opts.messages, responseMessages: [] })
      opts.prepareStep?.({
        stepNumber: 1,
        messages: opts.messages,
        responseMessages: [{ role: 'assistant', content: 'step one output' }],
      })
      return okStreamResult()
    })

    const run = baseRun({ onCheckpoint })
    await runAgent(run)

    const calls = mocks.db.updateChatSessionSteps.mock.calls
    // Step 0: the base transcript, with steps_user_count anchored at turn start.
    expect(calls[0][2]).toBe(1)
    expect(calls[0][1]).toHaveLength(1)
    // Step 1: base + the completed step's response messages.
    expect(JSON.stringify(calls[1][1])).toContain('step one output')
    expect(calls[1][2]).toBe(1)
    // The end-of-run persist remains the final write.
    expect(calls[calls.length - 1][2]).toBe(1)
    // The caller learned about the checkpoints (partial content flush).
    expect(onCheckpoint).toHaveBeenCalledTimes(2)
    expect(onCheckpoint.mock.calls[0][0]).toBe('')
  })

  it('repairs dangling tool calls in the stored transcript before reuse', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue({
      steps: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_social_content', input: {} }] },
        { role: 'user', content: 'q2' },
      ],
      userCount: 2,
    })
    // Incoming history is one turn ahead of the stored transcript (crash was
    // between turns): q3 is the new message appended onto the repaired base.
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: 'a2' },
      { role: 'user' as const, content: 'q3' },
    ]
    await runAgent(baseRun({ messages: history }))

    // The repair was persisted back with the stored userCount preserved.
    const repairCall = mocks.db.updateChatSessionSteps.mock.calls.find(
      (c: any[]) => JSON.stringify(c[1]).includes('interrupted before it produced a result'),
    )
    expect(repairCall).toBeDefined()
    expect(repairCall![2]).toBe(2)
    // The model samples from the repaired transcript — the dangling call got
    // its synthesized cancelled result.
    const sent = mocks.streamText.mock.calls[0][0].messages
    expect(JSON.stringify(sent)).toContain('interrupted before it produced a result')
  })

  it('does not rewrite stored steps when the transcript has nothing dangling', async () => {
    mocks.db.getChatSessionSteps.mockReturnValue({
      steps: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
      userCount: 1,
    })
    await runAgent(baseRun())
    // No repair persist: the only updateChatSessionSteps calls are the
    // end-of-run persist (checkpoints don't fire without prepareStep in the
    // default mock).
    const repairCalls = mocks.db.updateChatSessionSteps.mock.calls.filter(
      (c: any[]) => c[2] === 1 && (c[1] as any[]).some((m) => m.role === 'user' && m.content === 'q1'),
    )
    expect(repairCalls.length).toBeLessThanOrEqual(1)
  })
})

describe('mid-turn compaction (ticket #70)', () => {
  // ~187k tokens at chars/4 — crosses the flat 180k line on its own.
  const HUGE = 'x'.repeat(750_000)

  it('swaps the step input to carrier + tail when the safe-point estimate crosses the line', async () => {
    mocks.streamText.mockImplementation((opts: any) => {
      const stream = (async function* () {
        // prepareStep for step N+1 fires between steps — await it here, the
        // same point where the real SDK does.
        opts.__midTurnReturn = await opts.prepareStep?.({
          stepNumber: 1,
          messages: opts.messages,
          responseMessages: [{ role: 'assistant', content: HUGE }],
        })
        yield { type: 'text-delta', text: 'here is the answer' }
        yield { type: 'finish-step', usage: {} }
      })()
      return { stream, responseMessages: Promise.resolve([]), steps: Promise.resolve([]), totalUsage: Promise.resolve({}) }
    })

    const run = baseRun()
    await runAgent(run)

    // Compaction ran and persisted (possibly chunked — several summarizer passes).
    expect(mocks.aiGenerateText.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mocks.db.updateChatSessionContextSummary).toHaveBeenCalledTimes(1)
    // The next step's input is the carrier-first compacted transcript.
    const swapped = mocks.streamText.mock.calls[0][0].__midTurnReturn
    expect(swapped?.messages?.[0]?.role).toBe('user')
    expect(JSON.stringify(swapped.messages[0])).toContain(COMPACTION_CARRIER_OPEN)
    // The end-of-run persist is carrier-first too — the pre-swap responses
    // live in the carrier summary and never flow back in.
    const persistCalls = mocks.db.updateChatSessionSteps.mock.calls
    const finalCall = persistCalls[persistCalls.length - 1]
    expect(JSON.stringify(finalCall[1][0])).toContain(COMPACTION_CARRIER_OPEN)
    // The turn continued seamlessly and completed.
    expect(run.onDone).toHaveBeenCalledWith('here is the answer')
    expect(run.onError).not.toHaveBeenCalled()
  })

  it('compacts at most once per turn even if later boundaries still cross', async () => {
    mocks.streamText.mockImplementation((opts: any) => {
      const stream = (async function* () {
        for (const step of [1, 2, 3]) {
          await opts.prepareStep?.({
            stepNumber: step,
            messages: opts.messages,
            responseMessages: [{ role: 'assistant', content: HUGE }],
          })
        }
        yield { type: 'text-delta', text: 'here is the answer' }
        yield { type: 'finish-step', usage: {} }
      })()
      return { stream, responseMessages: Promise.resolve([]), steps: Promise.resolve([]), totalUsage: Promise.resolve({}) }
    })

    await runAgent(baseRun())

    expect(mocks.streamText).toHaveBeenCalledTimes(1)
    expect(mocks.db.updateChatSessionContextSummary).toHaveBeenCalledTimes(1)
  })
})
