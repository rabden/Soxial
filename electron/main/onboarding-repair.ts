// One bounded repair pass for a run that produced a summary but not the
// artifacts behind it.
//
// Repair never re-gathers social data and never re-interviews the user. It is
// given only the tools needed for the missing artifacts and a small step
// budget, so a partially compliant model cannot turn into an endless loop.

import type { ArtifactKind, OnboardingReadinessResult } from './onboarding-readiness'
import type { ConnectedPlatforms } from './onboarding-run'

export const REPAIR_MAX_STEPS = 10

/** Read tools every repair pass may use for context. */
const REPAIR_BASE_TOOLS = ['read_profile', 'read_memory', 'read_social_content']

const REPAIR_TOOLS_BY_ARTIFACT: Record<ArtifactKind, string[]> = {
  growth_strategy: ['update_soxial_profile', 'read_pillars', 'read_targets', 'read_voice_rules'],
  pillars: ['save_pillar', 'read_pillars'],
  voice_rules: ['save_voice_rule', 'read_voice_rules'],
  hooks: ['save_hook', 'read_hooks'],
  audience_memory: ['save_memory'],
  baseline_metrics: ['save_milestone', 'record_onboarding_gap'],
  platform_strategy: ['update_soxial_profile', 'read_targets'],
  final_summary: [],
}

/**
 * Tool names a repair pass may use. Deliberately excludes ask_user_questions,
 * every public/account action, and connector/auth tools.
 */
export function repairToolNames(missing: ArtifactKind[]): string[] {
  const names = new Set<string>(REPAIR_BASE_TOOLS)
  for (const artifact of missing) {
    for (const tool of REPAIR_TOOLS_BY_ARTIFACT[artifact] ?? []) names.add(tool)
  }
  return [...names]
}

export function selectRepairTools<T extends Record<string, unknown>>(
  tools: T,
  missing: ArtifactKind[],
): Partial<T> {
  const allowed = new Set(repairToolNames(missing))
  const selected: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    // ask_user_questions is never repairable: the interview happens once.
    if (name === 'ask_user_questions') continue
    if (!allowed.has(name)) continue
    selected[name] = tool
  }
  return selected as Partial<T>
}

const ARTIFACT_INSTRUCTIONS: Record<ArtifactKind, string> = {
  growth_strategy: 'Write and save growth_strategy via update_soxial_profile. Cover positioning, audience, platform plans, content pillars, engagement, voice, cadence, and success metrics.',
  pillars: 'Save at least 3 content pillars via save_pillar, tied to the user\'s positioning.',
  voice_rules: 'Save at least 3 evidence-based voice rules via save_voice_rule.',
  hooks: 'Save at least 5 hooks via save_hook, adapted to the user\'s niche.',
  audience_memory: 'Save at least 1 audience or positioning entry via save_memory (type "audience").',
  baseline_metrics: 'Save at least 1 baseline metric via save_milestone. If the account genuinely exposes no metrics, call record_onboarding_gap instead of inventing numbers.',
  platform_strategy: 'Update growth_strategy so it explicitly covers every connected platform.',
  final_summary: 'Produce a short summary of the strategy for the user.',
}

export function buildRepairPrompt(
  readiness: OnboardingReadinessResult,
  context: { connectedPlatforms: ConnectedPlatforms },
): string {
  const platforms = [
    context.connectedPlatforms.twitter ? 'X/Twitter' : null,
    context.connectedPlatforms.reddit ? 'Reddit' : null,
  ].filter(Boolean).join(' and ') || 'no connected platform'

  const instructions = readiness.missing
    .map((artifact, index) => `${index + 1}. ${ARTIFACT_INSTRUCTIONS[artifact]}`)
    .join('\n')

  const detail = readiness.checks
    .filter(check => !check.satisfied)
    .map(check => `- ${check.artifact}: ${check.detail}`)
    .join('\n')

  return [
    'Your previous onboarding pass finished without saving everything the app requires.',
    `Connected platforms: ${platforms}.`,
    '',
    'Missing or incomplete:',
    detail,
    '',
    'Complete ONLY the following, using the tools provided:',
    instructions,
    '',
    'Rules:',
    '- Do not re-gather social data and do not ask the user anything; work from what is already saved.',
    '- Reuse the evidence and decisions already in the conversation.',
    '- Save in bulk: one call per tool with all items.',
    '- Never invent metrics or engagement numbers.',
    '- Finish with a short summary of the strategy for the user.',
  ].join('\n')
}
