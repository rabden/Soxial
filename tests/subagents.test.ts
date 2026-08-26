import { describe, expect, it, vi } from 'vitest'
import {
  SUBAGENT_DEFINITIONS,
  SUBAGENT_KINDS,
  SUBAGENT_MAX_OUTPUT_CHARS,
  executeSubagent,
} from '../electron/main/subagents'
import { createTools } from '../electron/main/tools'
import { MUTATING_CAPABILITIES, getToolCapability } from '../electron/main/tool-capabilities'

/**
 * Subagents must stay bounded and read/write-scoped: they can never publish,
 * touch accounts, ask the user anything, or spawn further subagents.
 */

const FORBIDDEN_CAPABILITIES = new Set([
  ...MUTATING_CAPABILITIES,
  'interactive',
  'orchestration',
])

const agentState = vi.hoisted(() => ({
  lastRequest: null as any,
  // Queue of outcomes for successive runAgent calls: { text } or { error }.
  queue: [] as Array<{ text?: string; error?: string }>,
}))

// Subagents must run nested WITHOUT a sessionId (chat step persistence stays
// with the parent) and WITH the definition's step budget.
vi.mock('../electron/main/agent', () => ({
  runAgent: (request: any) => {
    agentState.lastRequest = request
    const next = agentState.queue.shift() ?? {}
    return Promise.resolve().then(() => {
      if (next.error) request.onError(next.error)
      else request.onDone(next.text ?? '')
    })
  },
}))

function baseTools() {
  return createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, unknown>
}

describe('subagent registry', () => {
  it('defines the four specialists', () => {
    expect([...SUBAGENT_KINDS]).toEqual(['researcher', 'reply-crafter', 'post-composer', 'intel-updater'])
  })

  it('resolves every whitelisted tool name against the base tool map', () => {
    const base = baseTools()
    for (const [kind, definition] of Object.entries(SUBAGENT_DEFINITIONS)) {
      expect(definition.tools.length, `${kind} whitelist is empty`).toBeGreaterThan(0)
      for (const name of definition.tools) {
        expect(base, `${kind} whitelists unknown tool "${name}"`).toHaveProperty(name)
      }
    }
  })

  it('never grants mutating, interactive, or orchestration tools', () => {
    for (const [kind, definition] of Object.entries(SUBAGENT_DEFINITIONS)) {
      for (const name of definition.tools) {
        const capability = getToolCapability(name)
        expect(capability, `${kind} tool "${name}" has capability ${capability}`).not.toBeNull()
        expect(
          FORBIDDEN_CAPABILITIES.has(capability!),
          `${kind} must not include ${capability}-capability tool "${name}"`,
        ).toBe(false)
      }
      // Recursion guard: no subagent can run other subagents or ask questions.
      expect(definition.tools).not.toContain('run_subagent')
      expect(definition.tools).not.toContain('ask_user')
    }
  })

  it('grants intel-updater exactly the append-only strategy writes it needs', () => {
    const writes = SUBAGENT_DEFINITIONS['intel-updater'].tools.filter(name => getToolCapability(name) === 'strategy-write')
    expect([...writes].sort()).toEqual(['save_hook', 'save_memory', 'save_milestone'])
    // Everyone else is strictly read-only plus inspection.
    for (const kind of ['researcher', 'reply-crafter', 'post-composer'] as const) {
      const writeTools = SUBAGENT_DEFINITIONS[kind].tools.filter(name => getToolCapability(name) === 'strategy-write')
      expect(writeTools, `${kind} must not write strategy state`).toEqual([])
    }
  })
})

describe('executeSubagent', () => {
  it('rejects unknown kinds with a typed error before any work starts', async () => {
    const result = await executeSubagent({ kind: 'overlord' as never, task: 'do things' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown subagent kind')
    expect(agentState.lastRequest).toBeNull()
  })

  it('rejects empty tasks', async () => {
    const result = await executeSubagent({ kind: 'researcher', task: '   ' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('must not be empty')
  })

  it('returns a bounded envelope on success and runs nested without a sessionId', async () => {
    agentState.queue.push({ text: `x`.repeat(SUBAGENT_MAX_OUTPUT_CHARS + 500) })
    const result = await executeSubagent({ kind: 'researcher', task: 'scan r/webdev hot posts' })

    expect(agentState.lastRequest.sessionId).toBeUndefined()
    expect(agentState.lastRequest.options.maxSteps).toBe(SUBAGENT_DEFINITIONS.researcher.maxSteps)

    // The override map fails closed: only whitelisted names survive.
    const overrideNames = Object.keys(agentState.lastRequest.toolsOverride)
    for (const name of overrideNames) {
      expect(SUBAGENT_DEFINITIONS.researcher.tools).toContain(name)
      expect(FORBIDDEN_CAPABILITIES.has(getToolCapability(name)!)).toBe(false)
    }

    expect(result.ok).toBe(true)
    expect(result.kind).toBe('researcher')
    expect(result.summary.length).toBeLessThanOrEqual(SUBAGENT_MAX_OUTPUT_CHARS + '…[truncated]'.length)
    expect(result.summary.endsWith('[truncated]')).toBe(true)
  })

  it('propagates model failures as a typed error result', async () => {
    agentState.queue.push({ error: 'All available models failed' })
    const result = await executeSubagent({ kind: 'post-composer', task: 'draft variations' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('All available models failed')
  })
})
