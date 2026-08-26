import { ipcMain } from 'electron'
import {
  addApiKey,
  getApiKeys,
  getApiTier,
  getAvailableModels,
  getDefaultModel,
  getModelExhaustionStatus,
  getSelectedModel,
  removeApiKey,
  setSelectedModel,
} from '../db'
import { credentialSuffix } from '../credentials'
import { detectApiTier } from '../api-tier'
import {
  CredentialVerificationReport,
  ProviderVerificationRequest,
  ProviderVerificationResult,
  summarizeVerification,
  verifyCredential,
} from '../provider-verification'
import { logger } from '../log'
import { cancelInteractivePuterSignIn, openPuterSignInPage } from '../puter-auth'

export function registerApiHandlers(): void {
  ipcMain.handle('api:getTier', () => getApiTier())
  ipcMain.handle('api:getAvailableModels', () => getAvailableModels())
  ipcMain.handle('api:getDefaultModel', () => getDefaultModel())
  ipcMain.handle('api:getSelectedModel', () => getSelectedModel())
  ipcMain.handle('api:setSelectedModel', (_event, model: string) => setSelectedModel(model))
  ipcMain.handle('api:getApiKeys', (_event, provider: string = 'google') => (
    getApiKeys(provider).map(({ api_key, ...key }) => ({
      ...key,
      masked: api_key ? credentialSuffix(api_key) : null,
      configured: Boolean(api_key),
    }))
  ))
  ipcMain.handle('api:addApiKey', (_event, apiKey: string, provider: string = 'google') => {
    if (!apiKey.trim()) throw new Error('API key cannot be empty')
    if (!['google', 'zhipu'].includes(provider)) throw new Error('Unsupported API key provider')
    return addApiKey(apiKey.trim(), provider)
  })
  ipcMain.handle('api:removeApiKey', (_event, id: number) => {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid API key ID')
    return removeApiKey(id)
  })
  ipcMain.handle('api:getModelExhaustionStatus', (_event, model: string) => getModelExhaustionStatus(model))
  ipcMain.handle('api:detectTier', (_event, force?: boolean) => detectApiTier(force))
  ipcMain.handle('puter:authCancel', () => cancelInteractivePuterSignIn())
  ipcMain.handle('puter:authOpen', () => openPuterSignInPage())

  ipcMain.handle('api:verifyCredentials', async (_event, request: ProviderVerificationRequest): Promise<CredentialVerificationReport> => {
    const payload = request && typeof request === 'object' ? request : {}
    const results: ProviderVerificationResult[] = []

    for (const provider of ['google', 'zhipu'] as const) {
      const providerRequest = payload[provider]
      if (!providerRequest) continue
      const codingPlan = provider === 'zhipu' ? Boolean(payload.zhipu?.codingPlan) : undefined

      const primary = typeof providerRequest.primary === 'string' ? providerRequest.primary.trim() : ''
      if (primary) {
        results.push(await verifyCredential({ provider, slot: 'primary' }, primary, { codingPlan }))
      }

      const additional = Array.isArray(providerRequest.additional) ? providerRequest.additional : []
      for (const [index, value] of additional.entries()) {
        if (typeof value !== 'string' || !value.trim()) continue
        results.push(await verifyCredential({ provider, slot: 'additional', index }, value.trim(), { codingPlan }))
      }

      // Stored keys are verified by id so their secrets never reach the renderer.
      const storedIds = Array.isArray(providerRequest.storedKeyIds) ? providerRequest.storedKeyIds : []
      if (storedIds.length > 0) {
        const stored = getApiKeys(provider)
        for (const id of storedIds) {
          if (!Number.isInteger(id)) continue
          const row = stored.find(key => key.id === id)
          if (!row?.api_key) continue
          results.push(await verifyCredential({ provider, slot: 'stored', id }, row.api_key, { codingPlan }))
        }
      }
    }

    const summary = summarizeVerification(results)

    // Tier detection is meaningful only once a credential is known to work.
    let tier: 'free' | 'pro' | 'unknown' = 'unknown'
    if (summary.ok) {
      try {
        tier = await detectApiTier(true)
      } catch (error) {
        logger.warn('provider-verification', `tier detection after verification failed: ${(error as Error).message}`)
      }
    }

    return { ok: summary.ok, results, tier, message: summary.message }
  })
}
