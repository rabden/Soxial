import { describe, expect, it } from 'vitest'
import { errorForRenderer, normalizeAppError } from '../electron/main/errors'
import { createOnboardingCheckpoint, parseOnboardingCheckpoint } from '../electron/main/onboarding-run'

describe('operational errors', () => {
  it('maps quota failures to a retryable rate-limit action without leaking details', () => {
    const error = errorForRenderer({
      message: 'quota exceeded for key=secret-value',
      status: 429,
      request: { prompt: 'private prompt' },
    }, { runId: 'run_test', provider: 'google' })

    expect(error).toMatchObject({
      code: 'MODEL_RATE_LIMITED',
      category: 'rate-limit',
      retryable: true,
      action: 'retry',
      runId: 'run_test',
      provider: 'google',
    })
    expect(JSON.stringify(error)).not.toContain('secret-value')
    expect(JSON.stringify(error)).not.toContain('private prompt')
  })

  it('maps authentication and persistence failures to distinct recovery actions', () => {
    expect(normalizeAppError({ status: 401, message: 'unauthorized' })).toMatchObject({
      code: 'PROVIDER_AUTH_REQUIRED',
      category: 'auth',
      action: 'reauthenticate',
      retryable: false,
    })
    expect(normalizeAppError(new Error('SQLite persistence failed'))).toMatchObject({
      code: 'PERSISTENCE_FAILED',
      category: 'storage',
      action: 'retry',
      retryable: true,
    })
  })
})

describe('onboarding checkpoints', () => {
  it('accepts versioned resumable state and rejects malformed messages', () => {
    const checkpoint = createOnboardingCheckpoint('onboarding_test', [
      { role: 'user', content: 'hello' },
    ])
    expect(parseOnboardingCheckpoint(checkpoint)).toEqual(checkpoint)
    expect(parseOnboardingCheckpoint({
      ...checkpoint,
      messages: [{ role: 'assistant', content: 42 }],
    })).toBeNull()
  })
})
