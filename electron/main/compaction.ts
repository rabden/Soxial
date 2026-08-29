// electron/main/compaction.ts — the compaction engine (spec #53).
//
// Pure core: split history into a summarize-head and a verbatim tail,
// serialize the head for the summarizer, build the summary request, judge
// the summary, and assemble the compacted transcript. IO stays with the
// caller (agent.ts wires the summarizer model call and persistence), so this
// module imports nothing from the agent runtime and every decision here is
// unit-testable without Electron or network.
//
// Patterns ported from the two reference implementations studied in spec
// #53: opencode's preserve-recent tail + structured carry-forward summary +
// nothing-deleted storage, and grok-build's tool-pair snap-forward rule,
// overflow fit-ladder, degenerate-output rejection, and fail-open posture.

import { estimateMessageTokens } from './context-budget'
import { getModelWindow } from './models'
import { tailBudgetTokens } from './context-budget'
import { isContextLengthError } from './context-errors'
import { logger } from './log'

// ─── Carrier identity ────────────────────────────────────────────────────────
// The compacted transcript opens with a user-role carrier message holding the
// summary. It is identified by its tag markers — plain text survives
// steps_json persistence and every provider without special-casing.

export const COMPACTION_CARRIER_OPEN = '<compacted-history>'
export const COMPACTION_CARRIER_CLOSE = '</compacted-history>'

export function isCompactionCarrier(message: any): boolean {
  if (message?.role !== 'user') return false
  const content = message.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((p: any) => typeof p?.text === 'string').map((p: any) => p.text).join('\n')
      : ''
  return text.includes(COMPACTION_CARRIER_OPEN)
}

export function buildCarrierMessage(summary: string): any {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          COMPACTION_CARRIER_OPEN,
          'This session continues from an earlier conversation that was compacted to fit the context window. The summary inside this block is the authoritative record of everything before the messages that follow. Treat it as memory: build on it, and mention nothing about this block unless the user asks.',
          '',
          summary,
          COMPACTION_CARRIER_CLOSE,
        ].join('\n'),
      },
    ],
  }
}

// ─── History splitting ───────────────────────────────────────────────────────

export interface CompactionSplit {
  head: any[]
  tail: any[]
}

/**
 * Split model messages into the summarize-head and the verbatim tail.
 * Walks backward from the newest message spending the tail budget, then
 * applies grok-build's snap-forward rule: the tail must never open with
 * tool results — the boundary extends backward until it opens on a
 * non-tool message so assistant tool-calls and their results stay together.
 * When the whole history fits the budget the head is empty and
 * compactSessionHistory fails open — there is nothing to summarize.
 */
export function splitForCompaction(messages: readonly any[], tailBudgetTokens: number): CompactionSplit {
  if (messages.length === 0) return { head: [], tail: [] }
  let start = messages.length
  let spent = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i])
    if (i < messages.length - 1 && spent + cost > tailBudgetTokens) break
    spent += cost
    start = i
  }
  while (start > 0 && messages[start]?.role === 'tool') start--
  return { head: messages.slice(0, start), tail: messages.slice(start) }
}
// ─── Head serialization ──────────────────────────────────────────────────────

const TOOL_RESULT_MAX_CHARS = 2_000
const TOOL_ARGS_MAX_CHARS = 500
/** Lossy-ladder per-line cap when the summary request itself overflows. */
const LOSSY_LINE_MAX_CHARS = 500
const LOSSY_KEEP_LAST_LINES = 3

function truncateChars(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…[truncated]' : text
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function serializeMessage(msg: any): string {
  const role = msg?.role ?? 'unknown'
  if (typeof msg?.content === 'string') return `[${role}] ${msg.content}`
  if (!Array.isArray(msg?.content)) return `[${role}]`
  const out: string[] = []
  for (const part of msg.content) {
    if (!part || typeof part !== 'object') continue
    if (typeof part.text === 'string') out.push(part.text)
    else if (part.type === 'file' || part.type === 'image') out.push('[image attachment]')
    else if (part.type === 'tool-call') {
      out.push(`[${role} tool call: ${part.toolName || ''}(${truncateChars(safeJson(part.input ?? {}), TOOL_ARGS_MAX_CHARS)})]`)
    } else if (part.type === 'tool-result') {
      out.push(`[tool result${part.toolName ? ` for ${part.toolName}` : ''}] ${truncateChars(safeJson(part.output ?? part.result), TOOL_RESULT_MAX_CHARS)}`)
    } else if (typeof part.content === 'string') {
      out.push(part.content)
    }
  }
  return `[${role}] ${out.join('\n')}`
}

/**
 * Serialize the head for the summarizer. Text stays verbatim; tool results
 * are truncated per-part with a marker (opencode); images become
 * placeholders; a prior compaction's summary is folded into a
 * `<prior-summary>` block instead of re-serializing the old carrier.
 *
 * `maxChars` arms the lossy ladder: per-line truncation plus oldest-first
 * dropping (always keeping the last lines) until the serialization fits.
 */
export function serializeHeadForSummary(
  head: readonly any[],
  priorSummary: string | null | undefined,
  maxChars?: number,
): string {
  const blocks: string[] = []
  if (priorSummary && priorSummary.trim()) {
    blocks.push(
      `<prior-summary>\n${priorSummary.trim()}\n</prior-summary>\nEverything above is the previous compaction's summary — carry forward anything still relevant.`,
    )
  }
  const lines: string[] = []
  for (const msg of head) {
    if (isCompactionCarrier(msg)) continue
    if (msg?.role === 'system') continue
    lines.push(serializeMessage(msg))
  }

  if (maxChars == null) {
    blocks.push(lines.join('\n\n'))
    return blocks.join('\n\n')
  }

  const lossy = lines.map(line => truncateChars(line, LOSSY_LINE_MAX_CHARS))
  while (lossy.length > LOSSY_KEEP_LAST_LINES && lossy.join('\n\n').length > maxChars) {
    lossy.shift()
  }
  blocks.push(lossy.join('\n\n'))
  return blocks.join('\n\n')
}

// ─── Summary request ─────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT = `You compress the earlier portion of an ongoing agentic chat so the conversation can continue seamlessly in a smaller context window. Produce the summary in exactly this markdown structure:

## Objective
What the user is trying to accomplish, stated plainly.

## Important Details
Facts, constraints, decisions, and preferences established so far.

## Work State
### Completed
### Active
### Blocked

## Next Move
What should happen immediately after the summary.

## Relevant Files
File paths, commands, identifiers, and error strings, verbatim.

Rules:
- Preserve exact file paths, commands, code identifiers, error messages, URLs, and numbers verbatim.
- Carry forward anything still relevant from the prior summary inside <prior-summary>; when it conflicts with the conversation below, the conversation wins.
- Anything you omit is permanently lost — the raw history will not be seen again.
- Write for another AI assistant continuing the conversation, not for a human.
- Return only the summary.`

export function buildSummaryRequest(serializedHead: string): { system: string; user: string } {
  return {
    system: SUMMARY_SYSTEM_PROMPT,
    user: `Summarize the conversation history below.\n\n<conversation-to-summarize>\n${serializedHead}\n</conversation-to-summarize>`,
  }
}

// ─── Summary judgment ────────────────────────────────────────────────────────

/** grok-build parity: a summary this thin is a refusal or a glitch, not a summary. */
export const SUMMARY_MIN_CHARS = 500

export function isDegenerateSummary(text: string): boolean {
  return text.replace(/\s/g, '').length < SUMMARY_MIN_CHARS
}

// ─── End-to-end pass ─────────────────────────────────────────────────────────

export interface CompactionResult {
  summary: string
  /** Carrier message + verbatim tail — the caller persists this as the session transcript. */
  compactedMessages: any[]
  /** User messages kept raw inside the tail (for logging and anchoring). */
  tailUserCount: number
}

export interface CompactSessionParams {
  /** Live agent system prompt — excluded from the summary, re-added per run. */
  system: string
  modelMessages: any[]
  modelId: string
  priorSummary?: string | null
  /** Summarizer seam — the caller wires the model call (fallback-chain head). */
  summarize: (request: { system: string; user: string }) => Promise<string>
}

const SUMMARY_MAX_ATTEMPTS = 2

/**
 * Run one compaction pass. Returns null (fail open — the caller proceeds
 * uncompacted) when there is nothing to summarize, the summarizer fails, or
 * the summary is degenerate after one retry. When the summary request itself
 * overflows, the input degrades through the lossy ladder before giving up.
 */
export async function compactSessionHistory(params: CompactSessionParams): Promise<CompactionResult | null> {
  const window = getModelWindow(params.modelId)
  const budget = tailBudgetTokens(window)
  const { head, tail } = splitForCompaction(params.modelMessages, budget)
  if (head.length === 0) return null

  let serialized = serializeHeadForSummary(head, params.priorSummary)
  let lossy = false
  let summary: string | null = null

  for (let attempt = 0; attempt < SUMMARY_MAX_ATTEMPTS && !summary; attempt++) {
    try {
      const text = await params.summarize(buildSummaryRequest(serialized))
      if (!isDegenerateSummary(text)) {
        summary = text.trim()
      } else {
        logger.warn('compaction', `degenerate summary (attempt ${attempt + 1}/${SUMMARY_MAX_ATTEMPTS}, ${text.trim().length} chars)`)
      }
    } catch (e: any) {
      if (isContextLengthError(e) && !lossy) {
        // Fit ladder: the summary request overflowed — degrade the input and retry.
        lossy = true
        serialized = serializeHeadForSummary(head, params.priorSummary, 24_000)
        logger.warn('compaction', 'summary request overflowed — retrying with lossy serialization')
      } else {
        logger.error('compaction', `summarizer failed — failing open: ${e?.message || e}`)
        return null
      }
    }
  }

  if (!summary) {
    logger.warn('compaction', 'no usable summary after retry budget — failing open')
    return null
  }

  const compactedMessages = [buildCarrierMessage(summary), ...tail]
  return {
    summary,
    compactedMessages,
    tailUserCount: tail.filter(m => m?.role === 'user').length,
  }
}
