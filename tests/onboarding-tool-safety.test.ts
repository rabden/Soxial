import { describe, expect, it } from 'vitest'
import { createTools } from '../electron/main/tools'
import {
  ENRICHMENT_CAPABILITIES,
  MUTATING_CAPABILITIES,
  SAFE_CAPABILITIES,
  TOOL_CAPABILITIES,
  filterToolsByCapability,
  getToolCapability,
  isMutatingTool,
  listDeniedTools,
} from '../electron/main/tool-capabilities'

/**
 * Onboarding must be unable to publish, vote, follow, subscribe, schedule, or
 * delete. These tests assert the capability filter, not prompt wording, so the
 * guarantee survives a model that ignores its instructions.
 */

const MUTATING_TOOLS = [
  'twitter_post',
  'twitter_reply',
  'twitter_quote',
  'twitter_retweet',
  'twitter_delete',
  'twitter_like',
  'twitter_follow',
  'twitter_bookmark',
  'reddit_comment',
  'reddit_upvote',
  'reddit_save',
  'reddit_subscribe',
  'schedule_post',
]

const REQUIRED_STRATEGY_TOOLS = [
  'read_profile',
  'update_soxial_profile',
  'read_hooks',
  'save_hook',
  'read_voice_rules',
  'save_voice_rule',
  'read_pillars',
  'save_pillar',
  'read_targets',
  'save_target',
  'read_algorithm',
  'save_algorithm_rule',
  'read_memory',
  'save_memory',
  'save_milestone',
  'save_reply',
  'read_social_content',
  'inspect_image_url',
]

function onboardingToolset(platforms: { twitter: boolean; reddit: boolean }) {
  const base = createTools({ platforms }) as Record<string, unknown>
  return filterToolsByCapability(base, SAFE_CAPABILITIES)
}

describe('onboarding tool safety', () => {
  it('grants every strategy and research tool onboarding needs', () => {
    const tools = onboardingToolset({ twitter: true, reddit: true })
    for (const name of REQUIRED_STRATEGY_TOOLS) {
      expect(tools, `expected ${name} to be available during onboarding`).toHaveProperty(name)
    }
  })

  it('withholds every public and account-changing tool in dual-platform mode', () => {
    const tools = onboardingToolset({ twitter: true, reddit: true })
    for (const name of MUTATING_TOOLS) {
      expect(tools, `expected ${name} to be withheld from onboarding`).not.toHaveProperty(name)
    }
  })

  it('withholds mutating tools in X-only mode while keeping X research tools', () => {
    const tools = onboardingToolset({ twitter: true, reddit: false })

    expect(tools).toHaveProperty('twitter_user_posts')
    expect(tools).toHaveProperty('twitter_whoami')
    expect(tools).not.toHaveProperty('twitter_post')
    expect(tools).not.toHaveProperty('twitter_follow')
    expect(tools).not.toHaveProperty('schedule_post')
    // Reddit is out of scope entirely in X-only mode.
    expect(tools).not.toHaveProperty('reddit_search')
  })

  it('withholds mutating tools in Reddit-only mode while keeping Reddit research tools', () => {
    const tools = onboardingToolset({ twitter: false, reddit: true })

    expect(tools).toHaveProperty('reddit_user_posts')
    expect(tools).toHaveProperty('reddit_whoami')
    expect(tools).not.toHaveProperty('reddit_comment')
    expect(tools).not.toHaveProperty('reddit_subscribe')
    expect(tools).not.toHaveProperty('schedule_post')
    expect(tools).not.toHaveProperty('twitter_search')
  })

  it('classifies every tool the agent can build', () => {
    const base = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, unknown>
    const unclassified = Object.keys(base).filter(name => getToolCapability(name) === null)
    expect(unclassified, 'every tool must have an explicit capability').toEqual([])
  })

  it('denies unclassified tools by default so new tools cannot leak in', () => {
    const withUnknownTool = {
      read_profile: { description: 'safe' },
      publish_to_new_network: { description: 'a future action tool nobody classified' },
    }

    const filtered = filterToolsByCapability(withUnknownTool, SAFE_CAPABILITIES)

    expect(filtered).toHaveProperty('read_profile')
    expect(filtered).not.toHaveProperty('publish_to_new_network')
    expect(isMutatingTool('publish_to_new_network')).toBe(true)
    expect(listDeniedTools(withUnknownTool, SAFE_CAPABILITIES)).toEqual(['publish_to_new_network'])
  })

  it('keeps safe and mutating sets disjoint', () => {
    for (const capability of SAFE_CAPABILITIES) {
      expect(MUTATING_CAPABILITIES.has(capability)).toBe(false)
    }
  })

  it('classifies every capability as safe, mutating, or the chat-only orchestration class', () => {
    const everyCapability = new Set(Object.values(TOOL_CAPABILITIES))
    for (const capability of everyCapability) {
      const classified =
        SAFE_CAPABILITIES.has(capability)
        || MUTATING_CAPABILITIES.has(capability)
        // Orchestration is deliberately outside both restricted-partition sets;
        // its exclusions are asserted in their own test below.
        || capability === 'orchestration'
      expect(classified, `capability ${capability} must be classified`).toBe(true)
    }
  })

  it('classifies orchestration as chat-only: absent from every restricted set', () => {
    // Orchestration is a third class on purpose: subagent delegation must
    // never widen the onboarding or enrichment surface, even if someone later
    // moves the tool into the shared createTools() map.
    const everyCapability = new Set(Object.values(TOOL_CAPABILITIES))
    expect(everyCapability.has('orchestration')).toBe(true)

    for (const restricted of [SAFE_CAPABILITIES, ENRICHMENT_CAPABILITIES]) {
      expect(restricted.has('orchestration')).toBe(false)
    }

    const synthetic = {
      read_profile: { description: 'safe read' },
      run_subagent: { description: 'delegate to a specialist' },
    } as Record<string, unknown>

    expect(filterToolsByCapability(synthetic, SAFE_CAPABILITIES)).not.toHaveProperty('run_subagent')
    expect(filterToolsByCapability(synthetic, ENRICHMENT_CAPABILITIES)).not.toHaveProperty('run_subagent')
    expect(filterToolsByCapability(synthetic, SAFE_CAPABILITIES)).toHaveProperty('read_profile')
    // isMutatingTool reports public/account mutation only; orchestration is
    // withheld from restricted sets by the capability default-deny instead.
    expect(isMutatingTool('run_subagent')).toBe(false)
    expect(isMutatingTool('twitter_post')).toBe(true)
  })

  it('keeps guide loading available wherever reads are allowed', () => {
    const base = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, unknown>
    const onboardingSet = filterToolsByCapability(base, SAFE_CAPABILITIES)
    expect(onboardingSet).toHaveProperty('read_workflow_guide')
    expect(getToolCapability('read_workflow_guide')).toBe('read')
  })
})
