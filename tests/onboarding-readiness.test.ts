import { describe, expect, it } from 'vitest'
import {
  artifactFromTool,
  describeMissingArtifacts,
  recordedGapsFromLedger,
  validateOnboardingReadiness,
  type ReadinessInput,
} from '../electron/main/onboarding-readiness'
import type { ToolLedgerEntry } from '../electron/main/onboarding-run'

function entry(name: string, kind: string, count: number, status: ToolLedgerEntry['status'] = 'succeeded'): ToolLedgerEntry {
  return {
    callId: `${name}-${Math.random()}`,
    name,
    status,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    artifact: { kind, count },
  }
}

const STRATEGY = 'Positioning for X/Twitter and Reddit growth with weekly cadence.'

function completeRun(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    ledger: [
      entry('update_soxial_profile', 'growth_strategy', 1),
      entry('save_pillar', 'pillars', 4),
      entry('save_voice_rule', 'voice_rules', 3),
      entry('save_hook', 'hooks', 8),
      entry('save_memory', 'audience_memory', 2),
      entry('save_milestone', 'baseline_metrics', 3),
    ],
    growthStrategy: STRATEGY,
    connectedPlatforms: { twitter: true, reddit: true },
    finalText: 'Your setup is complete.',
    ...overrides,
  }
}

describe('current-run attribution', () => {
  it('does not count seeded defaults, only what this run wrote', () => {
    // An empty ledger means the run wrote nothing, even though the database
    // ships with seeded hooks, pillars, and voice rules.
    const result = validateOnboardingReadiness({
      ledger: [],
      growthStrategy: STRATEGY,
      connectedPlatforms: { twitter: true, reddit: false },
      finalText: 'All done!',
    })

    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(
      expect.arrayContaining(['growth_strategy', 'pillars', 'voice_rules', 'hooks', 'audience_memory', 'baseline_metrics']),
    )
  })

  it('counts personalised updates to seeded rows', () => {
    // save_hook upserts: `updated` rows are still this run's work.
    const artifact = artifactFromTool('save_hook', { items: new Array(8) }, { success: true, saved: 2, updated: 6, total: 8 })
    expect(artifact).toEqual({ kind: 'hooks', count: 8 })
  })

  it('ignores failed tool calls', () => {
    expect(artifactFromTool('save_pillar', { items: [{}, {}] }, { error: 'db locked' })).toBeNull()

    const result = validateOnboardingReadiness(completeRun({
      ledger: [
        entry('update_soxial_profile', 'growth_strategy', 1),
        entry('save_pillar', 'pillars', 4, 'failed'),
        entry('save_voice_rule', 'voice_rules', 3),
        entry('save_hook', 'hooks', 8),
        entry('save_memory', 'audience_memory', 1),
        entry('save_milestone', 'baseline_metrics', 1),
      ],
    }))
    expect(result.missing).toContain('pillars')
  })

  it('only counts audience or positioning memory', () => {
    const audience = artifactFromTool('save_memory', { items: [{ type: 'audience', title: 'Who they serve' }] }, { success: true })
    expect(audience).toEqual({ kind: 'audience_memory', count: 1 })

    const positioning = artifactFromTool('save_memory', { items: [{ type: 'lesson', title: 'Positioning angle', content: '' }] }, { success: true })
    expect(positioning).toEqual({ kind: 'audience_memory', count: 1 })

    expect(artifactFromTool('save_memory', { items: [{ type: 'performance', title: 'Likes' }] }, { success: true })).toBeNull()
  })

  it('counts growth strategy only when the profile field is written', () => {
    expect(artifactFromTool('update_soxial_profile', { data: { niche: 'devtools' } }, { success: true })).toBeNull()
    expect(artifactFromTool('update_soxial_profile', { data: { growth_strategy: 'Full plan' } }, { success: true }))
      .toEqual({ kind: 'growth_strategy', count: 1 })
  })
})

describe('completion contract', () => {
  it('passes a fully built run', () => {
    const result = validateOnboardingReadiness(completeRun())
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('blocks completion when the growth strategy is missing', () => {
    const result = validateOnboardingReadiness(completeRun({ growthStrategy: '   ' }))
    expect(result.ready).toBe(false)
    expect(result.missing).toContain('growth_strategy')
  })

  it('blocks completion when the run produced no summary', () => {
    const result = validateOnboardingReadiness(completeRun({ finalText: '   ' }))
    expect(result.ready).toBe(false)
    expect(result.missing).toContain('final_summary')
  })

  it('enforces the minimum counts', () => {
    const result = validateOnboardingReadiness(completeRun({
      ledger: [
        entry('update_soxial_profile', 'growth_strategy', 1),
        entry('save_pillar', 'pillars', 2),
        entry('save_voice_rule', 'voice_rules', 1),
        entry('save_hook', 'hooks', 4),
        entry('save_memory', 'audience_memory', 1),
        entry('save_milestone', 'baseline_metrics', 1),
      ],
    }))

    expect(result.missing).toEqual(expect.arrayContaining(['pillars', 'voice_rules', 'hooks']))
  })

  it('sums multiple calls toward one requirement', () => {
    const result = validateOnboardingReadiness(completeRun({
      ledger: [
        entry('update_soxial_profile', 'growth_strategy', 1),
        entry('save_pillar', 'pillars', 2),
        entry('save_pillar', 'pillars', 2),
        entry('save_voice_rule', 'voice_rules', 3),
        entry('save_hook', 'hooks', 5),
        entry('save_memory', 'audience_memory', 1),
        entry('save_milestone', 'baseline_metrics', 1),
      ],
    }))
    expect(result.ready).toBe(true)
  })
})

describe('legitimate gaps', () => {
  it('accepts a recorded gap for unavailable baseline metrics', () => {
    const result = validateOnboardingReadiness(completeRun({
      ledger: [
        entry('update_soxial_profile', 'growth_strategy', 1),
        entry('save_pillar', 'pillars', 3),
        entry('save_voice_rule', 'voice_rules', 3),
        entry('save_hook', 'hooks', 5),
        entry('save_memory', 'audience_memory', 1),
      ],
      gaps: [{ artifact: 'baseline_metrics', reason: 'Account exposes no public metrics' }],
    }))

    expect(result.ready).toBe(true)
    expect(result.warnings[0]).toContain('Account exposes no public metrics')
    expect(result.checks.find(c => c.artifact === 'baseline_metrics')?.viaGap).toBe(true)
  })

  it('never lets a gap excuse the growth strategy', () => {
    const result = validateOnboardingReadiness(completeRun({
      growthStrategy: null,
      gaps: [{ artifact: 'growth_strategy', reason: 'too hard' }],
    }))
    expect(result.ready).toBe(false)
    expect(result.missing).toContain('growth_strategy')
  })
})

describe('platform coverage', () => {
  it('requires the strategy to cover a connected X account', () => {
    const result = validateOnboardingReadiness(completeRun({
      connectedPlatforms: { twitter: true, reddit: false },
      growthStrategy: 'A Reddit-only plan with no other platform.',
    }))
    expect(result.missing).toContain('platform_strategy')
  })

  it('passes an X-only run whose strategy covers X', () => {
    const result = validateOnboardingReadiness(completeRun({
      connectedPlatforms: { twitter: true, reddit: false },
      growthStrategy: 'Weekly X/Twitter posting plan for developer tooling.',
    }))
    expect(result.ready).toBe(true)
  })

  it('passes a Reddit-only run whose strategy covers Reddit', () => {
    const result = validateOnboardingReadiness(completeRun({
      connectedPlatforms: { twitter: false, reddit: true },
      growthStrategy: 'Reddit community plan for r/devtools.',
    }))
    expect(result.ready).toBe(true)
  })

  it('does not require platform coverage when nothing is connected', () => {
    const result = validateOnboardingReadiness(completeRun({
      connectedPlatforms: { twitter: false, reddit: false },
      growthStrategy: 'A general plan.',
    }))
    expect(result.ready).toBe(true)
  })
})

describe('determinism and reporting', () => {
  it('produces the same result for the same input', () => {
    const input = completeRun({ growthStrategy: null })
    expect(validateOnboardingReadiness(input)).toEqual(validateOnboardingReadiness(input))
  })

  it('describes what is missing in plain language', () => {
    const result = validateOnboardingReadiness(completeRun({ growthStrategy: '', finalText: '' }))
    const described = describeMissingArtifacts(result)
    expect(described).toContain('growth strategy')
    expect(described).toContain('summary')
  })
})

// ─── Recorded-gap recovery (resume support) ─────────────────────────────────

describe('recordedGapsFromLedger', () => {
  const gapEntry = (summary: unknown, status: ToolLedgerEntry['status'] = 'succeeded'): ToolLedgerEntry => ({
    callId: `gap-${Math.random()}`,
    name: 'record_onboarding_gap',
    status,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary,
  })

  it('reads gaps from the JSON-string summaries the ledger persists', () => {
    const ledger = [gapEntry(JSON.stringify({ artifact: 'hooks', reason: 'user declined tracking' }))]
    expect(recordedGapsFromLedger(ledger)).toEqual([
      { artifact: 'hooks', reason: 'user declined tracking' },
    ])
  })

  it('reads gaps when the summary is still a plain object', () => {
    const ledger = [gapEntry({ artifact: 'baseline_metrics', reason: 'no analytics access' })]
    expect(recordedGapsFromLedger(ledger)).toEqual([
      { artifact: 'baseline_metrics', reason: 'no analytics access' },
    ])
  })

  it('ignores failed calls, other tools, and malformed summaries', () => {
    const ledger = [
      gapEntry(JSON.stringify({ artifact: 'hooks', reason: 'nope' }), 'failed'),
      entry('save_hook', 'hooks', 3),
      gapEntry('not json'),
      gapEntry(JSON.stringify({ artifact: 7, reason: 'bad shape' })),
    ]
    expect(recordedGapsFromLedger(ledger)).toEqual([])
  })
})
