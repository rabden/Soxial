import { describe, expect, it, vi } from 'vitest'

/**
 * Compaction engine tests (spec #53): history splitting with tool-pair
 * snapping, head serialization for the summarizer, the summary prompt
 * contract, degenerate-output rejection, carrier construction, and the
 * end-to-end compactSessionHistory flow with an injected summarizer —
 * including the overflow fit-ladder and fail-open behavior.
 */
import {
  COMPACTION_CARRIER_CLOSE,
  COMPACTION_CARRIER_OPEN,
  SUMMARY_MIN_CHARS,
  buildCarrierMessage,
  buildSummaryRequest,
  compactSessionHistory,
  isCompactionCarrier,
  isDegenerateSummary,
  serializeHeadForSummary,
  splitForCompaction,
} from '../electron/main/compaction'
import { isContextLengthError } from '../electron/main/context-errors'

const WIN = { contextWindow: 131_072, maxOutputTokens: 8_192 }

function userMsg(text: string) {
  return { role: 'user', content: text }
}
function assistantMsg(text: string) {
  return { role: 'assistant', content: text }
}
/** An assistant turn carrying a tool call followed by its result message. */
function toolExchange(id: string, name: string, resultText: string) {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: `calling ${name}` },
        { type: 'tool-call', toolCallId: id, toolName: name, input: { q: id } },
      ],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { data: resultText } }],
    },
  ]
}

describe('splitForCompaction', () => {
  it('keeps the newest messages inside the tail budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => userMsg('x'.repeat(400))) // 100 tokens each
    const { head, tail } = splitForCompaction(messages, 500)
    expect(tail.length).toBeGreaterThanOrEqual(4)
    expect(tail.length).toBeLessThanOrEqual(6)
    expect(head.length + tail.length).toBe(20)
    expect(tail.at(-1)).toBe(messages.at(-1))
  })

  it('never opens the tail with tool results — snaps back to the assistant call', () => {
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => userMsg('a'.repeat(400))),
      ...toolExchange('t1', 'search', 'r'.repeat(50)),
      userMsg('final question'),
    ]
    // Budget chosen so the naive boundary lands exactly on the tool message.
    const { head, tail } = splitForCompaction(messages, 130)
    expect(tail[0].role).not.toBe('tool')
    // The tool result stays together with its assistant tool-call.
    if (tail.some(m => m.role === 'tool')) {
      const toolIdx = tail.findIndex(m => m.role === 'tool')
      expect(tail[toolIdx - 1].role).toBe('assistant')
    }
    expect(tail.at(-1)?.role).toBe('user')
    void head
  })

  it('returns an empty head when the whole history fits the tail budget', () => {
    const messages = [userMsg('only'.repeat(500)), assistantMsg('reply'.repeat(500))]
    const { head, tail } = splitForCompaction(messages, 100_000)
    // Nothing to summarize — compactSessionHistory must fail open on this.
    expect(head).toEqual([])
    expect(tail).toEqual(messages)
  })

  it('handles empty history', () => {
    const { head, tail } = splitForCompaction([], 500)
    expect(head).toEqual([])
    expect(tail).toEqual([])
  })
})

describe('serializeHeadForSummary', () => {
  it('renders text verbatim and truncates oversized tool results', () => {
    const head = [
      userMsg('hello world'),
      ...toolExchange('t1', 'web_search', 'z'.repeat(5_000)),
    ]
    const out = serializeHeadForSummary(head, null)
    expect(out).toContain('[user] hello world')
    expect(out).toContain('calling web_search')
    expect(out).toContain('[tool result for web_search]')
    expect(out).toContain('…[truncated]')
    expect(out.length).toBeLessThan('z'.repeat(5_000).length)
  })

  it('marks image attachments as placeholders', () => {
    const head = [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'file', mediaType: 'image/png', data: 'xxx' }] }]
    const out = serializeHeadForSummary(head, null)
    expect(out).toContain('[image attachment]')
  })

  it('folds a prior summary into a prior-summary block and skips the old carrier', () => {
    const oldCarrier = buildCarrierMessage('the old summary')
    const head = [oldCarrier, userMsg('newer message')]
    const out = serializeHeadForSummary(head, 'the old summary')
    expect(out).toContain('<prior-summary>')
    expect(out).toContain('the old summary')
    expect(out).not.toContain(COMPACTION_CARRIER_OPEN)
    expect(out).toContain('newer message')
  })
})

describe('buildSummaryRequest', () => {
  it('carries the structured template and carry-forward rules', () => {
    const req = buildSummaryRequest('SERIALIZED')
    expect(req.system).toContain('## Objective')
    expect(req.system).toContain('## Work State')
    expect(req.system).toContain('## Next Move')
    expect(req.system).toContain('prior-summary')
    expect(req.system.toLowerCase()).toContain('verbatim')
    expect(req.user).toContain('<conversation-to-summarize>')
    expect(req.user).toContain('SERIALIZED')
  })
})

describe('carrier messages', () => {
  it('marks the summary as authoritative memory via tag markers', () => {
    const carrier = buildCarrierMessage('SUMMARY BODY')
    expect(carrier.role).toBe('user')
    expect(carrier.content[0].text).toContain(COMPACTION_CARRIER_OPEN)
    expect(carrier.content[0].text).toContain('SUMMARY BODY')
    expect(carrier.content[0].text).toContain(COMPACTION_CARRIER_CLOSE)
    expect(isCompactionCarrier(carrier)).toBe(true)
    expect(isCompactionCarrier(userMsg('normal'))).toBe(false)
  })
})

describe('isDegenerateSummary', () => {
  it('rejects empty, trivial, or whitespace-only output', () => {
    expect(isDegenerateSummary('')).toBe(true)
    expect(isDegenerateSummary('ok')).toBe(true)
    expect(isDegenerateSummary('   \n\t ')).toBe(true)
  })

  it('accepts substantive summaries', () => {
    expect(isDegenerateSummary('word '.repeat(SUMMARY_MIN_CHARS))).toBe(false)
  })
})

describe('isContextLengthError', () => {
  it('recognizes provider context-overflow messages', () => {
    expect(isContextLengthError(new Error("This model's maximum context length is 8192 tokens"))).toBe(true)
    expect(isContextLengthError(new Error('prompt is too long: 200000 tokens > 180000 maximum'))).toBe(true)
    expect(isContextLengthError(new Error('The input token count (1000000) exceeds the maximum number of tokens allowed (900000)'))).toBe(true)
    expect(isContextLengthError(new Error('Input exceeds context window'))).toBe(true)
    expect(isContextLengthError({ message: 'Request too large: token limit exceeded' })).toBe(true)
  })

  it('does not misclassify quota, auth, or transient errors', () => {
    expect(isContextLengthError(new Error('exceeded your current quota'))).toBe(false)
    expect(isContextLengthError(new Error('invalid api key'))).toBe(false)
    expect(isContextLengthError(new Error('fetch failed'))).toBe(false)
    expect(isContextLengthError(new Error('model is overloaded, try again later'))).toBe(false)
  })
})

describe('compactSessionHistory', () => {
  const baseMessages = [
    ...Array.from({ length: 8 }, (_, i) => userMsg(`question ${i} ${'q'.repeat(6000)}`)),
    ...Array.from({ length: 8 }, (_, i) => assistantMsg(`answer ${i} ${'a'.repeat(6000)}`)),
  ]
  const summaryText = 'word '.repeat(SUMMARY_MIN_CHARS)

  it('returns carrier + tail with a summary from the injected summarizer', async () => {
    const summarize = vi.fn(async () => summaryText)
    const result = await compactSessionHistory({
      system: 'SYS',
      modelMessages: baseMessages,
      modelId: 'glm-5.3',
      priorSummary: null,
      summarize,
    })
    expect(result).not.toBeNull()
    expect(summarize).toHaveBeenCalledTimes(1)
    const req = summarize.mock.calls[0][0]
    expect(req.system).toContain('## Objective')
    expect(req.user).toContain('question 0')

    // Everything before the tail is replaced by exactly one carrier message.
    const { tail } = splitForCompaction(baseMessages, tailBudgetOf('glm-5.3'))
    expect(result!.compactedMessages.length).toBe(1 + tail.length)
    expect(isCompactionCarrier(result!.compactedMessages[0])).toBe(true)
    expect(result!.compactedMessages.slice(1)).toEqual(tail)
  })

  it('passes the prior summary through to the prompt', async () => {
    const summarize = vi.fn(async () => summaryText)
    await compactSessionHistory({
      system: 'SYS',
      modelMessages: baseMessages,
      modelId: 'glm-5.3',
      priorSummary: 'PRIOR FACTS',
      summarize,
    })
    expect(summarize.mock.calls[0][0].user).toContain('PRIOR FACTS')
  })

  it('retries once on a degenerate summary, then fails open', async () => {
    const summarize = vi.fn(async () => 'too short')
    const result = await compactSessionHistory({
      system: 'SYS', modelMessages: baseMessages, modelId: 'glm-5.3', priorSummary: null, summarize,
    })
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(result).toBeNull()
  })

  it('degrades the input via the fit ladder when the summary call itself overflows', async () => {
    const summarize = vi
      .fn()
      .mockRejectedValueOnce(new Error('prompt is too long: 300000 tokens > 200000 maximum'))
      .mockResolvedValueOnce(summaryText)
    const result = await compactSessionHistory({
      system: 'SYS', modelMessages: baseMessages, modelId: 'glm-5.3', priorSummary: null, summarize,
    })
    expect(result).not.toBeNull()
    expect(summarize).toHaveBeenCalledTimes(2)
    // The retry must be a lossier (smaller) serialization of the same head.
    const first = summarize.mock.calls[0][0].user.length
    const second = summarize.mock.calls[1][0].user.length
    expect(second).toBeLessThan(first)
  })

  it('fails open without retrying on non-context summarizer errors', async () => {
    const summarize = vi.fn(async () => {
      throw new Error('provider on fire')
    })
    const result = await compactSessionHistory({
      system: 'SYS', modelMessages: baseMessages, modelId: 'glm-5.3', priorSummary: null, summarize,
    })
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null without calling the summarizer when there is nothing to summarize', async () => {
    const summarize = vi.fn(async () => summaryText)
    const result = await compactSessionHistory({
      system: 'SYS', modelMessages: [userMsg('fresh question')], modelId: 'glm-5.3', priorSummary: null, summarize,
    })
    expect(result).toBeNull()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('keeps assistant tool-calls glued to their results in the tail', async () => {
    // The engine guarantees the ordering invariant by construction (the
    // snap-forward rule); the caller additionally runs
    // repairModelMessagePairing over the compacted output before persisting.
    const messages = [...baseMessages, ...toolExchange('t9', 'search', 'r'.repeat(20)), userMsg('last')]
    const summarize = vi.fn(async () => summaryText)
    const result = await compactSessionHistory({
      system: 'SYS', modelMessages: messages, modelId: 'glm-5.3', priorSummary: null, summarize,
    })
    const tail = result!.compactedMessages.slice(1)
    for (let i = 0; i < tail.length; i++) {
      if (tail[i].role === 'tool') expect(tail[i - 1].role, `tool message at ${i} needs its assistant call before it`).toBe('assistant')
    }
  })

  it('keeps tail messages as the same object references — provider signatures ride along', () => {
    // Fog item (map #54): the compacted tail must not rebuild messages, or
    // Google thoughtSignatures / providerOptions would be stripped.
    const signed = {
      role: 'assistant',
      content: [{ type: 'text', text: 'with signature' }],
      providerOptions: { google: { thoughtSignature: 'sig-abc' } },
    }
    const { tail } = splitForCompaction([userMsg('old'), signed], 100_000)
    expect(tail).toContain(signed)
    expect(tail.find(m => m.role === 'assistant')).toBe(signed)
  })

  describe('chunked fold (oversized heads)', () => {
    // Summarizer window sized so ~900-token chunks force multiple folds.
    const tinySummarizerWindow = { contextWindow: 8_000, maxOutputTokens: 1_000 }

    function bigHead(messageCount: number) {
      return Array.from({ length: messageCount }, (_, i) => userMsg(`chunk fodder ${i} ${'x'.repeat(3400)}`))
    }

    it('folds an oversized head chunk-by-chunk, carrying each fold forward', async () => {
      let fold = 0
      const summarize = vi.fn(async () => {
        fold += 1
        return `fold ${fold} ${summaryText}`
      })
      const result = await compactSessionHistory({
        system: 'SYS',
        modelMessages: [...bigHead(30), assistantMsg('recent'), userMsg('latest question')],
        modelId: 'glm-5.3',
        priorSummary: null,
        summarizerWindow: tinySummarizerWindow,
        summarize,
      })
      expect(result).not.toBeNull()
      expect(result!.chunkCount).toBeGreaterThanOrEqual(2)
      expect(summarize).toHaveBeenCalledTimes(result!.chunkCount)

      // Call 0 carries no prior; each later call carries the previous fold.
      expect(summarize.mock.calls[0][0].user).not.toContain('<prior-summary>\nfold')
      expect(summarize.mock.calls[1][0].user).toContain('<prior-summary>')
      const lastCall = summarize.mock.calls.at(-1)![0].user
      expect(lastCall).toContain(`fold ${result!.chunkCount - 1}`)

      // The final summary (last fold) lands in the carrier.
      expect(result!.summary).toContain(`fold ${result!.chunkCount}`)
      expect(result!.compactedMessages[0].content[0].text).toContain(`fold ${result!.chunkCount}`)
    })

    it('feeds the original prior summary into the first chunk only', async () => {
      const summarize = vi.fn(async () => summaryText)
      const result = await compactSessionHistory({
        system: 'SYS',
        modelMessages: [...bigHead(30), userMsg('latest question')],
        modelId: 'glm-5.3',
        priorSummary: 'ORIGINAL PRIOR',
        summarizerWindow: tinySummarizerWindow,
        summarize,
      })
      expect(result!.chunkCount).toBeGreaterThanOrEqual(2)
      expect(summarize.mock.calls[0][0].user).toContain('ORIGINAL PRIOR')
    })

    it('fails open when any chunk fails', async () => {
      const summarize = vi.fn()
        .mockResolvedValueOnce(summaryText)
        .mockRejectedValueOnce(new Error('provider on fire'))
      const result = await compactSessionHistory({
        system: 'SYS',
        modelMessages: [...bigHead(30), userMsg('latest question')],
        modelId: 'glm-5.3',
        priorSummary: null,
        summarizerWindow: tinySummarizerWindow,
        summarize,
      })
      expect(result).toBeNull()
      expect(summarize).toHaveBeenCalledTimes(2)
    })
  })


})

// Local helper: with the flat 200k window policy every catalog model clamps
// to the same preserve-recent cap; WIN mirrors that shape.
import { tailBudgetTokens } from '../electron/main/context-budget'
function tailBudgetOf(_modelId: string): number {
  return tailBudgetTokens(WIN)
}
