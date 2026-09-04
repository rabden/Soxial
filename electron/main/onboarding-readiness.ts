// Deterministic completion check for an onboarding run.
//
// The database ships with seeded hooks, pillars, voice rules, and algorithm
// rules, so global row counts prove nothing. Readiness is measured from the
// CURRENT run's tool ledger: what this run actually wrote or personalised.
//
// No model calls, no I/O — pure, so it always agrees with itself.

import type { ConnectedPlatforms, OnboardingCheckpointV2, ToolLedgerEntry } from './onboarding-run'

export type ArtifactKind =
  | 'growth_strategy'
  | 'pillars'
  | 'voice_rules'
  | 'hooks'
  | 'audience_memory'
  | 'baseline_metrics'
  | 'platform_strategy'
  | 'final_summary'

export interface ReadinessCheck {
  artifact: ArtifactKind
  required: number
  actual: number
  satisfied: boolean
  /** Satisfied by an explicitly recorded gap rather than real content. */
  viaGap?: boolean
  detail: string
}

export interface OnboardingReadinessResult {
  ready: boolean
  checks: ReadinessCheck[]
  missing: ArtifactKind[]
  warnings: string[]
}

/** Artifacts a legitimate gap may excuse. Strategy itself can never be skipped. */
export const GAP_ELIGIBLE_ARTIFACTS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  'baseline_metrics',
  'audience_memory',
])

export const READINESS_REQUIREMENTS: Record<Exclude<ArtifactKind, 'platform_strategy' | 'final_summary' | 'growth_strategy'>, number> = {
  pillars: 3,
  voice_rules: 3,
  hooks: 5,
  audience_memory: 1,
  baseline_metrics: 1,
}

export interface RecordedGap {
  artifact: ArtifactKind
  reason: string
}

/**
 * Rebuild the run's recorded gaps from the persisted tool ledger, so a resumed
 * run keeps every gap excuse its previous attempt recorded.
 */
export function recordedGapsFromLedger(ledger: ToolLedgerEntry[]): RecordedGap[] {
  const gaps: RecordedGap[] = []
  for (const entry of ledger) {
    if (entry.name !== 'record_onboarding_gap' || entry.status !== 'succeeded') continue
    // Ledger summaries are persisted as JSON strings; accept both shapes.
    const args = (typeof entry.summary === 'string' ? safeParseSummary(entry.summary) : entry.summary) as
      | { artifact?: unknown; reason?: unknown }
      | undefined
    if (typeof args?.artifact === 'string' && typeof args?.reason === 'string') {
      gaps.push({ artifact: args.artifact as ArtifactKind, reason: args.reason })
    }
  }
  return gaps
}

function safeParseSummary(value: string): unknown {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export interface ReadinessInput {
  ledger: ToolLedgerEntry[]
  /** growth_strategy currently stored on the profile. */
  growthStrategy?: string | null
  connectedPlatforms: ConnectedPlatforms
  finalText: string
  gaps?: RecordedGap[]
}

/**
 * Map a completed save tool to the artifact it contributed. Uses the arguments
 * the model supplied (what it asserted) plus the tool result (what landed).
 */
export function artifactFromTool(name: string, args: any, result: any): { kind: ArtifactKind; count: number } | null {
  if (result?.error) return null

  const items = Array.isArray(args?.items) ? args.items : []
  // Prefer the tool's own accounting; fall back to the submitted item count.
  const reported = typeof result?.total === 'number'
    ? result.total
    : (typeof result?.saved === 'number' || typeof result?.updated === 'number')
      ? (result.saved ?? 0) + (result.updated ?? 0)
      : items.length

  switch (name) {
    case 'save_pillar':
      return { kind: 'pillars', count: reported }
    case 'save_voice_rule':
      return { kind: 'voice_rules', count: reported }
    case 'save_hook':
      return { kind: 'hooks', count: reported }
    case 'save_milestone':
      return { kind: 'baseline_metrics', count: typeof result?.count === 'number' ? result.count : reported }
    case 'save_memory': {
      // Only audience/positioning memory counts toward readiness.
      const relevant = items.filter((item: any) => {
        const type = String(item?.type ?? '').toLowerCase()
        const text = `${item?.title ?? ''} ${item?.content ?? ''}`.toLowerCase()
        return type === 'audience' || text.includes('position')
      })
      return relevant.length > 0 ? { kind: 'audience_memory', count: relevant.length } : null
    }
    case 'update_soxial_profile': {
      const strategy = args?.data?.growth_strategy
      if (typeof strategy === 'string' && strategy.trim().length > 0) {
        return { kind: 'growth_strategy', count: 1 }
      }
      return null
    }
    default:
      return null
  }
}

function countArtifact(ledger: ToolLedgerEntry[], kind: ArtifactKind): number {
  return ledger.reduce((total, entry) => {
    if (entry.status !== 'succeeded') return total
    if (entry.artifact?.kind !== kind) return total
    return total + (entry.artifact.count ?? 0)
  }, 0)
}

export function validateOnboardingReadiness(input: ReadinessInput): OnboardingReadinessResult {
  const { ledger, connectedPlatforms, finalText } = input
  const gaps = input.gaps ?? []
  const checks: ReadinessCheck[] = []
  const warnings: string[] = []

  const gapFor = (artifact: ArtifactKind) =>
    GAP_ELIGIBLE_ARTIFACTS.has(artifact) ? gaps.find(gap => gap.artifact === artifact) : undefined

  // 1. Growth strategy: written by this run AND present on the profile.
  const strategyWrites = countArtifact(ledger, 'growth_strategy')
  const storedStrategy = (input.growthStrategy ?? '').trim()
  const strategySatisfied = strategyWrites > 0 && storedStrategy.length > 0
  checks.push({
    artifact: 'growth_strategy',
    required: 1,
    actual: strategySatisfied ? 1 : 0,
    satisfied: strategySatisfied,
    detail: strategySatisfied
      ? 'Growth strategy saved by this run.'
      : strategyWrites === 0
        ? 'This run never wrote a growth strategy.'
        : 'Growth strategy was written but is not stored on the profile.',
  })

  // 2. Counted strategy artifacts.
  for (const [artifact, required] of Object.entries(READINESS_REQUIREMENTS) as [ArtifactKind, number][]) {
    const actual = countArtifact(ledger, artifact)
    const gap = actual >= required ? undefined : gapFor(artifact)
    const satisfied = actual >= required || Boolean(gap)
    checks.push({
      artifact,
      required,
      actual,
      satisfied,
      viaGap: Boolean(gap),
      detail: gap
        ? `Recorded gap: ${gap.reason}`
        : `${actual}/${required} saved by this run.`,
    })
    if (gap) warnings.push(`${artifact} was skipped: ${gap.reason}`)
  }

  // 3. Each connected platform must appear in the strategy document.
  const strategyText = storedStrategy.toLowerCase()
  const missingPlatforms: string[] = []
  if (connectedPlatforms.twitter && !/\b(x|twitter)\b/.test(strategyText)) missingPlatforms.push('X/Twitter')
  if (connectedPlatforms.reddit && !strategyText.includes('reddit')) missingPlatforms.push('Reddit')
  const anyPlatform = connectedPlatforms.twitter || connectedPlatforms.reddit
  checks.push({
    artifact: 'platform_strategy',
    required: anyPlatform ? 1 : 0,
    actual: anyPlatform && missingPlatforms.length === 0 ? 1 : 0,
    satisfied: !anyPlatform || missingPlatforms.length === 0,
    detail: missingPlatforms.length > 0
      ? `Strategy does not cover: ${missingPlatforms.join(', ')}.`
      : 'Connected platforms are covered.',
  })

  // 4. The user must actually receive a summary.
  const hasSummary = finalText.trim().length > 0
  checks.push({
    artifact: 'final_summary',
    required: 1,
    actual: hasSummary ? 1 : 0,
    satisfied: hasSummary,
    detail: hasSummary ? 'Summary produced.' : 'The run ended without a summary.',
  })

  const missing = checks.filter(check => !check.satisfied).map(check => check.artifact)
  return { ready: missing.length === 0, checks, missing, warnings }
}

export function readinessFromCheckpoint(
  checkpoint: Pick<OnboardingCheckpointV2, 'toolLedger' | 'connectedPlatforms'>,
  options: { growthStrategy?: string | null; finalText: string; gaps?: RecordedGap[] },
): OnboardingReadinessResult {
  return validateOnboardingReadiness({
    ledger: checkpoint.toolLedger,
    connectedPlatforms: checkpoint.connectedPlatforms,
    growthStrategy: options.growthStrategy,
    finalText: options.finalText,
    gaps: options.gaps,
  })
}

/** Human-readable list for the retry surface. */
export function describeMissingArtifacts(result: OnboardingReadinessResult): string {
  const labels: Record<ArtifactKind, string> = {
    growth_strategy: 'growth strategy',
    pillars: 'content pillars',
    voice_rules: 'voice rules',
    hooks: 'hooks',
    audience_memory: 'audience insight',
    baseline_metrics: 'baseline metrics',
    platform_strategy: 'platform strategy',
    final_summary: 'summary',
  }
  return result.missing.map(artifact => labels[artifact]).join(', ')
}
