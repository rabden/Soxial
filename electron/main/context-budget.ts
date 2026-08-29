// electron/main/context-budget.ts — pure token accounting for context
// management (spec #53). Both reference implementations ship this exact
// estimator in production — grok-build counts bytes/4 with a flat image
// cost, opencode divides stringified requests by CHARS_PER_TOKEN=4 — so a
// dependency-free estimate is the house standard, and the provider-reported
// usage captured per response (agent.ts) is the ground truth that makes the
// estimate a fallback rather than the primary signal. Thresholds are
// percent-based so one policy spans 128k GLM windows and 1M Gemini windows.

/** Catalog windows come from models.ts; this module only does math on them. */
import type { ModelWindow } from './models'

export const CHARS_PER_TOKEN = 4
/** Flat per-image token cost — grok-build's estimator. */
export const IMAGE_TOKEN_ESTIMATE = 765
/** High-water mark: compact when estimated context crosses this share of the usable window. */
export const COMPACTION_THRESHOLD_RATIO = 0.85
/** Output headroom reserved so the model can still answer after compaction (opencode). */
export const OUTPUT_RESERVE_CAP = 20_000
/** Preserve-recent share of the usable window kept verbatim after compaction (opencode). */
export const TAIL_BUDGET_RATIO = 0.25
export const TAIL_BUDGET_MIN_TOKENS = 2_000
export const TAIL_BUDGET_MAX_TOKENS = 15_000

export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

/**
 * Estimate tokens for one AI SDK model message, tolerating unknown shapes —
 * custom endpoints and future part types must degrade to a rough count, never
 * throw. Per-message envelope overhead is folded into the constants.
 */
export function estimateMessageTokens(message: any): number {
  if (!message || typeof message !== 'object') return 0
  const content = (message as any).content
  if (typeof content === 'string') return estimateTokens(content) + 4
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (typeof part.text === 'string') total += estimateTokens(part.text)
    else if (part.type === 'file' || part.type === 'image') total += IMAGE_TOKEN_ESTIMATE
    else if (part.type === 'tool-call') total += estimateTokens(safeJson(part.input ?? {})) + 8
    else if (part.type === 'tool-result') total += estimateTokens(safeJson(part.output ?? part.result)) + 8
    else if (typeof part.content === 'string') total += estimateTokens(part.content)
  }
  return total + 4
}

export function estimateContextTokens(system: string, messages: readonly any[]): number {
  return estimateTokens(system) + messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

// ─── Window math ─────────────────────────────────────────────────────────────

export function usableWindowTokens(win: ModelWindow): number {
  return Math.max(0, win.contextWindow - Math.min(OUTPUT_RESERVE_CAP, win.maxOutputTokens))
}

export function compactionThresholdTokens(win: ModelWindow): number {
  return Math.floor(COMPACTION_THRESHOLD_RATIO * usableWindowTokens(win))
}

export function tailBudgetTokens(win: ModelWindow): number {
  const share = Math.round(TAIL_BUDGET_RATIO * usableWindowTokens(win))
  return Math.min(TAIL_BUDGET_MAX_TOKENS, Math.max(TAIL_BUDGET_MIN_TOKENS, share))
}
