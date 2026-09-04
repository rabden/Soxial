export type IdentityStage = 'name' | 'timezone' | 'niche' | 'superpower' | 'goal'

/**
 * Identity stages the user must answer. Everything else is inferred from their
 * social evidence, so it can be skipped rather than guessed at.
 */
export const REQUIRED_IDENTITY_STAGES: readonly IdentityStage[] = ['name', 'timezone', 'goal']

export function isRequiredIdentityStage(stage: IdentityStage): boolean {
  return REQUIRED_IDENTITY_STAGES.includes(stage)
}

export function hasContent(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * A single button carries both affordances: it reads "Skip" while an optional
 * field is empty and becomes "Continue" as soon as the user types something.
 */
export function getOptionalStepActionLabel(value: unknown): 'Skip' | 'Continue' {
  return hasContent(value) ? 'Continue' : 'Skip'
}

/** Required stages block progress while empty; optional stages never do. */
export function canAdvanceIdentityStage(stage: IdentityStage, value: unknown): boolean {
  if (!isRequiredIdentityStage(stage)) return true
  return hasContent(value)
}

export function getIdentityStageActionLabel(stage: IdentityStage, value: unknown): 'Skip' | 'Continue' {
  if (isRequiredIdentityStage(stage)) return 'Continue'
  return getOptionalStepActionLabel(value)
}

export interface ResumeQuestion {
  id: string
  text: string
  type: 'single' | 'multi' | 'text'
  options?: string[]
}

export interface ResumeCheckpoint {
  runId: string
  messages: any[]
  pendingQuestions?: ResumeQuestion[]
  pendingBatchId?: string
  /** Draft awaiting review: resume straight into the review surface. */
  pendingReview?: { draftRunId: string; expectedVersion?: number }
}

/**
 * Read a resumable checkpoint. Accepts the legacy V1 shape (transcript only)
 * and V2, which can also reopen the exact questionnaire the user was shown.
 */
export function parseResumeCheckpoint(checkpointJson: string): ResumeCheckpoint | null {
  try {
    const checkpoint = JSON.parse(checkpointJson)
    if (typeof checkpoint?.runId !== 'string') return null
    if (checkpoint.version !== 1 && checkpoint.version !== 2) return null

    const messages = checkpoint.version === 2 ? checkpoint.displayMessages : checkpoint.messages
    if (
      !Array.isArray(messages)
      || messages.some((message: any) => !message || typeof message.role !== 'string' || (typeof message.content !== 'string' && message.content !== null))
    ) return null

    const pending = checkpoint.version === 2 ? checkpoint.pendingInteraction : null
    const unanswered = pending?.kind === 'questions'
      && Array.isArray(pending.questions)
      && !pending.answers?.length

    return {
      runId: checkpoint.runId,
      messages,
      pendingQuestions: unanswered ? (pending.questions as ResumeQuestion[]) : undefined,
      pendingBatchId: unanswered ? pending.requestId : undefined,
      pendingReview: pending?.kind === 'review'
        ? { draftRunId: String(pending.draftRunId ?? checkpoint.runId), expectedVersion: typeof pending.expectedVersion === 'number' ? pending.expectedVersion : undefined }
        : undefined,
    }
  } catch {
    return null
  }
}

export const ACCOUNT_ANALYSIS_DISCLOSURE =
  'Soxial sends a compacted selection of account activity to your chosen AI provider to build your strategy. API keys and browser credentials are never included.'
