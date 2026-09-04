import { describe, expect, it } from 'vitest'
import {
  REPAIR_MAX_STEPS,
  buildRepairPrompt,
  repairToolNames,
  selectRepairTools,
} from '../electron/main/onboarding-repair'
import { validateOnboardingReadiness } from '../electron/main/onboarding-readiness'
import { createOnboardingTools } from '../electron/main/agent'

function readinessMissing(missing: string[]) {
  return validateOnboardingReadiness({
    ledger: [],
    growthStrategy: null,
    connectedPlatforms: { twitter: true, reddit: false },
    finalText: 'summary',
  })
    // Narrow to the artifacts under test so each case is explicit.
    && {
      ready: false,
      missing: missing as any,
      warnings: [],
      checks: missing.map(artifact => ({
        artifact: artifact as any,
        required: 1,
        actual: 0,
        satisfied: false,
        detail: `${artifact} missing`,
      })),
    }
}

describe('repair tool scoping', () => {
  it('includes the save tool for each missing artifact', () => {
    expect(repairToolNames(['hooks'])).toContain('save_hook')
    expect(repairToolNames(['pillars'])).toContain('save_pillar')
    expect(repairToolNames(['voice_rules'])).toContain('save_voice_rule')
    expect(repairToolNames(['audience_memory'])).toContain('save_memory')
    expect(repairToolNames(['baseline_metrics'])).toContain('save_milestone')
    expect(repairToolNames(['growth_strategy'])).toContain('update_soxial_profile')
  })

  it('does not hand over save tools for artifacts that are already fine', () => {
    const names = repairToolNames(['hooks'])
    expect(names).not.toContain('save_pillar')
    expect(names).not.toContain('save_milestone')
    expect(names).not.toContain('update_soxial_profile')
  })

  it('allows recording a gap when metrics are missing', () => {
    expect(repairToolNames(['baseline_metrics'])).toContain('record_onboarding_gap')
  })
})

describe('repair cannot re-interview, re-gather, or act publicly', () => {
  const onboardingTools = createOnboardingTools(() => {}, { twitter: true, reddit: true }) as Record<string, unknown>

  it('never includes the interview tool', () => {
    const tools = selectRepairTools(onboardingTools, ['hooks', 'pillars', 'growth_strategy'])
    expect(tools).not.toHaveProperty('ask_user_questions')
  })

  it('never includes gathering, auth, or connector tools', () => {
    const tools = selectRepairTools(onboardingTools, ['growth_strategy', 'baseline_metrics'])
    for (const name of ['twitter_status', 'reddit_login', 'twitter_user_posts', 'reddit_feed', 'twitter_followers']) {
      expect(tools, name).not.toHaveProperty(name)
    }
  })

  it('never includes public or account actions', () => {
    const tools = selectRepairTools(onboardingTools, ['growth_strategy', 'hooks', 'pillars', 'voice_rules', 'audience_memory', 'baseline_metrics'])
    for (const name of ['twitter_post', 'twitter_reply', 'reddit_comment', 'schedule_post', 'twitter_follow']) {
      expect(tools, name).not.toHaveProperty(name)
    }
  })

  it('selects a small, targeted toolset', () => {
    const tools = selectRepairTools(onboardingTools, ['hooks'])
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['save_hook', 'read_hooks', 'read_profile']))
    expect(Object.keys(tools).length).toBeLessThanOrEqual(6)
  })

  it('returns nothing to run when only the summary is missing', () => {
    // final_summary has no save tool; base read tools alone cannot fix it.
    expect(repairToolNames(['final_summary']).some(name => name.startsWith('save_'))).toBe(false)
  })

  it('keeps the step budget bounded', () => {
    expect(REPAIR_MAX_STEPS).toBeLessThanOrEqual(10)
  })
})

describe('repair prompt', () => {
  it('names exactly what is missing and forbids re-gathering', () => {
    const prompt = buildRepairPrompt(readinessMissing(['hooks', 'baseline_metrics']) as any, {
      connectedPlatforms: { twitter: true, reddit: false },
    })

    expect(prompt).toContain('save_hook')
    expect(prompt).toContain('save_milestone')
    expect(prompt).toContain('Do not re-gather social data and do not ask the user anything')
    expect(prompt).toContain('Never invent metrics')
    expect(prompt).toContain('X/Twitter')
  })

  it('does not instruct work for artifacts that already passed', () => {
    const prompt = buildRepairPrompt(readinessMissing(['hooks']) as any, {
      connectedPlatforms: { twitter: false, reddit: true },
    })

    expect(prompt).toContain('save_hook')
    expect(prompt).not.toContain('save_pillar')
    expect(prompt).toContain('Reddit')
  })
})
