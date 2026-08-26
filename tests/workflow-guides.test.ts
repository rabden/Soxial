import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

// Resolve reference files against the repo checkout, exactly like dev runtime.
vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
  },
}))

import {
  WORKFLOW_GUIDES,
  isKnownGuide,
  readImageGenerationGuide,
  readWorkflowGuide,
} from '../electron/main/reference-files'
import { createTools } from '../electron/main/tools'
import { getSystemPrompt } from '../electron/main/agent-system-prompt'

describe('workflow guide catalog', () => {
  it('ships a non-empty markdown file for every catalogued guide', () => {
    expect(WORKFLOW_GUIDES.length).toBeGreaterThanOrEqual(11)
    for (const guide of WORKFLOW_GUIDES) {
      const content = readWorkflowGuide(guide.name)
      expect(content.length, `${guide.name} is empty`).toBeGreaterThan(200)
      expect(content).toContain('# ')
    }
  })

  it('throws a safe error for unknown guides', () => {
    expect(isKnownGuide('post-crafting')).toBe(true)
    expect(isKnownGuide('make-me-viral')).toBe(false)
    expect(() => readWorkflowGuide('make-me-viral')).toThrow('Unknown workflow guide')
  })

  it('still ships the legacy image generation guide', () => {
    const content = readImageGenerationGuide()
    expect(content).toContain('#')
  })
})

describe('read_workflow_guide tool', () => {
  it('accepts exactly the catalogued guide names', () => {
    const tools = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, any>
    const tool = tools.read_workflow_guide
    expect(tool).toBeDefined()

    for (const guide of WORKFLOW_GUIDES) {
      expect(tool.parameters.safeParse({ guide: guide.name }).success).toBe(true)
    }
    expect(tool.parameters.safeParse({ guide: 'not-a-guide' }).success).toBe(false)
  })

  it('returns guide content through the tool execute path', async () => {
    const tools = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, any>
    const result = await tools.read_workflow_guide.execute({ guide: 'voice-guide' })
    expect(result.error).toBeUndefined()
    expect(result.guide).toBe('voice-guide')
    expect(result.content).toContain('Voice Guide')
  })

  it('returns an error envelope instead of throwing when a file goes missing', async () => {
    const tools = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, any>
    // Valid enum value with a missing backing file is impossible while the
    // repo checkout exists, so exercise the catch branch via an unknown name
    // smuggled past zod (defense in depth for direct callers).
    const result = await tools.read_workflow_guide.execute({ guide: 'ghost-guide' } as any)
    expect(result.error).toBeTruthy()
  })
})

describe('prompt routing consistency', () => {
  it('mentions every catalogued guide so none become unreachable orphans', () => {
    const prompt = getSystemPrompt({ twitter: true, reddit: true })
    for (const guide of WORKFLOW_GUIDES) {
      expect(prompt, `system prompt never routes to "${guide.name}"`).toContain(guide.name)
    }
  })

  it('keeps the calm stop-behavior contract in the prompt', () => {
    const prompt = getSystemPrompt()
    expect(prompt).toContain('STOP BEHAVIOR')
    expect(prompt).not.toContain('NEVER STOP AFTER ONE TASK')
    expect(prompt).not.toContain('AUTO-PREPARE THE NEXT TASK')
  })

  it('keeps platform tailoring asserted by existing tests', () => {
    expect(getSystemPrompt({ twitter: true, reddit: false })).toContain('adaptive social media manager for X/Twitter.')
    expect(getSystemPrompt({ twitter: true, reddit: true })).toContain('adaptive social media manager for X/Twitter and Reddit.')
  })

  it('documents delegation kinds that actually exist', () => {
    const prompt = getSystemPrompt()
    expect(prompt).toContain('researcher')
    expect(prompt).toContain('reply-crafter')
    expect(prompt).toContain('post-composer')
    expect(prompt).toContain('intel-updater')
  })
})

// Keep the resolver honest about packaged-layout fallbacks.
describe('reference resolution roots', () => {
  it('finds guides under <appPath>/references/workflows', () => {
    // Implicitly covered above; this assertion pins the layout so an
    // accidental move of references/workflows fails here, not at runtime.
    expect(() => join(process.cwd(), 'references', 'workflows', 'post-crafting.md')).not.toThrow()
    expect(readWorkflowGuide('engagement-session')).toContain('Engagement Session')
  })
})
