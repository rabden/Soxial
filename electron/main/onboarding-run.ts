export type OnboardingPhase = 'gather' | 'interview' | 'complete' | 'failed'
export type OnboardingRunStatus = 'running' | 'paused' | 'complete' | 'failed' | 'cancelled'

export interface OnboardingCheckpoint {
  version: 1
  runId: string
  phase: OnboardingPhase
  status: OnboardingRunStatus
  messages: Array<{ role: string; content: string | null; steps?: unknown[] }>
  lastCompletedTool?: string
  pendingQuestion?: { batchId: string; questionIds: string[] }
  completionCommitted: boolean
  updatedAt: string
}

export function createOnboardingCheckpoint(
  runId: string,
  messages: OnboardingCheckpoint['messages'] = [],
): OnboardingCheckpoint {
  return {
    version: 1,
    runId,
    phase: 'gather',
    status: 'running',
    messages,
    completionCommitted: false,
    updatedAt: new Date().toISOString(),
  }
}

export function parseOnboardingCheckpoint(value: unknown): OnboardingCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const checkpoint = value as Partial<OnboardingCheckpoint>
  if (
    checkpoint.version !== 1
    || typeof checkpoint.runId !== 'string'
    || !['gather', 'interview', 'complete', 'failed'].includes(checkpoint.phase || '')
    || !['running', 'paused', 'complete', 'failed', 'cancelled'].includes(checkpoint.status || '')
    || !Array.isArray(checkpoint.messages)
    || typeof checkpoint.completionCommitted !== 'boolean'
  ) return null

  const messages = checkpoint.messages.filter(message =>
    message
    && typeof message === 'object'
    && typeof message.role === 'string'
    && (typeof message.content === 'string' || message.content === null)
  )
  if (messages.length !== checkpoint.messages.length) return null
  return checkpoint as OnboardingCheckpoint
}
