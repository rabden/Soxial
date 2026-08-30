import { describe, expect, it, vi } from 'vitest'

/**
 * Persisted transcript hardening (spec #65, ticket #71): versioned envelope
 * around steps_json, capped tool-result sizes at persist time, and a
 * fingerprint of the covered user messages for the reuse-path drift check.
 */
import {
  STEPS_ENVELOPE_VERSION,
  STORED_TOOL_RESULT_MAX_CHARS,
  decodeStepsFromStorage,
  encodeStepsForStorage,
  truncateStoredToolResults,
  userMessagesFingerprint,
} from '../electron/main/steps-storage'

describe('steps envelope', () => {
  it('round-trips through the versioned envelope', () => {
    const steps = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]
    const decoded = decodeStepsFromStorage(encodeStepsForStorage(steps))
    expect(decoded).toEqual(steps)
    expect(JSON.parse(encodeStepsForStorage(steps)).v).toBe(STEPS_ENVELOPE_VERSION)
  })

  it('still loads legacy raw-array rows', () => {
    const legacy = JSON.stringify([{ role: 'user', content: 'q' }])
    expect(decodeStepsFromStorage(legacy)).toEqual([{ role: 'user', content: 'q' }])
  })

  it('returns null for corrupt or malformed storage', () => {
    expect(decodeStepsFromStorage('{not json')).toBeNull()
    expect(decodeStepsFromStorage(JSON.stringify({ nonsense: true }))).toBeNull()
    expect(decodeStepsFromStorage(null)).toBeNull()
  })
})

describe('stored tool-result caps', () => {
  it('truncates oversized outputs into a valid text stub', () => {
    const steps = [
      { role: 'user', content: 'q' },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'fetch_page', output: 'x'.repeat(STORED_TOOL_RESULT_MAX_CHARS + 10_000) },
        ],
      },
    ]
    const encoded = JSON.parse(encodeStepsForStorage(steps))
    const part = encoded.steps[1].content[0]
    expect(part.output.type).toBe('text')
    expect(part.output.value).toContain('Tool result truncated')
    expect(part.output.value.length).toBeLessThan(STORED_TOOL_RESULT_MAX_CHARS)
  })

  it('leaves small outputs untouched and never mutates the caller array', () => {
    const output = { status: 'success', text: 'small' }
    const steps = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 't', output }],
      },
    ]
    const snapshot = JSON.stringify(steps)
    truncateStoredToolResults(steps)
    expect(JSON.stringify(steps)).toBe(snapshot)
    expect(truncateStoredToolResults(steps)[0].content[0].output).toEqual(output)
  })

  it('caps media-sized base64 payloads too', () => {
    const steps = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c2', toolName: 'inspect_image_url', output: { data: 'A'.repeat(3_000_000) } }],
      },
    ]
    const encoded = JSON.parse(encodeStepsForStorage(steps))
    expect(encoded.steps[0].content[0].output.type).toBe('text')
    expect(encoded.steps[0].content[0].output.value).toContain('Tool result truncated')
  })

  it('repairs legacy invalid stubs on decode (session 4 regression)', () => {
    const legacyInvalid = JSON.stringify({
      v: 1,
      steps: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_abc',
              toolName: 'reddit_read',
              output: { storedTruncated: true, originalChars: 43124, preview: '{"type":"json"...' },
            },
          ],
        },
      ],
    })
    const decoded = decodeStepsFromStorage(legacyInvalid)
    expect(decoded).not.toBeNull()
    expect(decoded![0].content[0].output.type).toBe('text')
    expect(decoded![0].content[0].output.value).toContain('Tool result truncated')
  })
})

describe('user message fingerprint', () => {
  const history = [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
  ]

  it('is stable for the same messages', () => {
    expect(userMessagesFingerprint(history, 2)).toBe(userMessagesFingerprint([...history], 2))
  })

  it('covers only the first `count` user messages', () => {
    expect(userMessagesFingerprint(history, 1)).not.toBe(userMessagesFingerprint(history, 2))
    expect(userMessagesFingerprint(history, 99)).toBe(userMessagesFingerprint(history, 2))
  })

  it('changes when a covered message is edited and when messages are reordered', () => {
    const edited = [{ role: 'user', content: 'first question (edited)' }, { role: 'user', content: 'second question' }]
    const reordered = [{ role: 'user', content: 'second question' }, { role: 'user', content: 'first question' }]
    expect(userMessagesFingerprint(edited, 2)).not.toBe(userMessagesFingerprint(history, 2))
    expect(userMessagesFingerprint(reordered, 2)).not.toBe(userMessagesFingerprint(history, 2))
  })
})
