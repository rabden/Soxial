import { describe, expect, it } from 'vitest'
import {
  summarizeTrace,
  toolCompletedChip,
  toolDetails,
  toolResultPhrase,
} from '../src/lib/tool-format'

// Regression pins for the tool-format split: the formatter must stay
// deterministic (no wall-clock keys) and engagement rollups must keep
// counting duplicate-text posts individually.

describe('formatter determinism (call-ordinal keys)', () => {
  const post = (text: string, result: any = { ok: true }) => ({
    type: 'tool' as const,
    toolName: 'twitter_post',
    args: { text },
    result,
  })

  it('keeps duplicate-text posts distinct so Engaged N times counts stay exact', () => {
    // Five calls in the same instant would collide under a Date.now() key.
    const summary = summarizeTrace([
      post('hi'),
      post('hi'),
      post('hi'),
      post('hi'),
      post('hi'),
    ])
    expect(summary.phrases).toEqual(['Engaged 5 times'])
    expect(summary.failedCount).toBe(0)
  })

  it('counts quotes, posts and likes together per call, not per text', () => {
    const summary = summarizeTrace([
      { type: 'tool', toolName: 'twitter_quote', args: { text: 'same' }, result: { ok: true } },
      { type: 'tool', toolName: 'twitter_quote', args: { text: 'same' }, result: { ok: true } },
      post('same'),
      post('same'),
      { type: 'tool', toolName: 'twitter_like', args: { tweet_id: '42' }, result: { ok: true } },
    ])
    expect(summary.phrases).toEqual(['Engaged 5 times'])
  })

  it('returns byte-identical summaries across repeated invocations', () => {
    const nodes = [
      { type: 'reasoning' },
      {
        type: 'tool',
        toolName: 'twitter_search',
        args: { query: 'a' },
        result: { ok: true, data: Array.from({ length: 10 }, (_, i) => ({ id: i })) },
      },
      {
        type: 'tool',
        toolName: 'reddit_search',
        args: { subreddit: 'x' },
        result: { ok: true, data: Array.from({ length: 12 }, (_, i) => ({ id: i })) },
      },
      post('launch day'),
      post('launch day'),
      post('follow-up thread'),
      { type: 'tool', toolName: 'read_hooks', result: [] },
      { type: 'tool', toolName: 'ask_user_questions', args: { questions: [{}, {}] }, result: { answers: [{}, {}] } },
    ]
    const first = {
      summary: summarizeTrace(nodes),
      phrase: toolResultPhrase('twitter_post', {}, { ok: true }),
      chip: toolCompletedChip('twitter_search', { query: 'hooks' }, { ok: true, data: [{ id: 1 }] }),
      details: toolDetails('twitter_feed', {}, { ok: true, data: [{ id: 1 }] }),
    }
    for (let i = 0; i < 25; i++) {
      expect(summarizeTrace(nodes)).toStrictEqual(first.summary)
      expect(toolResultPhrase('twitter_post', {}, { ok: true })).toBe(first.phrase)
      expect(toolCompletedChip('twitter_search', { query: 'hooks' }, { ok: true, data: [{ id: 1 }] })).toBe(first.chip)
      expect(toolDetails('twitter_feed', {}, { ok: true, data: [{ id: 1 }] })).toStrictEqual(first.details)
    }
    // Rollup sums stay byte-stable: duplicate-text posts each count once.
    expect(first.summary).toEqual({
      phrases: ['Thought once', 'Scanned 22 posts', 'Engaged 3 times', 'Read strategy library', 'Asked you 2 questions'],
      failedCount: 0,
    })
  })
})

describe('settled-header budget floor', () => {
  it('always keeps the leading phrases even past MAX_HEADER_CHARS', () => {
    // Three ~76-char phrases blow the 120-char budget after the first line;
    // the floor must retain all three rather than truncating to the budget.
    const read = (ch: string) => ({
      type: 'tool' as const,
      toolName: 'twitter_user_posts',
      args: { handle: ch.repeat(60) },
      result: { ok: true, data: [{ id: 1 }] },
    })
    const summary = summarizeTrace([read('a'), read('b'), read('c')])
    expect(summary.phrases).toHaveLength(3)
    expect(summary.phrases.every((p) => p.startsWith('Read @'))).toBe(true)
    expect(summary.phrases.some((p) => p.endsWith('more'))).toBe(false)
  })
})

describe('public API at the historical module path', () => {
  it('exposes the pre-split surface with unchanged shapes', async () => {
    const tf = await import('../src/lib/tool-format')
    for (const fn of ['itemsOf', 'isFailedResult', 'toolArgsChip', 'toolResultPhrase', 'toolCompletedChip', 'summarizeTrace', 'toolDetails']) {
      expect(typeof (tf as Record<string, unknown>)[fn]).toBe('function')
    }
    // The label-injection indirection is gone (F4): labels resolve directly.
    expect('setFallbackLabelLookup' in tf).toBe(false)
    expect(tf.summarizeTrace([])).toEqual({ phrases: [], failedCount: 0 })
    expect(tf.toolCompletedChip('twitter_search', { query: 'hooks' }, { ok: true, data: [{ id: 1 }, { id: 2 }] })).toBe(
      'hooks → 2 results',
    )
  })
})
