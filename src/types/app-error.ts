export type AppErrorCategory =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'agent'
  | 'storage'
  | 'validation'
  | 'internal'

export type AppErrorAction =
  | 'retry'
  | 'reauthenticate'
  | 'change-model'
  | 'add-key'
  | 'resume'
  | 'open-settings'

export interface AppError {
  code: string
  category: AppErrorCategory
  message: string
  retryable: boolean
  action?: AppErrorAction
  provider?: string
  platform?: string
  retryAfterMs?: number
  runId?: string
  details?: Record<string, unknown>
}

export function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') return false
  const error = value as Partial<AppError>
  return typeof error.code === 'string'
    && typeof error.category === 'string'
    && typeof error.message === 'string'
    && typeof error.retryable === 'boolean'
}

export function createAppError(
  input: Omit<AppError, 'message'> & { message?: string },
  fallbackMessage = 'The operation could not be completed.',
): AppError {
  return {
    ...input,
    message: input.message?.trim() || fallbackMessage,
  }
}
