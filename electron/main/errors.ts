import { randomUUID } from 'crypto'
import type { AppError, AppErrorCategory, AppErrorAction } from '../../src/types/app-error'

interface NormalizeContext {
  runId?: string
  provider?: string
  platform?: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'The operation could not be completed.'
}

function redactMessage(message: string): string {
  return message
    .replace(/((?:api[_ -]?key|token|secret|password)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/(key\s*=\s*)\S+/gi, '$1[redacted]')
}

function statusOf(error: unknown): number | string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as Record<string, any>
  return value.status ?? value.statusCode ?? value.code ?? value.error?.status ?? value.error?.code
}

export function createRunId(prefix = 'run'): string {
  return `${prefix}_${randomUUID()}`
}

export function normalizeAppError(error: unknown, context: NormalizeContext = {}): AppError {
  const rawMessage = messageOf(error)
  const message = redactMessage(rawMessage)
  const lower = rawMessage.toLowerCase()
  const status = statusOf(error)
  const statusText = String(status ?? '').toLowerCase()

  let category: AppErrorCategory = 'internal'
  let code = 'INTERNAL_ERROR'
  let retryable = false
  let action: AppErrorAction | undefined
  let retryAfterMs: number | undefined

  if ([401, 403, 'unauthenticated', 'permission_denied'].some(value => status === value || statusText === String(value))) {
    category = 'auth'
    code = 'PROVIDER_AUTH_REQUIRED'
    action = 'reauthenticate'
  } else if (
    status === 429
    || statusText === 'resource_exhausted'
    || lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('too many requests')
  ) {
    category = 'rate-limit'
    code = 'MODEL_RATE_LIMITED'
    retryable = true
    action = 'retry'
    retryAfterMs = 5 * 60 * 1000
  } else if (
    [500, 502, 503, 504, 'unavailable', 'deadline_exceeded'].some(value => status === value || statusText === String(value))
    || ['fetch failed', 'econnreset', 'etimedout', 'network', 'timeout', 'temporarily'].some(value => lower.includes(value))
  ) {
    category = 'network'
    code = 'NETWORK_TRANSIENT'
    retryable = true
    action = 'retry'
  } else if (lower.includes('api key') || lower.includes('credential')) {
    category = 'auth'
    code = 'CREDENTIALS_INVALID'
    action = 'add-key'
  } else if (lower.includes('database') || lower.includes('sqlite') || lower.includes('persist')) {
    category = 'storage'
    code = 'PERSISTENCE_FAILED'
    retryable = true
    action = 'retry'
  } else if (lower.includes('empty output') || lower.includes('agent') || lower.includes('model')) {
    category = 'agent'
    code = 'AGENT_INCOMPLETE'
    retryable = true
    action = 'resume'
  } else if (lower.includes('missing') || lower.includes('readiness') || lower.includes('incomplete')) {
    category = 'validation'
    code = 'STRATEGY_INCOMPLETE'
    retryable = true
    action = 'retry'
  } else if (lower.includes('invalid') || lower.includes('required') || lower.includes('empty')) {
    category = 'validation'
    code = 'INVALID_REQUEST'
  }

  return {
    code,
    category,
    message,
    retryable,
    ...(action ? { action } : {}),
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.platform ? { platform: context.platform } : {}),
    ...(retryAfterMs ? { retryAfterMs } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
  }
}

export function errorForRenderer(error: unknown, context: NormalizeContext = {}): AppError {
  const normalized = normalizeAppError(error, context)
  const safeMessageByCategory: Record<AppErrorCategory, string> = {
    auth: 'Authentication is required. Reauthenticate and try again.',
    'rate-limit': 'The model is temporarily rate limited. Retry after the cooldown or choose another model.',
    network: 'The network request failed. Check your connection and retry.',
    agent: 'The AI run stopped before completion. You can resume or retry safely.',
    storage: 'Local data could not be saved. Retry the operation.',
    validation: 'Check the requested values and try again.',
    internal: `Something unexpected happened. Retry and provide code ${normalized.code} if help is needed.`,
  }
  // Do not forward provider exception objects, stack traces, request payloads, or credentials.
  return {
    ...normalized,
    message: safeMessageByCategory[normalized.category],
    details: undefined,
  }
}
