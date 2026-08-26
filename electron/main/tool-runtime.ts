// Tool-call runtime hardening, ported from the grok-build harness.
//
// Two guarantees, applied uniformly to every tool the model can call:
//
//  1. Bounded execution — a hung tool must never stall the whole agent run.
//     Each execute is raced against a per-capability wall-clock timeout; on
//     expiry the model receives a typed, self-explaining error result (the
//     grok-build `ToolError::Timeout` pattern) instead of the run hanging.
//  2. Bounded re-entry — a tool result is about to become part of the model
//     context. Oversized results are truncated head+tail with an explicit
//     marker so the model knows content was elided (grok-build
//     `TruncationConfig` / terminal head+tail truncation).
//
// Tools whose contract is already bounded are skipped: interactive tools wait
// on the user by design and orchestration tools manage their own timeouts.
import { getToolCapability, type ToolCapability } from './tool-capabilities'
import { logger } from './log'

type ToolExecute = (args: any, options?: any) => Promise<any>
type AnyTool = { description?: string; parameters?: any; execute: ToolExecute; [k: string]: any }
type ToolMap = Record<string, AnyTool>

/** Wall-clock budget per capability. Reads hit slow remote APIs, so they get more room than writes. */
const TOOL_TIMEOUT_MS_BY_CAPABILITY: Record<ToolCapability, number> = {
  read: 120_000,
  'strategy-write': 30_000,
  'local-draft': 300_000, // image generation is legitimately slow
  'public-action': 120_000,
  'account-action': 60_000,
  // Skipped entirely — see UNGOVERNED_CAPABILITIES.
  interactive: Number.POSITIVE_INFINITY,
  orchestration: Number.POSITIVE_INFINITY,
}

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

/** Capabilities that manage their own lifetime and are never wrapped. */
const UNGOVERNED_CAPABILITIES: ReadonlySet<ToolCapability> = new Set([
  'interactive',
  'orchestration',
])

/** Serialized-size ceiling for a tool result before it re-enters model context. */
export const TOOL_RESULT_MODEL_CHAR_LIMIT = 40_000

/** Head+tail split: how much of the budget each side keeps when truncating. */
function splitLimit(limit: number): { head: number; tail: number } {
  const head = Math.floor(limit * 0.7)
  return { head, tail: Math.max(0, limit - head) }
}

/**
 * Truncate a value's JSON serialization to `limit` chars, keeping head+tail.
 * Returns the original value when it fits. Pure.
 */
export function truncateForModel(value: unknown, limit = TOOL_RESULT_MODEL_CHAR_LIMIT): unknown {
  if (value == null) return value
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { _truncated: true, note: 'Result was not serializable and was replaced.' }
  }
  if (serialized.length <= limit) return value

  const { head, tail } = splitLimit(limit)
  const omitted = serialized.length - head - tail
  return {
    _truncated: true,
    _originalChars: serialized.length,
    content: `${serialized.slice(0, head)}...[ ${omitted} characters omitted ]...${serialized.slice(serialized.length - tail)}`,
  }
}

/** Typed timeout result handed back to the model — teaches rather than dead-ends. */
export function toolTimeoutResult(toolName: string, timeoutMs: number) {
  return {
    error: true,
    kind: 'timeout',
    toolName,
    elapsedMs: timeoutMs,
    message: `Tool "${toolName}" did not complete within ${Math.round(timeoutMs / 1000)}s and was stopped. Do not retry it unchanged; narrow the request or use a different approach.`,
  }
}

export interface HardenedToolRuntimeOptions {
  /** Overrides for tests. */
  timeoutMsByCapability?: Partial<Record<ToolCapability, number>>
  defaultTimeoutMs?: number
  resultCharLimit?: number
}

/**
 * Wrap every tool's execute with a timeout race + result budget.
 * Interactive/orchestration tools pass through untouched. Pure at the data
 * level: the input map is not mutated; wrappers are new closures.
 */
export function hardenTools<T extends ToolMap>(tools: T, options: HardenedToolRuntimeOptions = {}): T {
  const resultCharLimit = options.resultCharLimit ?? TOOL_RESULT_MODEL_CHAR_LIMIT
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const hardened: Record<string, AnyTool> = {}

  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool?.execute !== 'function') {
      hardened[name] = tool
      continue
    }
    const capability = getToolCapability(name)
    if (capability && UNGOVERNED_CAPABILITIES.has(capability)) {
      hardened[name] = tool
      continue
    }

    const timeoutMs =
      (capability && options.timeoutMsByCapability?.[capability]) ||
      (capability ? TOOL_TIMEOUT_MS_BY_CAPABILITY[capability] : undefined) ||
      defaultTimeoutMs

    const original = tool.execute.bind(tool)
    hardened[name] = {
      ...tool,
      execute: async (args: any, execOptions?: any) => {
        let timer: NodeJS.Timeout | undefined
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`__tool_timeout__:${name}:${timeoutMs}`)), timeoutMs)
            // Unref so a pending tool timer never keeps the process alive.
            timer?.unref?.()
          })
          const result = await Promise.race([
            Promise.resolve(original(args, execOptions)),
            timeoutPromise,
          ])
          return truncateForModel(result, resultCharLimit)
        } catch (e: any) {
          const msg = String(e?.message ?? e)
          if (msg.startsWith('__tool_timeout__:')) {
            logger.warn('agent', `tool ${name} timed out after ${timeoutMs}ms`)
            return toolTimeoutResult(name, timeoutMs)
          }
          throw e
        } finally {
          if (timer) clearTimeout(timer)
        }
      },
    }
  }

  return hardened as T
}
