import { describe, expect, it, vi } from 'vitest'
import {
  CredentialProbe,
  ProviderVerificationResult,
  classifyProviderProbeError,
  probeModelFor,
  summarizeVerification,
  verifyCredential,
  zhipuBaseUrl,
} from '../electron/main/provider-verification'
import { isUnusableCompletion } from '../electron/main/agent-completion'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/soxial-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
}))

const okProbe: CredentialProbe = async () => {}
const failingProbe = (error: unknown): CredentialProbe => async () => { throw error }

describe('provider error classification', () => {
  it('treats 401/403 and rejected-key messages as invalid credentials', () => {
    for (const error of [
      { status: 401, message: 'unauthorized' },
      { status: 403, message: 'permission denied' },
      { message: 'API key not valid. Please pass a valid API key.' },
      { error: { status: 'PERMISSION_DENIED', message: 'denied' } },
    ]) {
      const result = classifyProviderProbeError(error)
      expect(result.code, JSON.stringify(error)).toBe('INVALID_CREDENTIALS')
      expect(result.valid).toBe(false)
    }
  })

  it('treats a rate-limited key as authenticated and usable', () => {
    for (const error of [
      { status: 429, message: 'too many requests' },
      { message: 'quota exceeded for this project' },
      { error: { status: 'RESOURCE_EXHAUSTED' } },
    ]) {
      const result = classifyProviderProbeError(error)
      expect(result.code, JSON.stringify(error)).toBe('RATE_LIMITED')
      expect(result.valid).toBe(true)
    }
  })

  it('distinguishes network failure from an invalid key', () => {
    const result = classifyProviderProbeError(new Error('fetch failed'))
    expect(result.code).toBe('NETWORK_ERROR')
    expect(result.valid).toBe(false)
    expect(result.message).not.toContain('rejected')
  })

  it('treats a missing model as an authenticated key — for Google only', () => {
    const google = classifyProviderProbeError({ status: 404, message: 'model not found' }, 'google')
    expect(google.code).toBe('MODEL_UNAVAILABLE')
    expect(google.valid).toBe(true)

    // OpenAI-compatible endpoints may 404 for a wrong key, model, or base
    // URL — a 404 is not proof of authentication there and must block.
    for (const provider of ['zhipu', 'openai', 'anthropic'] as const) {
      const result = classifyProviderProbeError({ status: 404, message: 'not found' }, provider)
      expect(result.code, provider).toBe('MODEL_UNAVAILABLE')
      expect(result.valid, provider).toBe(false)
    }
  })

  it('falls back to a non-committal unknown error', () => {
    const result = classifyProviderProbeError(new Error('something strange happened'))
    expect(result.code).toBe('UNKNOWN_ERROR')
    expect(result.valid).toBe(false)
  })
})

describe('probe model selection', () => {
  it('probes with the selected model when it belongs to the provider', () => {
    expect(probeModelFor('google', 'gemini-3.7-flash')).toBe('gemini-3.7-flash')
    expect(probeModelFor('zhipu', 'glm-4.7-flash')).toBe('glm-4.7-flash')
    expect(probeModelFor('openai', 'openai/gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(probeModelFor('anthropic', 'anthropic/claude-sonnet-4')).toBe('claude-sonnet-4')
  })

  it('returns undefined for other providers, custom endpoints, and no selection', () => {
    expect(probeModelFor('google', 'glm-4.7-flash')).toBeUndefined()
    expect(probeModelFor('zhipu', 'gemini-3.7-flash')).toBeUndefined()
    expect(probeModelFor('google', 'custom/3/my-model')).toBeUndefined()
    expect(probeModelFor('google', null)).toBeUndefined()
    expect(probeModelFor('google', undefined)).toBeUndefined()
  })
})

describe('credential verification against the selected model', () => {
  it('passes the probe model through to the probe', async () => {
    const seen: Array<string | undefined> = []
    const probe: CredentialProbe = async (_provider, _key, _codingPlan, probeModel) => {
      seen.push(probeModel)
    }
    await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret', {
      probe,
      probeModel: 'gemini-3.7-flash',
    })
    expect(seen).toEqual(['gemini-3.7-flash'])
  })

  it('retries with the fallback probe model when the selected model 404s', async () => {
    const seen: Array<string | undefined> = []
    const probe: CredentialProbe = async (_provider, _key, _codingPlan, probeModel) => {
      seen.push(probeModel)
      if (probeModel === 'gemini-3.7-flash') throw { status: 404, message: 'model not found' }
    }

    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret', {
      probe,
      probeModel: 'gemini-3.7-flash',
    })

    expect(seen).toEqual(['gemini-3.7-flash', 'gemini-3.5-flash-lite'])
    expect(result.valid).toBe(true)
    expect(result.code).toBe('VALID')
  })

  it('reports MODEL_UNAVAILABLE when both the selected and fallback models 404', async () => {
    const probe: CredentialProbe = async () => {
      throw { status: 404, message: 'model not found' }
    }

    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret', {
      probe,
      probeModel: 'gemini-3.7-flash',
    })

    expect(result.code).toBe('MODEL_UNAVAILABLE')
    expect(result.valid).toBe(true)
  })

  it('keeps the harsher classification when the fallback probe rejects the key', async () => {
    const probe: CredentialProbe = async (_provider, _key, _codingPlan, probeModel) => {
      if (probeModel === 'gemini-3.5-flash-lite') {
        throw { status: 400, message: 'API key not valid. Please pass a valid API key.' }
      }
      throw { status: 404, message: 'model not found' }
    }

    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret', {
      probe,
      probeModel: 'gemini-3.7-flash',
    })

    expect(result.valid).toBe(false)
    expect(result.code).toBe('INVALID_CREDENTIALS')
  })

  it('blocks a Google key rejected on the selected model without any fallback', async () => {
    const probe: CredentialProbe = async () => {
      throw { status: 400, message: 'API key not valid. Please pass a valid API key.' }
    }

    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret', {
      probe,
      probeModel: 'gemini-3.7-flash',
    })

    expect(result.valid).toBe(false)
    expect(result.code).toBe('INVALID_CREDENTIALS')
  })
})

describe('unusable completions', () => {
  it('treats a reasoning-only turn as empty', () => {
    expect(
      isUnusableCompletion({ sawText: false, sawReasoning: true, sawToolCall: false, text: '' }),
    ).toBe(true)
  })

  it('treats text and tool calls as usable output', () => {
    expect(
      isUnusableCompletion({ sawText: true, sawReasoning: true, sawToolCall: false, text: 'answer' }),
    ).toBe(false)
    expect(
      isUnusableCompletion({ sawText: false, sawReasoning: true, sawToolCall: true, text: '' }),
    ).toBe(false)
  })

  it('treats a bare empty completion as empty', () => {
    expect(
      isUnusableCompletion({ sawText: false, sawReasoning: false, sawToolCall: false, text: '' }),
    ).toBe(true)
    expect(
      isUnusableCompletion({ sawText: false, sawReasoning: false, sawToolCall: false, text: '   ' }),
    ).toBe(true)
  })
})

describe('credential verification', () => {
  it('verifies a working Google key', async () => {
    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, 'AIza-secret-key', { probe: okProbe })
    expect(result).toMatchObject({ provider: 'google', slot: 'primary', valid: true, code: 'VALID' })
  })

  it('verifies a working Z.AI key and selects the coding-plan endpoint', async () => {
    const seen: Array<{ provider: string; codingPlan?: boolean }> = []
    const probe: CredentialProbe = async (provider, _key, codingPlan) => { seen.push({ provider, codingPlan }) }

    await verifyCredential({ provider: 'zhipu', slot: 'primary' }, 'zhipu-secret', { probe, codingPlan: true })

    expect(seen).toEqual([{ provider: 'zhipu', codingPlan: true }])
    expect(zhipuBaseUrl(true)).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(zhipuBaseUrl(false)).toBe('https://api.z.ai/api/paas/v4')
  })

  it('rejects an empty key without probing the provider', async () => {
    const probe = vi.fn(okProbe)
    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, '   ', { probe })
    expect(result.valid).toBe(false)
    expect(result.code).toBe('INVALID_CREDENTIALS')
    expect(probe).not.toHaveBeenCalled()
  })

  it('never returns the raw key, only a masked suffix', async () => {
    const secret = 'AIzaSyVERYSECRETVALUE123'
    const result = await verifyCredential({ provider: 'google', slot: 'primary' }, secret, { probe: okProbe })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(secret)
    expect(result.masked).not.toBe(secret)
  })

  it('does not leak the key when the provider rejects it', async () => {
    const secret = 'AIzaSyREJECTEDKEY456'
    const result = await verifyCredential(
      { provider: 'google', slot: 'primary' },
      secret,
      { probe: failingProbe({ status: 401, message: `invalid api key ${secret}` }) },
    )

    expect(result.valid).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})

describe('verification summary', () => {
  const result = (overrides: Partial<ProviderVerificationResult>): ProviderVerificationResult => ({
    provider: 'google',
    slot: 'primary',
    valid: true,
    code: 'VALID',
    message: 'Key verified.',
    masked: '…1234',
    ...overrides,
  })

  it('requires at least one key', () => {
    expect(summarizeVerification([])).toMatchObject({ ok: false })
  })

  it('passes when the entered key is valid', () => {
    expect(summarizeVerification([result({})]).ok).toBe(true)
  })

  it('passes when the key is valid but rate limited', () => {
    expect(summarizeVerification([result({ valid: true, code: 'RATE_LIMITED' })]).ok).toBe(true)
  })

  it('blocks when a newly entered key was rejected', () => {
    const summary = summarizeVerification([
      result({ valid: false, code: 'INVALID_CREDENTIALS', message: 'This API key was rejected by the provider.' }),
    ])
    expect(summary.ok).toBe(false)
    expect(summary.message).toContain('rejected')
  })

  it('blocks a mixed batch so a bad new key is never silently dropped', () => {
    const summary = summarizeVerification([
      result({ slot: 'primary', valid: true }),
      result({ slot: 'additional', index: 0, valid: false, code: 'INVALID_CREDENTIALS', message: 'Backup key rejected.' }),
    ])
    expect(summary.ok).toBe(false)
    expect(summary.message).toBe('Backup key rejected.')
  })

  it('blocks on network failure rather than assuming the key is good', () => {
    const summary = summarizeVerification([
      result({ valid: false, code: 'NETWORK_ERROR', message: 'Could not reach the provider.' }),
    ])
    expect(summary.ok).toBe(false)
  })

  it('still passes when only a stored key fails but an entered key works', () => {
    const summary = summarizeVerification([
      result({ slot: 'primary', valid: true }),
      result({ slot: 'stored', id: 7, valid: false, code: 'UNKNOWN_ERROR', message: 'Stored key failed.' }),
    ])
    expect(summary.ok).toBe(true)
  })
})
