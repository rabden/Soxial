import { describe, expect, it } from 'vitest'
import type { PendingInteraction } from '../electron/main/onboarding-run'
import {
  appendAnsweredInteraction,
  createOnboardingCheckpoint,
  createOnboardingCheckpointV2,
  hasCompletedTool,
  migrateOnboardingCheckpoint,
  parseOnboardingCheckpointV2,
  recordToolCall,
  recordToolResult,
  redactForCheckpoint,
  scrubSecretKeys,
} from '../electron/main/onboarding-run'
import { parseResumeCheckpoint } from '../src/features/onboarding/onboarding-steps'

const QUESTIONS = [
  { id: 'q_goal', text: 'What do you want to be known for?', type: 'text' as const },
  { id: 'q_risk', text: 'Hot takes or careful help?', type: 'single' as const, options: ['Hot takes', 'Careful'] },
]

describe('checkpoint v1 migration', () => {
  it('upgrades a valid v1 checkpoint without losing the transcript', () => {
    const v1 = createOnboardingCheckpoint('onboarding_v1', [
      { role: 'user', content: 'gathered data' },
      { role: 'assistant', content: 'analysis' },
    ])
    v1.phase = 'interview'
    v1.lastCompletedTool = 'twitter_user_posts'

    const migrated = migrateOnboardingCheckpoint(v1)

    expect(migrated).not.toBeNull()
    expect(migrated!.version).toBe(2)
    expect(migrated!.runId).toBe('onboarding_v1')
    expect(migrated!.phase).toBe('interview')
    expect(migrated!.displayMessages).toHaveLength(2)
    expect(hasCompletedTool(migrated!, 'twitter_user_posts')).toBe(true)
  })

  it('passes a v2 checkpoint through unchanged', () => {
    const v2 = createOnboardingCheckpointV2('onboarding_v2', [{ role: 'user', content: 'hi' }])
    expect(migrateOnboardingCheckpoint(v2)).toEqual(v2)
  })

  it('rejects corrupt input so the caller can quarantine it', () => {
    expect(migrateOnboardingCheckpoint(null)).toBeNull()
    expect(migrateOnboardingCheckpoint({ version: 9 })).toBeNull()
    expect(migrateOnboardingCheckpoint({ version: 2, runId: 'x' })).toBeNull()
    expect(migrateOnboardingCheckpoint({
      ...createOnboardingCheckpointV2('run', []),
      displayMessages: [{ role: 'assistant', content: 42 }],
    })).toBeNull()
  })
})

describe('checkpoint v2 validation', () => {
  it('accepts a well-formed checkpoint', () => {
    const checkpoint = createOnboardingCheckpointV2('run_ok', [])
    expect(parseOnboardingCheckpointV2(checkpoint)).toEqual(checkpoint)
  })

  it('rejects a negative or missing revision', () => {
    const checkpoint = createOnboardingCheckpointV2('run_rev', [])
    expect(parseOnboardingCheckpointV2({ ...checkpoint, revision: -1 })).toBeNull()
    expect(parseOnboardingCheckpointV2({ ...checkpoint, revision: undefined })).toBeNull()
  })

  it('rejects a malformed pending questionnaire', () => {
    const checkpoint = createOnboardingCheckpointV2('run_pending', [])
    expect(parseOnboardingCheckpointV2({
      ...checkpoint,
      pendingInteraction: { kind: 'questions', requestId: 'b1', expiresAt: 'soon', questions: [{ id: '', text: '', type: 'nope' }] },
    })).toBeNull()
  })
})

describe('pending interview survives serialization', () => {
  it('round-trips the exact questions the user was shown', () => {
    const checkpoint = createOnboardingCheckpointV2('run_q', [])
    checkpoint.pendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_1',
      questions: QUESTIONS,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }

    const restored = parseOnboardingCheckpointV2(JSON.parse(JSON.stringify(checkpoint)))

    expect(restored?.pendingInteraction?.questions).toEqual(QUESTIONS)
    expect(restored?.pendingInteraction?.requestId).toBe('onb_batch_1')
  })

  it('round-trips submitted answers', () => {
    const checkpoint = createOnboardingCheckpointV2('run_a', [])
    checkpoint.pendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_2',
      questions: QUESTIONS,
      answers: [{ id: 'q_goal', answer: 'Developer tooling' }, { id: 'q_risk', answer: ['Careful'] }],
      expiresAt: new Date().toISOString(),
    }

    const restored = parseOnboardingCheckpointV2(JSON.parse(JSON.stringify(checkpoint)))
    expect(restored?.pendingInteraction?.answers).toEqual([
      { id: 'q_goal', answer: 'Developer tooling' },
      { id: 'q_risk', answer: ['Careful'] },
    ])
  })
})

describe('tool ledger', () => {
  it('does not duplicate a repeated call id', () => {
    const checkpoint = createOnboardingCheckpointV2('run_ledger', [])
    recordToolCall(checkpoint, { callId: 'c1', name: 'twitter_user_posts' })
    recordToolCall(checkpoint, { callId: 'c1', name: 'twitter_user_posts' })

    expect(checkpoint.toolLedger).toHaveLength(1)
    expect(checkpoint.toolLedger[0].status).toBe('calling')
  })

  it('completes an open call in place and marks it resumable', () => {
    const checkpoint = createOnboardingCheckpointV2('run_ledger2', [])
    recordToolCall(checkpoint, { callId: 'c1', name: 'reddit_user_posts' })
    recordToolResult(checkpoint, { callId: 'c1', name: 'reddit_user_posts', status: 'succeeded', artifact: { kind: 'social', count: 12 } })

    expect(checkpoint.toolLedger).toHaveLength(1)
    expect(checkpoint.toolLedger[0]).toMatchObject({ status: 'succeeded', artifact: { kind: 'social', count: 12 } })
    expect(hasCompletedTool(checkpoint, 'reddit_user_posts')).toBe(true)
  })

  it('does not treat a failed tool as completed work', () => {
    const checkpoint = createOnboardingCheckpointV2('run_ledger3', [])
    recordToolResult(checkpoint, { callId: 'c9', name: 'twitter_likes', status: 'failed', errorCode: 'CLI_FAILED' })
    expect(hasCompletedTool(checkpoint, 'twitter_likes')).toBe(false)
  })
})

describe('checkpoint redaction', () => {
  it('never persists secret-bearing fields', () => {
    const redacted = redactForCheckpoint({
      gemini_api_key: 'AIzaSECRET',
      zai_api_key: 'zhipu-SECRET',
      authorization: 'Bearer abc',
      cookie: 'session=1',
      nested: { access_token: 'NESTEDSECRETVALUE', safe: 'keep me' },
    })

    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain('AIzaSECRET')
    expect(serialized).not.toContain('zhipu-SECRET')
    expect(serialized).not.toContain('Bearer abc')
    expect(serialized).not.toContain('session=1')
    expect(serialized).not.toContain('NESTEDSECRETVALUE')
    expect(serialized).toContain('keep me')
  })

  it('bounds oversized payloads', () => {
    const redacted = redactForCheckpoint({ text: 'x'.repeat(5000), items: Array.from({ length: 200 }, (_, i) => i) })
    expect((redacted as any).text.length).toBeLessThanOrEqual(501)
    expect((redacted as any).items).toHaveLength(20)
  })

  it('keeps tool ledger summaries free of secrets', () => {
    const checkpoint = createOnboardingCheckpointV2('run_secret', [])
    recordToolResult(checkpoint, {
      callId: 'c1',
      name: 'read_profile',
      status: 'succeeded',
      summary: { gemini_api_key: 'AIzaLEAK', niche: 'devtools' },
    })

    expect(JSON.stringify(checkpoint)).not.toContain('AIzaLEAK')
  })
})

describe('renderer resume parsing', () => {
  it('reopens an unanswered questionnaire from a v2 checkpoint', () => {
    const checkpoint = createOnboardingCheckpointV2('onboarding_resume', [{ role: 'user', content: 'data' }])
    checkpoint.pendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_7',
      questions: QUESTIONS,
      expiresAt: new Date().toISOString(),
    }

    const resumed = parseResumeCheckpoint(JSON.stringify(checkpoint))

    expect(resumed?.runId).toBe('onboarding_resume')
    expect(resumed?.messages).toHaveLength(1)
    expect(resumed?.pendingQuestions).toEqual(QUESTIONS)
    expect(resumed?.pendingBatchId).toBe('onb_batch_7')
  })

  it('does not reopen a questionnaire that was already answered', () => {
    const checkpoint = createOnboardingCheckpointV2('onboarding_answered', [])
    checkpoint.pendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_8',
      questions: QUESTIONS,
      answers: [{ id: 'q_goal', answer: 'done' }],
      expiresAt: new Date().toISOString(),
    }

    expect(parseResumeCheckpoint(JSON.stringify(checkpoint))?.pendingQuestions).toBeUndefined()
  })

  it('still reads legacy v1 checkpoints', () => {
    const v1 = createOnboardingCheckpoint('onboarding_legacy', [{ role: 'user', content: 'hello' }])
    const resumed = parseResumeCheckpoint(JSON.stringify(v1))

    expect(resumed?.runId).toBe('onboarding_legacy')
    expect(resumed?.messages).toHaveLength(1)
    expect(resumed?.pendingQuestions).toBeUndefined()
  })

  it('rejects malformed json and unknown versions', () => {
    expect(parseResumeCheckpoint('not json')).toBeNull()
    expect(parseResumeCheckpoint(JSON.stringify({ version: 3, runId: 'x', messages: [] }))).toBeNull()
  })
})

// ─── Plan 6: model-message resume ────────────────────────────────────────────

describe('model-message resume preparation', () => {
  const call = (toolCallId = 'call_1') => ({
    role: 'assistant',
    content: [
      { type: 'text', text: 'I need a few answers.' },
      { type: 'tool-call', toolCallId, toolName: 'ask_user_questions' },
    ],
  })

  it('appends a tool-result carrying the persisted answers', () => {
    const pending: PendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_1',
      answers: [{ id: 'q_goal', answer: 'Growth' }],
      expiresAt: new Date().toISOString(),
    }

    const messages = appendAnsweredInteraction([{ role: 'user', content: 'hi' }, call()], pending)

    expect(messages).toHaveLength(3)
    const toolMessage = messages[2] as any
    expect(toolMessage.role).toBe('tool')
    expect(toolMessage.content[0].toolCallId).toBe('call_1')
    expect(toolMessage.content[0].output.answers).toEqual([{ id: 'q_goal', answer: 'Growth' }])
  })

  it('strips a dangling unanswered interview tool-call', () => {
    const messages = appendAnsweredInteraction([{ role: 'user', content: 'hi' }, call()], null)
    expect(messages).toHaveLength(1)
  })

  it('strips the call when the pending interaction has no answers yet', () => {
    const pending: PendingInteraction = {
      kind: 'questions',
      requestId: 'onb_batch_2',
      questions: QUESTIONS,
      expiresAt: new Date().toISOString(),
    }
    const messages = appendAnsweredInteraction([call()], pending)
    expect(messages).toHaveLength(0)
  })

  it('leaves messages untouched when the interaction already has its tool-result', () => {
    const answered = [
      { role: 'user', content: 'hi' },
      call(),
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'ask_user_questions', output: { answers: [] } }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Thanks.' }] },
    ]
    expect(appendAnsweredInteraction(answered, null)).toEqual(answered)
  })

  it('returns the messages unchanged when there is no tool-call at all', () => {
    const plain = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]
    expect(appendAnsweredInteraction(plain, null)).toEqual(plain)
    expect(appendAnsweredInteraction([], null)).toEqual([])
  })
})

describe('model-message secret scrubbing', () => {
  it('removes secret-bearing keys without truncating content', () => {
    const long = 'x'.repeat(900)
    const scrubbed = scrubSecretKeys([{ role: 'user', content: long, api_key: 'AIzaLEAK' }]) as any[]

    expect(JSON.stringify(scrubbed)).not.toContain('AIzaLEAK')
    expect((scrubbed[0] as any).content).toBe(long)
  })

  it('descends into nested objects and arrays', () => {
    const scrubbed = scrubSecretKeys({
      parts: [{ 'x-api-key': 'LEAK', text: 'keep' }],
    }) as any

    expect(JSON.stringify(scrubbed)).not.toContain('LEAK')
    expect(scrubbed.parts[0].text).toBe('keep')
  })
})
