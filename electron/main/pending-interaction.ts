// Pending user interactions (interview questionnaire, auth gate).
//
// Every pending promise has a settlement path: an answer, an inactivity
// timeout, or an explicit cancellation. Nothing here can hang forever, which is
// what previously happened when the window closed while a question was open.

export type InteractionOutcome<T> =
  | { status: 'answered'; value: T }
  | { status: 'timeout' }
  | { status: 'cancelled'; reason: string }

interface PendingEntry<T> {
  runId?: string
  settle: (outcome: InteractionOutcome<T>) => void
  timer?: ReturnType<typeof setTimeout>
}

export interface WaitOptions {
  /** Inactivity budget. Bounds only the wait on the user, never model work. */
  timeoutMs?: number
  runId?: string
  onTimeout?: (id: string) => void
}

export class PendingInteractionRegistry<T> {
  private readonly pending = new Map<string, PendingEntry<T>>()

  wait(id: string, options: WaitOptions = {}): Promise<InteractionOutcome<T>> {
    // Replace any stale entry under the same id rather than leaking it.
    this.settle(id, { status: 'cancelled', reason: 'superseded' })

    return new Promise<InteractionOutcome<T>>(resolve => {
      let settled = false
      const entry: PendingEntry<T> = {
        runId: options.runId,
        settle: outcome => {
          if (settled) return
          settled = true
          if (entry.timer) clearTimeout(entry.timer)
          resolve(outcome)
        },
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (settled) return
          this.pending.delete(id)
          entry.settle({ status: 'timeout' })
          options.onTimeout?.(id)
        }, options.timeoutMs)
        // Never hold the process open just to wait on a user.
        entry.timer.unref?.()
      }

      this.pending.set(id, entry)
    })
  }

  /** Deliver a user answer. Returns false when the wait already settled. */
  resolve(id: string, value: T): boolean {
    return this.settle(id, { status: 'answered', value })
  }

  settle(id: string, outcome: InteractionOutcome<T>): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    entry.settle(outcome)
    return true
  }

  settleAll(outcome: InteractionOutcome<T>): number {
    const ids = [...this.pending.keys()]
    for (const id of ids) this.settle(id, outcome)
    return ids.length
  }

  settleRun(runId: string, outcome: InteractionOutcome<T>): number {
    const ids = [...this.pending.entries()]
      .filter(([, entry]) => entry.runId === runId)
      .map(([id]) => id)
    for (const id of ids) this.settle(id, outcome)
    return ids.length
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  get size(): number {
    return this.pending.size
  }
}
