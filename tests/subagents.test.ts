import { describe, expect, it } from 'vitest'
import {
  SUBAGENT_DEFINITIONS,
  SUBAGENT_KINDS,
} from '../electron/main/subagents'
import { createTools } from '../electron/main/tools'
import { MUTATING_CAPABILITIES, getToolCapability } from '../electron/main/tool-capabilities'

/**
 * Subagent definitions must stay bounded and read/write-scoped: they can
 * never publish, touch accounts, ask the user anything, or spawn further
 * subagents. Runtime behavior lives in orchestration.test.ts.
 */

const FORBIDDEN_CAPABILITIES = new Set([
  ...MUTATING_CAPABILITIES,
  'interactive',
  'orchestration',
])

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

  it('keeps every definition within a bounded step budget', () => {
    for (const [kind, definition] of Object.entries(SUBAGENT_DEFINITIONS)) {
      expect(definition.maxSteps, `${kind} step budget unbounded`).toBeGreaterThanOrEqual(1)
      expect(definition.maxSteps, `${kind} step budget excessive`).toBeLessThanOrEqual(16)
    }
  })
})
