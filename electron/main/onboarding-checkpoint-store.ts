// Owns checkpoint mutation + persistence for one onboarding run.
//
// Every write bumps the revision, so a stale writer loses the race instead of
// overwriting newer state. Callers mutate through `update()` and never persist
// the checkpoint themselves.

import { saveOnboardingCheckpointAtRevision } from './db'
import { ConnectedPlatforms, OnboardingCheckpointV2,
  createOnboardingCheckpointV2,
  recordToolCall,
  recordToolResult,
  scrubSecretKeys, } from './onboarding-run'
import { logger } from './log'

export class OnboardingCheckpointStore {
  private checkpoint: OnboardingCheckpointV2

  private constructor(checkpoint: OnboardingCheckpointV2) {
    this.checkpoint = checkpoint
  }

  static create(runId: string, displayMessages: OnboardingCheckpointV2['displayMessages'] = []): OnboardingCheckpointStore {
    return new OnboardingCheckpointStore(createOnboardingCheckpointV2(runId, displayMessages))
  }

  static fromExisting(checkpoint: OnboardingCheckpointV2): OnboardingCheckpointStore {
    return new OnboardingCheckpointStore(checkpoint)
  }

  get current(): Readonly<OnboardingCheckpointV2> {
    return this.checkpoint
  }

  get runId(): string {
    return this.checkpoint.runId
  }

  get revision(): number {
    return this.checkpoint.revision
  }

  /** Mutate and persist atomically. Returns false when a newer revision won. */
  update(mutate: (checkpoint: OnboardingCheckpointV2) => void): boolean {
    mutate(this.checkpoint)
    this.checkpoint.revision += 1
    this.checkpoint.updatedAt = new Date().toISOString()

    try {
      const written = saveOnboardingCheckpointAtRevision(
        this.checkpoint.runId,
        this.checkpoint.phase,
        this.checkpoint.status,
        this.checkpoint,
        this.checkpoint.cancellationReason,
      )
      if (!written) {
        logger.warn('onboarding', `checkpoint revision ${this.checkpoint.revision} rejected for ${this.checkpoint.runId}`)
      }
      return written
    } catch (error) {
      // Persistence failure must not abort an in-flight run; the run continues
      // and the next checkpoint attempt may succeed.
      logger.error('onboarding', `failed to persist checkpoint for ${this.checkpoint.runId}`, error)
      return false
    }
  }

  setPhase(phase: OnboardingCheckpointV2['phase']): void {
    this.update(checkpoint => { checkpoint.phase = phase })
  }

  setStatus(status: OnboardingCheckpointV2['status'], reason?: string): void {
    this.update(checkpoint => {
      checkpoint.status = status
      if (reason) checkpoint.cancellationReason = reason
    })
  }

  setConnectedPlatforms(platforms: ConnectedPlatforms): void {
    this.update(checkpoint => { checkpoint.connectedPlatforms = platforms })
  }

  toolCall(callId: string, name: string, args?: unknown): void {
    this.update(checkpoint => recordToolCall(checkpoint, { callId, name, summary: args }))
  }

  toolResult(callId: string, name: string, status: 'succeeded' | 'failed', options?: {
    summary?: unknown
    errorCode?: string
    artifact?: { kind: string; count: number }
  }): void {
    this.update(checkpoint => recordToolResult(checkpoint, { callId, name, status, ...options }))
  }

  setPendingQuestions(requestId: string, questions: OnboardingCheckpointV2['pendingInteraction'] extends null ? never : NonNullable<OnboardingCheckpointV2['pendingInteraction']>['questions'], expiresAt: string): void {
    this.update(checkpoint => {
      checkpoint.phase = 'interview'
      checkpoint.interviewRequestedAt = checkpoint.interviewRequestedAt ?? new Date().toISOString()
      checkpoint.pendingInteraction = { kind: 'questions', requestId, questions, expiresAt }
    })
  }

  setPendingAuth(requestId: string, expiresAt: string): void {
    this.update(checkpoint => {
      checkpoint.pendingInteraction = { kind: 'auth', requestId, expiresAt }
    })
  }

  recordAnswers(requestId: string, answers: { id: string; answer: string | string[] }[]): void {
    this.update(checkpoint => {
      if (checkpoint.pendingInteraction?.requestId === requestId) {
        checkpoint.pendingInteraction = { ...checkpoint.pendingInteraction, answers }
      }
    })
  }

  clearPendingInteraction(): void {
    this.update(checkpoint => { checkpoint.pendingInteraction = null })
  }

  setDisplayMessages(messages: OnboardingCheckpointV2['displayMessages']): void {
    this.update(checkpoint => { checkpoint.displayMessages = messages })
  }

  setModelMessages(messages: unknown[]): void {
    this.update(checkpoint => { checkpoint.modelMessages = scrubSecretKeys(messages) as unknown[] })
  }

  markComplete(): void {
    this.update(checkpoint => {
      checkpoint.phase = 'complete'
      checkpoint.status = 'complete'
      checkpoint.completionCommitted = true
      checkpoint.pendingInteraction = null
    })
  }

  markFailed(errorCode?: string): void {
    this.update(checkpoint => {
      checkpoint.phase = 'failed'
      checkpoint.status = 'failed'
      if (errorCode) checkpoint.cancellationReason = errorCode
    })
  }
}
