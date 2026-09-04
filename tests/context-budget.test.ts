import { describe, expect, it } from 'vitest'
import {
  CHARS_PER_TOKEN,
  COMPACTION_THRESHOLD_TOKENS,
  IMAGE_TOKEN_ESTIMATE,
  OUTPUT_RESERVE_CAP,
  TAIL_BUDGET_MAX_TOKENS,
  TAIL_BUDGET_MIN_TOKENS,
  compactionThresholdTokens,
  estimateContextTokens,
  estimateMessageTokens,
  estimateTokens,
  tailBudgetTokens,
  usableWindowTokens,
} from '../electron/main/context-budget'
import { ANTHROPIC_MODEL_CATALOG, DEFAULT_MODEL_WINDOW, GOOGLE_MODEL_CATALOG, getModelWindow, OPENAI_MODEL_CATALOG, ZHIPU_MODEL_CATALOG } from '../electron/main/models'

describe('estimateTokens', () => {
  it('divides character length by CHARS_PER_TOKEN', () => {
    expect(CHARS_PER_TOKEN).toBe(4)
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(1) // rounds
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('never goes negative', () => {
    expect(estimateTokens('x')).toBeGreaterThanOrEqual(0)
  })
})

describe('image estimation', () => {
  it('charges a flat per-image cost (grok-build parity)', () => {
    expect(IMAGE_TOKEN_ESTIMATE).toBe(765)
    expect(estimateMessageTokens({ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: 'x' }] }))
      .toBe(IMAGE_TOKEN_ESTIMATE + 4)
  })
})

describe('estimateMessageTokens', () => {
  it('counts plain string content', () => {
    expect(estimateMessageTokens({ role: 'user', content: 'a'.repeat(40) })).toBe(10 + 4) // + envelope
  })

  it('counts text parts, tool calls, and tool results', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'b'.repeat(100) },
        { type: 'tool-call', toolCallId: '1', toolName: 'search', input: { q: 'c'.repeat(40) } },
      ],
    }
    const expectedText = 100 / 4
    const expectedArgs = JSON.stringify({ q: 'c'.repeat(40) }).length / 4
    expect(estimateMessageTokens(msg)).toBe(Math.round(expectedText) + Math.round(expectedArgs) + 8 + 4)
  })

  it('charges images flat and tolerates unknown shapes', () => {
    expect(estimateMessageTokens({ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: 'zzz' }] }))
      .toBe(IMAGE_TOKEN_ESTIMATE + 4)
    expect(estimateMessageTokens(null)).toBe(0)
    expect(estimateMessageTokens({})).toBe(0)
    expect(estimateMessageTokens({ role: 'user', content: 42 })).toBe(0)
  })
})

describe('estimateContextTokens', () => {
  it('adds the system prompt to the message total', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(40) },
      { role: 'assistant', content: 'b'.repeat(60) },
    ]
    expect(estimateContextTokens('s'.repeat(100), messages)).toBe(25 + (10 + 4) + (15 + 4))
  })
})

describe('usableWindowTokens', () => {
  it('reserves the smaller of the output reserve cap and max output', () => {
    expect(usableWindowTokens({ contextWindow: 200_000, maxOutputTokens: 128_000 }))
      .toBe(200_000 - OUTPUT_RESERVE_CAP)
    expect(usableWindowTokens({ contextWindow: 200_000, maxOutputTokens: 8_192 }))
      .toBe(200_000 - 8_192)
  })
})

describe('compactionThresholdTokens', () => {
  it('is the flat, absolute 180k compaction line (owner decision)', () => {
    expect(COMPACTION_THRESHOLD_TOKENS).toBe(180_000)
    expect(compactionThresholdTokens()).toBe(180_000)
  })
})

describe('tailBudgetTokens', () => {
  it('clamps the preserve-recent share between min and max', () => {
    // 200k window → 25% of usable far exceeds the cap
    expect(tailBudgetTokens({ contextWindow: 200_000, maxOutputTokens: 128_000 })).toBe(TAIL_BUDGET_MAX_TOKENS)
    // 65k window → 25% of usable sits between the clamps
    expect(tailBudgetTokens({ contextWindow: 65_536, maxOutputTokens: 8_192 }))
      .toBe(Math.round(0.25 * (65_536 - 8_192)))
    // tiny window → floor at the minimum
    expect(tailBudgetTokens({ contextWindow: 4_000, maxOutputTokens: 1_000 })).toBe(TAIL_BUDGET_MIN_TOKENS)
    expect(TAIL_BUDGET_MIN_TOKENS).toBe(2_000)
    expect(TAIL_BUDGET_MAX_TOKENS).toBe(15_000)
  })
})

describe('catalog window fields', () => {
  it('gives every catalog entry the flat 200k context window', () => {
    for (const catalog of [GOOGLE_MODEL_CATALOG, ZHIPU_MODEL_CATALOG, OPENAI_MODEL_CATALOG, ANTHROPIC_MODEL_CATALOG]) {
      for (const entry of catalog) {
        expect(entry.contextWindow, entry.id).toBe(200_000)
        expect(entry.maxOutputTokens, entry.id).toBeGreaterThan(0)
        expect(entry.maxOutputTokens, entry.id).toBeLessThan(entry.contextWindow)
      }
    }
  })

  it('falls back to the same flat policy for unknown and custom ids', () => {
    expect(getModelWindow('totally-unknown-model')).toEqual(DEFAULT_MODEL_WINDOW)
    expect(getModelWindow('custom/7/llama-4-maverick')).toEqual(DEFAULT_MODEL_WINDOW)
  })
})
