// Provider instantiation + dynamic fallback chains. Model-id parsing lives in
// models.ts (dependency-free, so db.ts can use it too); this module adds the
// AI-SDK-facing half: turning a ModelRef + credential into a callable model,
// and assembling the chat fallback chain from whatever credentials exist.
import type { LanguageModel } from 'ai'
import {
  getProfile,
  getActiveKeyCountForProvider,
  listActiveCustomProviders,
  getCustomProviderCredential,
} from './db'
import {
  customModelId,
  GOOGLE_MODEL_CATALOG,
  ZHIPU_MODEL_CATALOG,
  OPENAI_MODEL_CATALOG,
  ANTHROPIC_MODEL_CATALOG,
  type ModelRef,
} from './models'
import { logger } from './log'

export {
  parseModelRef,
  customModelId,
  GOOGLE_MODEL_CATALOG,
  ZHIPU_MODEL_CATALOG,
  OPENAI_MODEL_CATALOG,
  ANTHROPIC_MODEL_CATALOG,
} from './models'
export type { ModelRef, ProviderKind } from './models'
import type { ProviderKind } from './models'

export function zhipuBaseUrl(codingPlan: boolean): string {
  return codingPlan ? 'https://api.z.ai/api/coding/paas/v4' : 'https://api.z.ai/api/paas/v4'
}

/**
 * Instantiate a language model for any supported provider. The returned value
 * is an AI SDK LanguageModel; callers treat it opaquely.
 */
export async function createModelInstance(ref: ModelRef, apiKey: string): Promise<LanguageModel> {
  switch (ref.kind) {
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      return createGoogle({ apiKey })(ref.modelId)
    }
    case 'zhipu': {
      const { createZhipu } = await import('zhipu-ai-provider')
      return createZhipu({ baseURL: zhipuBaseUrl(getProfile()?.zai_coding_plan === 1), apiKey })(ref.modelId as any)
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(ref.modelId)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(ref.modelId)
    }
    case 'custom': {
      const row = ref.customProviderId !== undefined ? getCustomProviderCredential(ref.customProviderId) : null
      if (!row) throw new Error(`Custom provider #${ref.customProviderId} is missing or disabled.`)
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ baseURL: row.baseUrl, apiKey })(ref.modelId)
    }
  }
}

/** Does this provider family have at least one usable credential configured? */
function hasKeysFor(kind: Exclude<ProviderKind, 'custom'>): boolean {
  return getActiveKeyCountForProvider(kind) > 0
}

/**
 * Dynamic chat fallback chain: google/zhipu first (historical ordering), then
 * OpenAI, Anthropic, and every active custom endpoint's own model order (first
 * three models each, so one noisy endpoint cannot dominate the chain). No tier
 * gating — a configured provider contributes its full catalog; exhaustion
 * marking handles per-key cooldowns at attempt time. Providers without
 * credentials contribute nothing; the result always has at least one entry so
 * the agent loop stays well-formed.
 */
export function buildChatFallbackChain(): string[] {
  const chain: string[] = []

  if (hasKeysFor('google')) chain.push(...GOOGLE_MODEL_CATALOG.map(m => m.id))
  if (hasKeysFor('zhipu')) chain.push(...ZHIPU_MODEL_CATALOG.map(m => m.id))

  if (hasKeysFor('openai')) chain.push(...OPENAI_MODEL_CATALOG.map(m => `openai/${m.id}`))
  if (hasKeysFor('anthropic')) chain.push(...ANTHROPIC_MODEL_CATALOG.map(m => `anthropic/${m.id}`))

  for (const provider of listActiveCustomProviders()) {
    for (const model of provider.models.slice(0, 3)) {
      chain.push(customModelId(provider.id, model.id))
    }
  }

  if (chain.length === 0) {
    logger.warn('providers', 'no provider credentials found anywhere; using default google fallback')
    return ['gemini-3.5-flash-lite']
  }
  return chain
}
