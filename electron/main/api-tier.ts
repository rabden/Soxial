import { generateText } from 'ai'
import { createGoogle } from '@ai-sdk/google'
import { getApiTier, setApiTier, getApiKeys, updateApiKeyTier, getProfile } from './db'
import { logger } from './log'

async function testApiKeyTier(apiKey: string): Promise<'free' | 'pro'> {
  try {
    // Minimal probe: if gemini-3.1-pro succeeds, the key is pro tier.
    // A 429 / quota error means free tier.
    await generateText({
      model: createGoogle({ apiKey }).interactions('gemini-3.1-pro'),
      prompt: 'Respond with just "OK"',
      maxOutputTokens: 2,
      maxRetries: 0,
    })
    return 'pro'
  } catch (error: any) {
    const errorMessage = error?.message || ''
    const status = error?.status || error?.statusCode || error?.code
    const errorStatus = error?.error?.status || error?.error?.code

    if (
      status === 429 ||
      errorStatus === 'RESOURCE_EXHAUSTED' ||
      errorStatus === 429 ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('RESOURCE_EXHAUSTED') ||
      errorMessage.includes('429')
    ) {
      return 'free'
    }

    // Auth/other errors → assume free for safety
    return 'free'
  }
}

async function testZhipuApiKeyTier(apiKey: string, baseURL: string): Promise<'free' | 'pro'> {
  try {
    const { createZhipu } = await import('zhipu-ai-provider')
    const zhipu = createZhipu({ baseURL, apiKey })

    // Probe via glm-5.3 (Pro tier only)
    await generateText({
      model: zhipu('glm-5.3'),
      prompt: 'Respond with just "OK"',
      maxOutputTokens: 2,
      maxRetries: 0,
    })
    return 'pro'
  } catch (error: any) {
    // 429 / quota / permission denied for glm-5.3 → classify as 'free'
    logger.info('api-tier', `Zhipu tier probe failed: ${(error?.message || '').substring(0, 120)}`)
    return 'free'
  }
}

export async function detectApiTier(force: boolean = false): Promise<'free' | 'pro'> {
  const currentTier = getApiTier()

  if (!force && currentTier.last_verified_at) {
    const lastVerified = new Date(currentTier.last_verified_at)
    const hoursSince = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60)
    if (hoursSince < 24) {
      logger.info('api-tier', `using cached tier: ${currentTier.tier} (verified ${hoursSince.toFixed(1)}h ago)`)
      return currentTier.tier as 'free' | 'pro'
    }
  }

  logger.info('api-tier', 'detecting API tier for all keys')

  let hasProKey = false

  // 1. Detect Google key tiers
  const googleKeys = getApiKeys('google')
  for (const key of googleKeys) {
    logger.info('api-tier', `testing tier for Google API key: ${key.name}`)
    const tier = await testApiKeyTier(key.api_key)
    logger.info('api-tier', `Google key ${key.name} detected as ${tier} tier`)
    updateApiKeyTier(key.id, tier)
    if (tier === 'pro') hasProKey = true
  }

  // 2. Detect Z.AI (Zhipu) key tiers
  const profile = getProfile()
  const zaiBaseURL = profile?.zai_coding_plan
    ? 'https://api.z.ai/api/coding/paas/v4'
    : 'https://api.z.ai/api/paas/v4'

  const zhipuKeys = getApiKeys('zhipu')
  for (const key of zhipuKeys) {
    // Coding plan has no free tier — always pro, skip probe
    if (profile?.zai_coding_plan) {
      logger.info('api-tier', `Z.AI key ${key.name} is coding plan → forced pro`)
      updateApiKeyTier(key.id, 'pro')
      hasProKey = true
      continue
    }
    logger.info('api-tier', `testing tier for Z.AI API key: ${key.name}`)
    const tier = await testZhipuApiKeyTier(key.api_key, zaiBaseURL)
    logger.info('api-tier', `Z.AI key ${key.name} detected as ${tier} tier`)
    updateApiKeyTier(key.id, tier)
    if (tier === 'pro') hasProKey = true
  }

  // 3. Test primary profile keys (in case they weren't synced to api_keys yet)
  const primaryGoogle = profile?.gemini_api_key || process.env.GEMINI_API_KEY
  if (primaryGoogle) {
    logger.info('api-tier', 'testing tier for primary Google profile API key')
    const tier = await testApiKeyTier(primaryGoogle)
    logger.info('api-tier', `Primary Google API key detected as ${tier} tier`)
    if (tier === 'pro') hasProKey = true
  }

  const primaryZhipu = profile?.zai_api_key
  if (primaryZhipu) {
    logger.info('api-tier', 'testing tier for primary Z.AI profile API key')
    const tier = await testZhipuApiKeyTier(primaryZhipu, zaiBaseURL)
    logger.info('api-tier', `Primary Z.AI API key detected as ${tier} tier`)
    if (tier === 'pro') hasProKey = true
  }

  const globalTier = hasProKey ? 'pro' : 'free'
  setApiTier(globalTier)
  logger.info('api-tier', `global tier set to ${globalTier} based on key capabilities`)

  return globalTier
}

export async function verifyApiTier(): Promise<'free' | 'pro'> {
  logger.info('api-tier', 'verifying API tier')
  const tier = await detectApiTier()
  logger.info('api-tier', `verified API tier: ${tier}`)
  return tier
}
