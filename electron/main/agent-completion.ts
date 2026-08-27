export interface CompletionSignals {
  sawText: boolean
  sawReasoning: boolean
  sawToolCall: boolean
  text: string
}

/**
 * A completion that produced neither text nor tool calls delivered nothing
 * usable — even when the model streamed reasoning "thoughts". A reasoning-only
 * turn (thoughts but no answer) is an empty turn for callers, so it is worth
 * the same bounded resample as a bare empty completion.
 */
export function isUnusableCompletion(signals: CompletionSignals): boolean {
  return !signals.sawText && !signals.sawToolCall && signals.text.trim() === ''
}
