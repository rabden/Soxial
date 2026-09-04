export type OnboardingPhase = 'gather' | 'interview' | 'review' | 'complete' | 'failed'
export type OnboardingRunStatus = 'running' | 'paused' | 'complete' | 'failed' | 'cancelled'

export const CHECKPOINT_VERSION = 2 as const

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

// ─── Checkpoint V2 ──────────────────────────────────────────────────────────
// V1 stored only display messages, so an interrupted interview lost the user's
// answers and replayed completed gather work. V2 additionally persists the
// model-native transcript, the exact pending questions, and a tool ledger.

export interface OnboardingQuestionRecord {
  id: string
  text: string
  type: 'single' | 'multi' | 'text'
  options?: string[]
}

export interface OnboardingAnswerRecord {
  id: string
  answer: string | string[]
}

export interface PendingInteraction {
  kind: 'questions' | 'auth' | 'review'
  requestId: string
  toolCallId?: string
  questions?: OnboardingQuestionRecord[]
  answers?: OnboardingAnswerRecord[]
  /** Draft this review interaction is bound to (kind: 'review'). */
  draftRunId?: string
  /** Draft version at the time the interaction was created. */
  expectedVersion?: number
  /** ISO timestamp after which the interaction is considered abandoned. */
  expiresAt: string
}

/** Which social platforms the user has connected — drives tool availability. */
export interface ConnectedPlatforms {
  twitter: boolean
  reddit: boolean
}

/** Derive connected-platform flags from a profile row's handle columns. */
export function connectedPlatformsFromProfile(
  profile:
    | { twitter_handle?: string | null; reddit_username?: string | null }
    | null
    | undefined,
): ConnectedPlatforms {
  return { twitter: !!profile?.twitter_handle, reddit: !!profile?.reddit_username }
}

export type ToolLedgerStatus = 'calling' | 'succeeded' | 'failed'

export interface ToolLedgerEntry {
  callId: string
  name: string
  status: ToolLedgerStatus
  startedAt: string
  completedAt?: string
  /** Small, redacted summary. Never the full payload. */
  summary?: string
  errorCode?: string
  /** Artifact counts contributed by this call, used by readiness validation. */
  artifact?: { kind: string; count: number }
}

export interface ConfidenceAssessment {
  confidence: number
  evidence: string[]
  contradiction?: string
}

export interface EvidenceAssessment {
  positioning?: ConfidenceAssessment
  audience?: ConfidenceAssessment
  voice?: ConfidenceAssessment
  businessOutcome?: ConfidenceAssessment
  timeCapacity?: ConfidenceAssessment
  riskTolerance?: ConfidenceAssessment
}

export interface OnboardingCheckpointV2 {
  version: 2
  runId: string
  revision: number
  phase: OnboardingPhase
  status: OnboardingRunStatus
  displayMessages: Array<{ role: string; content: string | null; steps?: unknown[] }>
  modelMessages: unknown[]
  pendingInteraction: PendingInteraction | null
  toolLedger: ToolLedgerEntry[]
  evidenceAssessment?: EvidenceAssessment
  readiness?: unknown
  connectedPlatforms: ConnectedPlatforms
  interviewRequestedAt?: string
  completionCommitted: boolean
  cancellationReason?: string
  updatedAt: string
}

const SECRET_KEY_PATTERN = /api[_-]?key|credential|secret|token|password|cookie|authorization|bearer/i

/**
 * Strip secret-bearing fields and bound the size of anything persisted into a
 * checkpoint. Checkpoints are plain JSON on disk, so they must never carry
 * credentials or full social payloads.
 */
export function redactForCheckpoint(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redactForCheckpoint(item, depth + 1))
  if (typeof value !== 'object') return undefined

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    out[key] = redactForCheckpoint(item, depth + 1)
  }
  return out
}

/**
 * Secret-key scrub WITHOUT the checkpoint size caps: persisted model messages
 * must stay complete enough to continue the run from, so only credential-shaped
 * keys are redacted.
 */
export function scrubSecretKeys(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => scrubSecretKeys(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : scrubSecretKeys(item, depth + 1)
  }
  return out
}

export function createOnboardingCheckpointV2(
  runId: string,
  displayMessages: OnboardingCheckpointV2['displayMessages'] = [],
): OnboardingCheckpointV2 {
  return {
    version: 2,
    runId,
    revision: 0,
    phase: 'gather',
    status: 'running',
    displayMessages,
    modelMessages: [],
    pendingInteraction: null,
    toolLedger: [],
    connectedPlatforms: { twitter: false, reddit: false },
    completionCommitted: false,
    updatedAt: new Date().toISOString(),
  }
}

function isMessageList(value: unknown): value is OnboardingCheckpointV2['displayMessages'] {
  return Array.isArray(value) && value.every(message =>
    message
    && typeof message === 'object'
    && typeof (message as any).role === 'string'
    && (typeof (message as any).content === 'string' || (message as any).content === null),
  )
}

function isQuestionRecord(value: unknown): value is OnboardingQuestionRecord {
  const question = value as Partial<OnboardingQuestionRecord>
  return !!question
    && typeof question.id === 'string'
    && question.id.length > 0
    && typeof question.text === 'string'
    && (question.type === 'single' || question.type === 'multi' || question.type === 'text')
    && (question.options === undefined || (Array.isArray(question.options) && question.options.every(o => typeof o === 'string')))
}

function isPendingInteraction(value: unknown): value is PendingInteraction {
  if (value === null) return true
  const pending = value as Partial<PendingInteraction>
  if (!pending || typeof pending !== 'object') return false
  if (pending.kind !== 'questions' && pending.kind !== 'auth' && pending.kind !== 'review') return false
  if (typeof pending.requestId !== 'string' || !pending.requestId) return false
  if (typeof pending.expiresAt !== 'string') return false
  if (pending.questions !== undefined && !(Array.isArray(pending.questions) && pending.questions.every(isQuestionRecord))) return false
  if (pending.answers !== undefined && !Array.isArray(pending.answers)) return false
  return true
}

function isToolLedger(value: unknown): value is ToolLedgerEntry[] {
  return Array.isArray(value) && value.every(entry => {
    const item = entry as Partial<ToolLedgerEntry>
    return !!item
      && typeof item.callId === 'string'
      && typeof item.name === 'string'
      && (item.status === 'calling' || item.status === 'succeeded' || item.status === 'failed')
      && typeof item.startedAt === 'string'
  })
}

export function parseOnboardingCheckpointV2(value: unknown): OnboardingCheckpointV2 | null {
  if (!value || typeof value !== 'object') return null
  const checkpoint = value as Partial<OnboardingCheckpointV2>

  if (checkpoint.version !== 2) return null
  if (typeof checkpoint.runId !== 'string' || !checkpoint.runId) return null
  if (typeof checkpoint.revision !== 'number' || !Number.isFinite(checkpoint.revision) || checkpoint.revision < 0) return null
  if (!['gather', 'interview', 'review', 'complete', 'failed'].includes(checkpoint.phase || '')) return null
  if (!['running', 'paused', 'complete', 'failed', 'cancelled'].includes(checkpoint.status || '')) return null
  if (!isMessageList(checkpoint.displayMessages)) return null
  if (!Array.isArray(checkpoint.modelMessages)) return null
  if (!isPendingInteraction(checkpoint.pendingInteraction ?? null)) return null
  if (!isToolLedger(checkpoint.toolLedger)) return null
  if (typeof checkpoint.completionCommitted !== 'boolean') return null
  if (!checkpoint.connectedPlatforms || typeof checkpoint.connectedPlatforms !== 'object') return null

  return checkpoint as OnboardingCheckpointV2
}

/** Upgrade a valid V1 checkpoint. Unknown or corrupt input returns null. */
export function migrateOnboardingCheckpoint(value: unknown): OnboardingCheckpointV2 | null {
  const v2 = parseOnboardingCheckpointV2(value)
  if (v2) return v2

  const v1 = parseOnboardingCheckpoint(value)
  if (!v1) return null

  const migrated = createOnboardingCheckpointV2(v1.runId, v1.messages)
  migrated.phase = v1.phase
  migrated.status = v1.status
  migrated.completionCommitted = v1.completionCommitted
  migrated.updatedAt = v1.updatedAt

  // V1 recorded only question ids, never their text or the answers, so the
  // questionnaire cannot be faithfully reopened. Resume from the transcript
  // instead of showing a half-populated form.
  if (v1.lastCompletedTool) {
    migrated.toolLedger = [{
      callId: `v1-${v1.lastCompletedTool}`,
      name: v1.lastCompletedTool,
      status: 'succeeded',
      startedAt: v1.updatedAt,
      completedAt: v1.updatedAt,
      summary: 'migrated from checkpoint v1',
    }]
  }

  return migrated
}

/** Record a tool call. Repeated calls with the same id update in place. */
export function recordToolCall(checkpoint: OnboardingCheckpointV2, entry: {
  callId: string
  name: string
  summary?: unknown
}): void {
  const existing = checkpoint.toolLedger.find(item => item.callId === entry.callId)
  if (existing) return
  checkpoint.toolLedger.push({
    callId: entry.callId,
    name: entry.name,
    status: 'calling',
    startedAt: new Date().toISOString(),
    summary: entry.summary === undefined ? undefined : JSON.stringify(redactForCheckpoint(entry.summary)).slice(0, 500),
  })
}

export function recordToolResult(checkpoint: OnboardingCheckpointV2, entry: {
  callId: string
  name: string
  status: 'succeeded' | 'failed'
  summary?: unknown
  errorCode?: string
  artifact?: { kind: string; count: number }
}): void {
  const existing = checkpoint.toolLedger.find(item => item.callId === entry.callId)
  const completedAt = new Date().toISOString()
  const summary = entry.summary === undefined
    ? undefined
    : JSON.stringify(redactForCheckpoint(entry.summary)).slice(0, 500)

  if (existing) {
    existing.status = entry.status
    existing.completedAt = completedAt
    if (summary !== undefined) existing.summary = summary
    if (entry.errorCode) existing.errorCode = entry.errorCode
    if (entry.artifact) existing.artifact = entry.artifact
    return
  }

  checkpoint.toolLedger.push({
    callId: entry.callId,
    name: entry.name,
    status: entry.status,
    startedAt: completedAt,
    completedAt,
    summary,
    errorCode: entry.errorCode,
    artifact: entry.artifact,
  })
}

/** Completed gather tools should not be re-executed on resume. */
export function hasCompletedTool(checkpoint: OnboardingCheckpointV2, name: string): boolean {
  return checkpoint.toolLedger.some(entry => entry.name === name && entry.status === 'succeeded')
}

export function parseOnboardingCheckpoint(value: unknown): OnboardingCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const checkpoint = value as Partial<OnboardingCheckpoint>
  if (
    checkpoint.version !== 1
    || typeof checkpoint.runId !== 'string'
    || !['gather', 'interview', 'review', 'complete', 'failed'].includes(checkpoint.phase || '')
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

// ─── Model-message resume support (Plan 6) ──────────────────────────────────

function isAssistantToolCall(part: unknown): part is { type: 'tool-call'; toolCallId: string; toolName: string } {
  const p = part as any
  return !!p && p.type === 'tool-call' && typeof p.toolCallId === 'string' && p.toolName === 'ask_user_questions'
}

function hasToolResultFor(messages: unknown[], toolCallId: string): boolean {
  return messages.some(message => {
    const m = message as any
    if (m?.role !== 'tool' || !Array.isArray(m.content)) return false
    return m.content.some((part: any) => part?.type === 'tool-result' && part.toolCallId === toolCallId)
  })
}

/**
 * Prepare persisted model messages for a resumed run:
 * - answered interview: append the tool-result carrying the persisted answers,
 *   so the model continues exactly where the pause interrupted it;
 * - unanswered interview: strip the dangling tool-call message (a tool result
 *   can never arrive for it) — the questions are re-opened to the user instead.
 */
export function appendAnsweredInteraction(modelMessages: unknown[], pending: PendingInteraction | null): unknown[] {
  const messages = [...modelMessages]

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as any
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    const call = [...message.content].reverse().find(isAssistantToolCall)
    if (!call) continue

    const answered = pending?.kind === 'questions' && Array.isArray(pending.answers) && pending.answers.length > 0
    if (answered && !hasToolResultFor(messages.slice(i + 1), call.toolCallId)) {
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: call.toolCallId,
          toolName: 'ask_user_questions',
          output: { answers: pending.answers },
        }],
      })
    } else if (!answered && !hasToolResultFor(messages.slice(i + 1), call.toolCallId) && i === messages.length - 1) {
      messages.splice(i, 1)
    }
    return messages
  }

  return messages
}
