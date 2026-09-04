// Shared Puter auth event contract between the main process and the renderer.

export type PuterAuthEventStatus = 'required' | 'completed' | 'cancelled'

export interface PuterAuthEvent {
  status: PuterAuthEventStatus
  /** Optional progress/failure detail surfaced from the sign-in window. */
  detail?: string
}
