// Active onboarding run registry.
//
// The renderer learns its run id before any long-running work starts, so it can
// checkpoint answers and reject events from superseded runs. Each run owns an
// AbortController, which gives cancellation and pause a single choke point.

import type {
  OnboardingEvent,
  OnboardingEventPayload,
} from '../../src/types/onboarding-events'

export type OnboardingRunState = 'prepared' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled'

export interface ActiveOnboardingRun {
  runId: string
  state: OnboardingRunState
  abortController: AbortController
  sequence: number
  startedAt: number
  /** Reason recorded when a run is cancelled or paused, surfaced to the UI. */
  stopReason?: string
}

export type OnboardingEventSink = (event: OnboardingEvent) => void

export class OnboardingRunRegistry {
  private readonly runs = new Map<string, ActiveOnboardingRun>()

  constructor(private readonly emit: OnboardingEventSink) {}

  prepare(runId: string): ActiveOnboardingRun {
    const existing = this.runs.get(runId)
    if (existing) return existing

    const run: ActiveOnboardingRun = {
      runId,
      state: 'prepared',
      abortController: new AbortController(),
      sequence: 0,
      startedAt: Date.now(),
    }
    this.runs.set(runId, run)
    return run
  }

  get(runId: string): ActiveOnboardingRun | undefined {
    return this.runs.get(runId)
  }

  /** True when the run exists and is not already executing. */
  canExecute(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run) return false
    return run.state !== 'running'
  }

  markRunning(runId: string): ActiveOnboardingRun | undefined {
    const run = this.runs.get(runId)
    if (!run) return undefined
    // A resumed run needs a fresh controller: the old one may be aborted.
    if (run.abortController.signal.aborted) {
      run.abortController = new AbortController()
    }
    run.state = 'running'
    run.stopReason = undefined
    return run
  }

  settle(runId: string, state: Extract<OnboardingRunState, 'complete' | 'failed' | 'cancelled' | 'paused'>, reason?: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.state = state
    if (reason) run.stopReason = reason
  }

  release(runId: string): void {
    this.runs.delete(runId)
  }

  isActive(): boolean {
    for (const run of this.runs.values()) {
      if (run.state === 'running') return true
    }
    return false
  }

  activeRunIds(): string[] {
    return [...this.runs.values()].filter(run => run.state === 'running').map(run => run.runId)
  }

  /** Abort a run's model work. Returns false when the run is unknown. */
  abort(runId: string, state: Extract<OnboardingRunState, 'cancelled' | 'paused'>, reason: string): boolean {
    const run = this.runs.get(runId)
    if (!run) return false
    run.state = state
    run.stopReason = reason
    if (!run.abortController.signal.aborted) run.abortController.abort()
    this.publish(runId, state === 'cancelled' ? { type: 'cancelled', reason } : { type: 'paused', reason })
    return true
  }

  abortAll(reason: string): void {
    for (const run of this.runs.values()) {
      if (run.state !== 'running' && run.state !== 'prepared') continue
      run.state = 'paused'
      run.stopReason = reason
      if (!run.abortController.signal.aborted) run.abortController.abort()
    }
  }

  /** Emit a run-scoped, sequenced event. Unknown runs are dropped. */
  publish(runId: string, payload: OnboardingEventPayload): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.sequence += 1
    this.emit({
      version: 1,
      runId,
      sequence: run.sequence,
      emittedAt: new Date().toISOString(),
      payload,
    })
  }
}
