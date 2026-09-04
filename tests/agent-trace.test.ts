import { describe, expect, it } from 'vitest'
import { parseSteps } from '../src/features/chat/messages'
import { groupStepsIntoSegments } from '../src/features/chat/trace-groups'
import type { StepItem } from '../src/features/chat/types'
import { pillSecondaryText, toSentences } from '../src/lib/trace-text'
import type { ToolDefinition } from '../src/lib/agent-trace-types'
import {
  isFailedResult,
  summarizeTrace,
  toolArgsChip,
  toolCompletedChip,
  toolDetails,
  toolResultPhrase,
} from '../src/lib/tool-format'

describe('parseSteps', () => {
  it('returns undefined when both columns are empty', () => {
    expect(parseSteps(null, undefined)).toBeUndefined()
    expect(parseSteps('', '')).toBeUndefined()
  })

  it('parses the legacy bare StepItem[] format', () => {
    const legacy: StepItem[] = [
      { type: 'tool', id: 1, name: 'read_profile', args: {}, status: 'complete' },
      { type: 'text', text: 'Done' },
    ]
    const result = parseSteps(null, JSON.stringify(legacy))
    expect(result).toEqual(legacy)
    expect(result).not.toHaveProperty('durationSeconds')
  })

  it('parses a legacy plain-string reasoning column', () => {
    const result = parseSteps('Thinking hard about hooks', null)
    expect(result).toEqual([{ type: 'reasoning', text: 'Thinking hard about hooks' }])
  })

  it('parses the v2 envelope, ignoring the legacy durationSeconds field', () => {
    const steps: StepItem[] = [
      { type: 'reasoning', text: 'Analyzing.' },
      { type: 'tool', id: 2, name: 'read_hooks', args: { category: 'all' }, status: 'complete' },
    ]
    const payload = JSON.stringify({ version: 2, durationSeconds: 14, steps })
    const result = parseSteps(null, payload)
    expect(result).toEqual(steps)
    expect(result).not.toHaveProperty('durationSeconds')
  })

  it('tolerates malformed JSON without throwing', () => {
    const result = parseSteps('{not json', '{"steps": [')
    expect(result?.[0]).toEqual({ type: 'reasoning', text: '{not json' })
  })
})

describe('groupStepsIntoSegments', () => {
  it('merges consecutive reasoning and tool steps into one trace segment', () => {
    const steps: StepItem[] = [
      { type: 'reasoning', text: 'Let me look.' },
      { type: 'tool', id: 1, name: 'read_profile', args: {}, status: 'complete' },
      { type: 'tool', id: 2, name: 'read_hooks', args: {}, status: 'calling' },
    ]
    const segments = groupStepsIntoSegments(steps)
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('trace')
    if (segments[0].kind !== 'trace') return
    expect(segments[0].nodes).toHaveLength(3)
    expect(segments[0].settled).toBe(false)
    expect(segments[0].nodes[2].status).toBe('running')
  })

  it('splits traces around text segments and marks earlier traces settled', () => {
    const steps: StepItem[] = [
      { type: 'reasoning', text: 'First thought.' },
      { type: 'tool', id: 1, name: 'twitter_search', args: { query: 'hooks' }, status: 'complete' },
      { type: 'text', text: 'Here is what I found.' },
      { type: 'tool', id: 2, name: 'save_hook', args: {}, status: 'complete' },
      { type: 'text', text: 'Saved.' },
    ]
    const segments = groupStepsIntoSegments(steps)
    expect(segments.map((s) => s.kind)).toEqual(['trace', 'text', 'trace', 'text'])
    if (segments[0].kind === 'trace' && segments[2].kind === 'trace') {
      expect(segments[0].settled).toBe(true)
      // Text follows this trace too, so the agent has moved past it.
      expect(segments[2].settled).toBe(true)
    } else {
      throw new Error('expected trace segments at positions 0 and 2')
    }
  })

  it('leaves a trailing trace unsettled while nothing follows it', () => {
    const steps: StepItem[] = [
      { type: 'tool', id: 1, name: 'read_memory', args: {}, status: 'calling' },
    ]
    const segments = groupStepsIntoSegments(steps)
    if (segments[0].kind !== 'trace') throw new Error('expected trace segment')
    expect(segments[0].settled).toBe(false)
  })

  it('emits question steps as their own segments and skips empty text', () => {
    const steps: StepItem[] = [
      { type: 'text', text: '   ' },
      { type: 'question', id: 'q1', text: 'Which niche?', qtype: 'single', options: ['a'], status: 'answered', answer: 'a' },
    ]
    const segments = groupStepsIntoSegments(steps)
    expect(segments.map((s) => s.kind)).toEqual(['question'])
  })

  it('applies decorateTool to tool nodes', () => {
    const steps: StepItem[] = [
      { type: 'tool', id: 9, name: 'generate_image', args: {}, status: 'complete' },
    ]
    const segments = groupStepsIntoSegments(steps, {
      decorateTool: (node) => ({ ...node, primary: 'decorated' }),
    })
    if (segments[0].kind !== 'trace') throw new Error('expected trace segment')
    expect(segments[0].nodes[0].primary).toBe('decorated')
  })
})

describe('toSentences', () => {
  it('splits reasoning text on sentence boundaries', () => {
    expect(toSentences('First one. Second one! Third?')).toEqual([
      'First one.',
      'Second one!',
      'Third?',
    ])
  })

  it('falls back to lines and never returns empty for non-empty input', () => {
    expect(toSentences('no punctuation here')).toEqual(['no punctuation here'])
    expect(toSentences('line one\nline two')).toEqual(['line one', 'line two'])
    expect(toSentences('   ')).toEqual([])
  })
})

describe('pillSecondaryText', () => {
  const toolDef: ToolDefinition = { name: 'twitter_search' }

  it('returns undefined for unregistered tools instead of leaking the args chip', () => {
    expect(
      pillSecondaryText({
        node: { type: 'tool', toolName: 'ask_user_questions', args: { questions: [{}, {}, {}] }, status: 'running' },
        done: false,
      })
    ).toBeUndefined()
  })

  it('falls back to the args chip only when the tool is registered', () => {
    expect(
      pillSecondaryText({
        node: { type: 'tool', toolName: 'twitter_search', args: { query: 'hooks' }, status: 'running' },
        toolDef,
        done: false,
      })
    ).toBe('hooks')
  })

  it('prefers an explicit secondary over every computed chip', () => {
    expect(
      pillSecondaryText({
        node: { type: 'tool', toolName: 'twitter_search', args: { query: 'hooks' }, secondary: 'Custom', status: 'completed' },
        toolDef,
        done: true,
      })
    ).toBe('Custom')
  })

  it('shows the short error once the call failed', () => {
    expect(
      pillSecondaryText({
        node: { type: 'tool', toolName: 'reddit_read', args: {}, result: { ok: false, error: 'Not logged in' }, status: 'failed' },
        done: true,
      })
    ).toBe('Not logged in')
  })
})

describe('toolArgsChip', () => {
  it('summarizes search arguments per platform', () => {
    expect(toolArgsChip('twitter_search', { query: 'build in public', type: 'top' })).toBe(
      '“build in public” · top'
    )
    expect(toolArgsChip('reddit_search', { query: 'hooks', subreddit: 'frontend', sort: 'top' })).toBe(
      'r/frontend · hooks · top'
    )
  })

  it('extracts handles, subreddits and counts', () => {
    expect(toolArgsChip('twitter_user_posts', { handle: 'naval' })).toBe('@naval')
    expect(toolArgsChip('reddit_sub_info', { subreddit: 'webdev' })).toBe('r/webdev')
    expect(toolArgsChip('save_hook', { items: [1, 2, 3] })).toBe('3 items')
    expect(toolArgsChip('delete_hooks', { by_name: ['a', 'b'] })).toBe('2 entries')
    expect(toolArgsChip('ask_user_questions', { questions: [{}, {}, {}] })).toBe('3 questions')
  })

  it('formats scheduling and returns undefined for empty args', () => {
    expect(
      toolArgsChip('schedule_post', { platform: 'twitter', scheduled_time: '2026-06-23T09:00:00' })
    ).toBe('twitter · Jun 23, 09:00')
    expect(toolArgsChip('read_hooks', {})).toBeUndefined()
    expect(toolArgsChip('twitter_feed', undefined)).toBeUndefined()
  })
})

describe('toolResultPhrase / toolCompletedChip', () => {
  it('counts listing results and media', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, text: 'x' }))
    expect(toolResultPhrase('twitter_search', {}, { ok: true, data: items })).toBe('12 results')
    const withMedia = [
      { id: 1, text: 'a', media: [{ type: 'photo' }] },
      { id: 2, text: 'b', media: [] },
      { id: 3, text: 'c', media_url: 'http://x/y.png' },
    ]
    expect(toolResultPhrase('reddit_sub', {}, { ok: true, data: withMedia })).toBe(
      '3 posts · 2 w/ media'
    )
    expect(toolResultPhrase('twitter_feed', {}, { ok: true, data: [] })).toBe('No results')
  })

  it('surfaces short errors from the CLI envelope', () => {
    const longError = Array(10).fill('Rate limited').join(' ')
    const chip = toolResultPhrase('twitter_feed', {}, { ok: false, error: longError })
    expect(chip!.startsWith('Rate limited Rate limited Rate limited Rate limited')).toBe(true)
    expect(chip!.endsWith('…')).toBe(true)
    expect(chip!.length).toBeLessThanOrEqual(64)
  })

  it('resolves profiles, local rows and archive counts', () => {
    expect(toolResultPhrase('twitter_whoami', {}, { ok: true, data: { user: { username: 'naval' } } })).toBe('@naval')
    expect(toolResultPhrase('read_hooks', {}, [1, 2, 3])).toBe('3 hooks')
    expect(toolResultPhrase('read_targets', {}, [])).toBe('Empty')
    expect(
      toolResultPhrase('read_social_content', {}, { twitter: { post: 5, reply: 2 } })
    ).toBe('7 archived items')
  })

  it('reduces write counters into one phrase', () => {
    expect(toolResultPhrase('save_pillar', {}, { success: true, saved: 3, updated: 1, total: 4 })).toBe(
      'Saved 3 · Updated 1'
    )
    expect(toolResultPhrase('save_memory', {}, { success: true, saved: 2, skipped: 2, total: 4 })).toBe(
      'Saved 2 · Skipped 2'
    )
    expect(toolResultPhrase('delete_voice_rules', {}, { success: true, deleted: 2 })).toBe('Deleted 2')
    expect(toolResultPhrase('save_reply', {}, { success: true, count: 5 })).toBe('Saved 5')
  })

  it('maps social actions to past-tense verbs including undo variants', () => {
    expect(toolResultPhrase('twitter_post', {}, { ok: true, data: {} })).toBe('Posted')
    expect(toolResultPhrase('reddit_upvote', { action: 'downvote' }, { ok: true })).toBe('Downvoted')
    expect(toolResultPhrase('reddit_upvote', { action: 'undo' }, { ok: true })).toBe('Vote removed')
    expect(toolResultPhrase('twitter_bookmark', { action: 'remove' }, { ok: true })).toBe('Removed bookmark')
  })

  it('formats images, scheduling and interactive outcomes', () => {
    expect(toolResultPhrase('generate_image', {}, { success: true, filename: 'a.png' })).toBe('Image saved')
    expect(
      toolResultPhrase('inspect_image_url', {}, { mimeType: 'image/png', byteLength: 245760 })
    ).toBe('PNG · 240 KB')
    expect(
      toolResultPhrase('schedule_post', {}, { success: true, message: 'Post scheduled for 2026-06-23T09:00:00' })
    ).toBe('Scheduled Jun 23, 09:00')
    expect(toolResultPhrase('ask_user', {}, { answer: 'yes' })).toBe('Answered')
    expect(toolResultPhrase('ask_user', {}, { error: 'timed out', status: 'timeout' })).toBe('No answer')
    expect(toolResultPhrase('ask_user_questions', {}, { answers: [{}, {}] })).toBe('All 2 answered')
  })

  it('combines target and outcome in the completed chip when short', () => {
    const args = { query: 'hooks' }
    const result = { ok: true, data: [{ id: 1 }, { id: 2 }] }
    expect(toolCompletedChip('twitter_search', args, result)).toBe('hooks → 2 results')
  })

  it('shows the error text for failed calls', () => {
    expect(toolCompletedChip('reddit_read', {}, { ok: false, error: 'Not logged in' })).toBe('Not logged in')
  })

  it('classifies failures, treating interactive statuses as soft', () => {
    expect(isFailedResult({ ok: false, error: 'x' })).toBe(true)
    expect(isFailedResult({ success: false })).toBe(true)
    expect(isFailedResult({ error: 'cancelled', status: 'cancelled' })).toBe(false)
    expect(isFailedResult([{ row: 1 }])).toBe(false)
  })
})

describe('summarizeTrace', () => {
  it('returns only the thought phrase for reasoning-only traces', () => {
    const summary = summarizeTrace([{ type: 'reasoning' }, { type: 'reasoning' }])
    expect(summary.phrases).toEqual(['Thought 2 times'])
    expect(summary.failedCount).toBe(0)
  })

  it('lists distinct activities verbatim for small traces and dedupes repeats', () => {
    const summary = summarizeTrace([
      { type: 'reasoning' },
      { type: 'tool', toolName: 'twitter_search', args: { query: 'hooks' }, result: { ok: true, data: [{ id: 1 }] } },
      { type: 'tool', toolName: 'twitter_user_posts', args: { handle: 'naval' }, result: { ok: true, data: [{ id: 1 }] } },
      { type: 'tool', toolName: 'twitter_user_posts', args: { handle: 'naval' }, result: { ok: true, data: [{ id: 2 }] } },
      { type: 'tool', toolName: 'save_hook', args: { items: [1, 2, 3] }, result: { success: true, saved: 3, total: 3 } },
    ])
    expect(summary.phrases).toEqual([
      'Thought once',
      'Searched X for hooks',
      "Read @naval's posts",
      'Saved 3 hooks',
    ])
    expect(summary.failedCount).toBe(0)
  })

  it('rolls up complex work-groups into category totals', () => {
    const posts = (n: number) => ({ ok: true, data: Array.from({ length: n }, (_, i) => ({ id: i })) })
    const summary = summarizeTrace([
      { type: 'tool', toolName: 'twitter_search', args: { query: 'a' }, result: posts(10) },
      { type: 'tool', toolName: 'reddit_search', args: { subreddit: 'x' }, result: posts(12) },
      { type: 'tool', toolName: 'twitter_feed', result: posts(20) },
      { type: 'tool', toolName: 'twitter_post', args: { text: 'hi' }, result: { ok: true } },
      { type: 'tool', toolName: 'twitter_like', args: { tweet_id: '1' }, result: { ok: true } },
      { type: 'tool', toolName: 'read_hooks', result: [] },
      { type: 'tool', toolName: 'read_memory', result: [] },
      { type: 'tool', toolName: 'ask_user_questions', args: { questions: [{}, {}] }, result: { answers: [{}, {}] } },
    ])
    expect(summary.phrases[0]).toBe('Scanned 42 posts')
    expect(summary.phrases).toContain('Read strategy library')
    expect(summary.phrases).toContain('Engaged 2 times')
    expect(summary.phrases).toContain('Asked you 2 questions')
    expect(summary.phrases.some((p) => p.startsWith('Saved'))).toBe(false)
  })

  it('skips auth plumbing and counts failed calls separately', () => {
    const summary = summarizeTrace([
      { type: 'tool', toolName: 'twitter_whoami', result: { ok: true, data: {} } },
      { type: 'tool', toolName: 'twitter_search', args: { query: 'x' }, result: { ok: false, error: 'Rate limited' } },
    ])
    expect(summary.phrases).toEqual(['Searched X for x'])
    expect(summary.failedCount).toBe(1)
  })

  it('returns empty phrases for empty traces', () => {
    expect(summarizeTrace([]).phrases).toEqual([])
  })
})

describe('toolDetails', () => {
  it('lists prioritized args rows with humanized keys', () => {
    const rows = toolDetails('twitter_search', { limit: 10, query: 'ai agents', type: 'Latest' }, undefined)
    expect(rows.map((r) => r.label)).toEqual(['Query', 'Type', 'Limit'])
    expect(rows.map((r) => r.value)).toEqual(['ai agents', 'Latest', '10'])
  })

  it('truncates long free text and keeps filenames before prompts', () => {
    const longPrompt = 'x'.repeat(300)
    const rows = toolDetails('generate_image', { prompt: longPrompt, filename: 'hook.png' }, undefined)
    const promptRow = rows.find((r) => r.label === 'Prompt')!
    const fileRow = rows.find((r) => r.label === 'Filename')!
    expect(rows[0].label).toBe('Filename')
    expect(promptRow.value.endsWith('…')).toBe(true)
    expect(promptRow.value.length).toBeLessThanOrEqual(161)
    expect(fileRow.value).toBe('hook.png')
  })

  it('previews listing results one line per item', () => {
    const result = {
      ok: true,
      data: {
        data: [
          { text: 'first post', username: 'bob', likes: 1200, replies: 3 },
          { title: 'second', score: 42, num_comments: 7 },
        ],
      },
    }
    const rows = toolDetails('twitter_search', { query: 'q' }, result)
    expect(rows[0]).toEqual({ label: 'Query', value: 'q' })
    expect(rows[1].label).toBe('1')
    expect(rows[1].value).toBe('@bob · first post · ♥ 1.2k · ↩ 3')
    expect(rows[2].value).toBe('second · ♥ 42 · ↩ 7')
  })

  it('caps item rows and reports the overflow', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ text: `p${i}` }))
    const rows = toolDetails('twitter_feed', {}, { ok: true, data: { data: items } })
    const itemRows = rows.filter((r) => /^[0-9]$/.test(r.label))
    expect(itemRows).toHaveLength(6)
    expect(rows[rows.length - 1]).toEqual({ label: '+', value: '3 more' })
  })

  it('shows failures as a single error row', () => {
    const rows = toolDetails('twitter_like', { tweet_id: '123' }, { ok: false, error: 'Rate limited hard' })
    expect(rows[0]).toEqual({ label: 'Tweet Id', value: '123' })
    expect(rows[1]).toEqual({ label: 'Error', value: 'Rate limited hard', tone: 'error' })
    expect(rows).toHaveLength(2)
  })

  it('renders write receipts as counter rows', () => {
    const rows = toolDetails('save_hook', {}, { saved: 3, updated: 1, skipped: 2, message: 'ok' })
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual(['Saved: 3', 'Updated: 1', 'Skipped: 2', 'Message: ok'])
  })

  it('renders profile payloads with handle, name and reach', () => {
    const rows = toolDetails('twitter_user', { handle: 'naval' }, {
      ok: true,
      data: { username: 'naval', name: 'Naval Ravikant', description: 'Founder', followers: 2500000 },
    })
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Handle: @naval',
      'Profile: @naval',
      'Name: Naval Ravikant',
      'Bio: Founder',
      'Followers: 2.5M',
    ])
  })

  it('condenses string results and empty inputs', () => {
    const guide = toolDetails('read_image_guide', {}, 'a very long guide '.repeat(40))
    expect(guide).toHaveLength(1)
    expect(guide[0].label).toBe('Result')
    expect(guide[0].value.endsWith('…')).toBe(true)
    expect(toolDetails('twitter_whoami', {}, undefined)).toEqual([])
    expect(toolDetails('twitter_whoami', {}, { ok: true, data: {} })).toEqual([{ label: 'Result', value: 'Done' }])
  })

  it('surfaces generate_image receipts', () => {
    const rows = toolDetails('generate_image', { filename: 'a.png' }, {
      success: true,
      path: '/media/a.png',
      filename: 'a.png',
      backend: 'puter',
    })
    expect(rows).toEqual([
      { label: 'Filename', value: 'a.png' },
      { label: 'Saved to', value: '/media/a.png' },
      { label: 'Backend', value: 'puter' },
      { label: 'File', value: 'a.png' },
    ])
  })
})
