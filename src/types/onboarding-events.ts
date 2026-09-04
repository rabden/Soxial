// Shared onboarding event contract between the main process and the renderer.
//
// Every event carries the run it belongs to and a monotonic sequence number so
// a stale run (retry, resume, or a second window) can never mutate the UI of
// the run the user is actually watching.

export type OnboardingPhaseName = 'gather' | 'interview' | 'review'

export interface OnboardingQuestion {
  id: string
  text: string
  type: 'single' | 'multi' | 'text'
  options?: string[]
}

export interface OnboardingAuthPayload {
  id: string
  twitter: { needed: boolean; ok: boolean; username?: string | null; name?: string | null }
  reddit: { needed: boolean; ok: boolean; username?: string | null; name?: string | null }
  canSkipTwitter?: boolean
  canSkipReddit?: boolean
  canProceedPartial?: boolean
}

export type OnboardingEventPayload =
  | { type: 'phase'; phase: OnboardingPhaseName }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; name: string; args: unknown }
  | { type: 'tool-result'; name: string; result: unknown }
  | { type: 'question'; batchId: string; questions: OnboardingQuestion[] }
  | { type: 'auth-required'; auth: OnboardingAuthPayload }
  | { type: 'transient-retry'; attempt: number; maxAttempts: number; backoffMs: number; model: string }
  | { type: 'paused'; reason: string }
  | { type: 'cancelled'; reason: string }
  | { type: 'complete' }
  | { type: 'failed'; code?: string }

export type OnboardingEventType = OnboardingEventPayload['type']

export interface OnboardingEvent {
  version: 1
  runId: string
  sequence: number
  emittedAt: string
  payload: OnboardingEventPayload
}

export const ONBOARDING_EVENT_CHANNEL = 'onboarding:event'

export function isOnboardingEvent(value: unknown): value is OnboardingEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<OnboardingEvent>
  return event.version === 1
    && typeof event.runId === 'string'
    && event.runId.length > 0
    && typeof event.sequence === 'number'
    && Number.isFinite(event.sequence)
    && typeof event.emittedAt === 'string'
    && !!event.payload
    && typeof (event.payload as { type?: unknown }).type === 'string'
}

/**
 * Renderer-side ordering guard. Drops events from other runs and any event that
 * does not advance the sequence, which makes duplicate delivery harmless.
 */
export function createOnboardingEventGate(runId: string) {
  let lastSequence = 0

  return {
    get runId() {
      return runId
    },
    get lastSequence() {
      return lastSequence
    },
    accept(event: unknown): event is OnboardingEvent {
      if (!isOnboardingEvent(event)) return false
      if (event.runId !== runId) return false
      if (event.sequence <= lastSequence) return false
      lastSequence = event.sequence
      return true
    },
  }
}

export type OnboardingEventGate = ReturnType<typeof createOnboardingEventGate>

// ─── Background enrichment events (Plan 13) ─────────────────────────────────
//
// Job-scoped and separate from the run event channel: enrichment runs after
// the onboarding run has settled, while the user is already in chat.

export type EnrichmentEventPayload =
  | { type: 'stage'; stage: string }
  | { type: 'complete' }
  | { type: 'failed'; errorCode: string | null }
  | { type: 'cancelled' }

export interface EnrichmentEvent {
  version: 1
  runId: string
  emittedAt: string
  payload: EnrichmentEventPayload
}

export const ENRICHMENT_EVENT_CHANNEL = 'onboarding:enrichment:event'

export function isEnrichmentEvent(value: unknown): value is EnrichmentEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<EnrichmentEvent>
  if (event.version !== 1 || typeof event.runId !== 'string' || !event.runId) return false
  const payload = event.payload as { type?: unknown } | undefined
  if (!payload || typeof payload.type !== 'string') return false
  if (!['stage', 'complete', 'failed', 'cancelled'].includes(payload.type)) return false
  if (payload.type === 'stage' && typeof (payload as { stage?: unknown }).stage !== 'string') return false
  return true
}
