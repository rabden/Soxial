// Credential verification for AI providers.
//
// Verification answers one question only: "does this credential work?" Tier
// detection used to conflate these concerns by treating every non-quota
// failure as "free" for safety, which makes it useless for deciding
// whether a credential actually works. Verification must tell an invalid key
// apart from a valid-but-rate-limited key, a network blip, and a missing model.
//
// No raw credential ever leaves this module: results carry only a masked
// suffix.

import { generateText } from 'ai'
import { createGoogle } from '@ai-sdk/google'
import { credentialSuffix } from './credentials'
import { logger } from './log'
import { OPENAI_MODEL_CATALOG, ANTHROPIC_MODEL_CATALOG } from './models'

export type ProviderName = 'google' | 'zhipu' | 'openai' | 'anthropic'

export type VerificationCode =
  | 'VALID'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'MODEL_UNAVAILABLE'
  | 'UNKNOWN_ERROR'

/** Where a credential came from, so the UI can focus the right field. */
export type CredentialSlot = 'primary' | 'additional' | 'stored'

export interface CredentialRef {
  provider: ProviderName
  slot: CredentialSlot
  index?: number
  id?: number
}

export interface ProviderVerificationResult extends CredentialRef {
  valid: boolean
  code: VerificationCode
  message: string
  masked: string | null
}

export interface ProviderVerificationRequest {
  google?: ProviderVerificationSection
  zhipu?: ProviderVerificationSection & { codingPlan?: boolean }
  openai?: ProviderVerificationSection
  anthropic?: ProviderVerificationSection
}

interface ProviderVerificationSection {
  primary?: string
  additional?: string[]
  storedKeyIds?: number[]
}

export interface CredentialVerificationReport {
  ok: boolean
  results: ProviderVerificationResult[]
  message: string
}

// Cheap catalog models, so verification never fails just because the account
// lacks access to the flagship models.
export const GOOGLE_PROBE_MODEL = 'gemini-3.5-flash-lite'
export const ZHIPU_PROBE_MODEL = 'glm-4.7-flash'
export const OPENAI_PROBE_MODEL = OPENAI_MODEL_CATALOG[OPENAI_MODEL_CATALOG.length - 1].id
export const ANTHROPIC_PROBE_MODEL = ANTHROPIC_MODEL_CATALOG[ANTHROPIC_MODEL_CATALOG.length - 1].id

export function zhipuBaseUrl(codingPlan?: boolean): string {
  return codingPlan
    ? 'https://api.z.ai/api/coding/paas/v4'
    : 'https://api.z.ai/api/paas/v4'
}

function errorText(error: unknown): string {
  const err = error as any
  return [
    err?.message,
    err?.error?.message,
    err?.responseBody,
    err?.cause?.message,
    typeof err === 'string' ? err : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function errorStatus(error: unknown): number | null {
  const err = error as any
  const candidates = [err?.status, err?.statusCode, err?.error?.code, err?.error?.status, err?.cause?.status]
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate
  }
  return null
}

/**
 * Classify a probe failure. Pure so it can be tested without network access.
 *
 * `valid` answers "did this credential authenticate?", which is not the same as
 * "did the probe succeed". A quota-limited key is authenticated and usable.
 */
export function classifyProviderProbeError(error: unknown): {
  valid: boolean
  code: VerificationCode
  message: string
} {
  const text = errorText(error)
  const status = errorStatus(error)
  const statusText = typeof (error as any)?.error?.status === 'string'
    ? String((error as any).error.status).toLowerCase()
    : ''

  const isRateLimited =
    status === 429
    || statusText === 'resource_exhausted'
    || text.includes('resource_exhausted')
    || text.includes('quota')
    || text.includes('rate limit')
    || text.includes('too many requests')

  if (isRateLimited) {
    return {
      valid: true,
      code: 'RATE_LIMITED',
      message: 'Key is valid but currently rate limited. You can continue.',
    }
  }

  const isNetwork =
    text.includes('fetch failed')
    || text.includes('econnreset')
    || text.includes('econnrefused')
    || text.includes('enotfound')
    || text.includes('etimedout')
    || text.includes('network')
    || text.includes('socket hang up')
    || text.includes('timeout')

  if (isNetwork) {
    return {
      valid: false,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the provider. Check your connection and try again.',
    }
  }

  const isAuth =
    status === 401
    || status === 403
    || statusText === 'permission_denied'
    || statusText === 'unauthenticated'
    || text.includes('api key not valid')
    || text.includes('api_key_invalid')
    || text.includes('invalid api key')
    || text.includes('invalid authentication')
    || text.includes('unauthorized')
    || text.includes('unauthenticated')
    || text.includes('permission denied')

  if (isAuth) {
    return {
      valid: false,
      code: 'INVALID_CREDENTIALS',
      message: 'This API key was rejected by the provider. Check the key and try again.',
    }
  }

  const isModelMissing =
    status === 404
    || statusText === 'not_found'
    || text.includes('model not found')
    || text.includes('is not found')
    || text.includes('not_found')
    || text.includes('does not exist')

  if (isModelMissing) {
    return {
      valid: true,
      code: 'MODEL_UNAVAILABLE',
      message: 'Key authenticated, but the test model is unavailable for this account.',
    }
  }

  return {
    valid: false,
    code: 'UNKNOWN_ERROR',
    message: 'Could not verify this API key. Try again, or use a different key.',
  }
}

/** Probe signature, injectable so tests never touch the network. */
export type CredentialProbe = (provider: ProviderName, apiKey: string, codingPlan?: boolean) => Promise<void>

const liveProbe: CredentialProbe = async (provider, apiKey, codingPlan) => {
  if (provider === 'google') {
    await generateText({
      model: createGoogle({ apiKey })(GOOGLE_PROBE_MODEL),
      prompt: 'Reply with OK',
      maxOutputTokens: 2,
      maxRetries: 0,
    })
    return
  }

  if (provider === 'zhipu') {
    const { createZhipu } = await import('zhipu-ai-provider')
    await generateText({
      model: createZhipu({ baseURL: zhipuBaseUrl(codingPlan), apiKey })(ZHIPU_PROBE_MODEL as any),
      prompt: 'Reply with OK',
      maxOutputTokens: 2,
      maxRetries: 0,
    })
    return
  }

  if (provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    await generateText({
      model: createAnthropic({ apiKey })(ANTHROPIC_PROBE_MODEL),
      prompt: 'Reply with OK',
      maxOutputTokens: 8,
      maxRetries: 0,
    })
    return
  }

  const { createOpenAI } = await import('@ai-sdk/openai')
  await generateText({
    model: createOpenAI({ apiKey })(OPENAI_PROBE_MODEL),
    prompt: 'Reply with OK',
    maxOutputTokens: 16,
    maxRetries: 0,
  })
}

export async function verifyCredential(
  ref: CredentialRef,
  apiKey: string,
  options?: { codingPlan?: boolean; probe?: CredentialProbe },
): Promise<ProviderVerificationResult> {
  const masked = apiKey ? credentialSuffix(apiKey) : null

  if (!apiKey || !apiKey.trim()) {
    return {
      ...ref,
      valid: false,
      code: 'INVALID_CREDENTIALS',
      message: 'API key is empty.',
      masked: null,
    }
  }

  const probe = options?.probe ?? liveProbe
  try {
    await probe(ref.provider, apiKey.trim(), options?.codingPlan)
    return { ...ref, valid: true, code: 'VALID', message: 'Key verified.', masked }
  } catch (error) {
    const classified = classifyProviderProbeError(error)
    // Log the classification only — never the key or the raw provider payload.
    logger.info('provider-verification', `${ref.provider} ${ref.slot} key verification: ${classified.code}`)
    return { ...ref, ...classified, masked }
  }
}

/**
 * A run is acceptable when at least one credential authenticated and no
 * newly entered credential was rejected. Silently dropping a bad key the user
 * just typed would be worse than blocking.
 */
export function summarizeVerification(results: ProviderVerificationResult[]): {
  ok: boolean
  message: string
} {
  if (results.length === 0) {
    return { ok: false, message: 'Add at least one API key to continue.' }
  }

  const entered = results.filter(result => result.slot !== 'stored')
  const rejected = entered.filter(result => !result.valid)
  if (rejected.length > 0) {
    return { ok: false, message: rejected[0].message }
  }

  const usable = results.filter(result => result.valid)
  if (usable.length === 0) {
    const firstFailure = results[0]
    return { ok: false, message: firstFailure?.message ?? 'No usable API key was found.' }
  }

  return { ok: true, message: 'Provider verified.' }
}
