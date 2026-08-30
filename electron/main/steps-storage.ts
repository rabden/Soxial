// Persisted model-transcript hardening (spec #65, ticket #71).
//
// The stored transcript (chat_sessions.steps_json) gets a versioned
// envelope, capped tool-result sizes at persist time, and a fingerprint of
// the app-history user messages it covers — the real drift check that
// replaces the bare user-count comparison at reuse.

import { safeJson } from './context-budget'

export const STEPS_ENVELOPE_VERSION = 1

/** Stored tool results are capped: the biggest payloads (media base64, huge
 * fetches) were landing verbatim in steps_json and growing it without
 * bound. */
export const STORED_TOOL_RESULT_MAX_CHARS = 40_000

/** Encode steps for storage: versioned envelope, tool results capped.
 * Returns the JSON string to store. */
export function encodeStepsForStorage(steps: any[]): string {
  return JSON.stringify({ v: STEPS_ENVELOPE_VERSION, steps: truncateStoredToolResults(steps) })
}

/** Decode stored steps: the envelope, or legacy raw arrays from before the
 * envelope existed. */
export function decodeStepsFromStorage(raw: string | null | undefined): any[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed // legacy shape
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) return parsed.steps
    return null
  } catch {
    return null
  }
}

/** Cap oversized tool-result outputs. Returns a new array — the caller's
 * in-memory transcript (full fidelity) is never mutated. Oversize outputs
 * become an explicit stub: providers never see broken media, models see a
 * truncation note instead of silent data loss. */
export function truncateStoredToolResults(steps: any[]): any[] {
  return steps.map((msg) => {
    if (msg?.role !== 'tool' || !Array.isArray(msg.content)) return msg
    let changed = false
    const content = msg.content.map((part: any) => {
      if (part?.type !== 'tool-result') return part
      const serialized = safeJson(part.output)
      if (serialized.length <= STORED_TOOL_RESULT_MAX_CHARS) return part
      changed = true
      return {
        ...part,
        output: {
          storedTruncated: true,
          originalChars: serialized.length,
          preview: serialized.slice(0, 2_000),
        },
      }
    })
    return changed ? { ...msg, content } : msg
  })
}

/** Fingerprint of the app-history user messages a stored transcript covers —
 * the first `count` user messages. Length + head of each message: cheap,
 * stable, and sensitive to edits/deletions/reorders. */
export function userMessagesFingerprint(messages: { role: string; content: unknown }[], count: number): string {
  const users = messages.filter((m) => m.role === 'user').slice(0, Math.max(0, count))
  return users
    .map((m) => {
      const text = typeof m.content === 'string' ? m.content : safeJson(m.content)
      return `${text.length}:${text.slice(0, 64)}`
    })
    .join('|')
}
