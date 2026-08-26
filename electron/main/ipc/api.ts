import { ipcMain } from 'electron'
import { generateText } from 'ai'
import {
  addApiKey,
  addCustomProvider,
  getApiKeys,
  getAvailableModels,
  getDefaultModel,
  getModelExhaustionStatus,
  getSelectedModel,
  listCustomProviders,
  listActiveCustomProviders,
  getCustomProviderCredential,
  removeApiKey,
  removeCustomProvider,
  setSelectedModel,
  updateCustomProvider,
} from '../db'
import { credentialSuffix } from '../credentials'
import {
  CredentialVerificationReport,
  ProviderVerificationRequest,
  ProviderVerificationResult,
  summarizeVerification,
  verifyCredential,
} from '../provider-verification'
import { logger } from '../log'
import { parseModelRef, OPENAI_MODEL_CATALOG, ANTHROPIC_MODEL_CATALOG } from '../models'
import { cancelInteractivePuterSignIn, openPuterSignInPage } from '../puter-auth'

const CUSTOM_PROVIDER_TIMEOUT_MS = 20_000

export function registerApiHandlers(): void {
  ipcMain.handle('api:getAvailableModels', () => getAvailableModels())
  // Label-aware catalog for the prompt-bar picker: every model of every
  // configured provider, built-ins first, custom endpoints last.
  ipcMain.handle('api:getModelCatalog', () => {
    const ids = getAvailableModels()
    const labels = new Map<string, string>()
    for (const m of OPENAI_MODEL_CATALOG) labels.set(`openai/${m.id}`, m.label)
    for (const m of ANTHROPIC_MODEL_CATALOG) labels.set(`anthropic/${m.id}`, m.label)
    for (const provider of listActiveCustomProviders()) {
      for (const m of provider.models) labels.set(`${provider.id}::${m.id}`, `${provider.name} · ${m.label}`)
    }
    return ids.map(id => {
      const ref = parseModelRef(id)
      if (ref.kind === 'custom' && ref.customProviderId !== undefined) {
        return { id, label: labels.get(`${ref.customProviderId}::${ref.modelId}`) || ref.modelId }
      }
      return { id, label: labels.get(id) || id }
    })
  })
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
    if (!['google', 'zhipu', 'openai', 'anthropic'].includes(provider)) throw new Error('Unsupported API key provider')
    return addApiKey(apiKey.trim(), provider)
  })
  ipcMain.handle('api:removeApiKey', (_event, id: number) => {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid API key ID')
    return removeApiKey(id)
  })
  ipcMain.handle('api:getModelExhaustionStatus', (_event, model: string) => getModelExhaustionStatus(model))
  ipcMain.handle('puter:authCancel', () => cancelInteractivePuterSignIn())
  ipcMain.handle('puter:authOpen', () => openPuterSignInPage())

  // ── Custom OpenAI-compatible providers ───────────────────────────────────
  ipcMain.handle('providers:list', () => (
    listCustomProviders(true).map(provider => {
      const cred = getCustomProviderCredential(provider.id)
      return {
        ...provider,
        hasKey: Boolean(cred?.apiKey),
        keyMasked: cred?.apiKey ? credentialSuffix(cred.apiKey) : null,
      }
    })
  ))

  ipcMain.handle(
    'providers:addCustom',
    (_event, input: { name?: unknown; baseUrl?: unknown; apiKey?: unknown; models?: unknown }) => {
      const parsed = parseCustomProviderInput(input)
      if (!parsed.name || !parsed.baseUrl || !parsed.models) throw new Error('Name, base URL and models are required')
      // A test call before saving is optional; saving without any model is not.
      const id = addCustomProvider({ name: parsed.name, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, models: parsed.models })
      logger.info('providers', `custom provider saved (#${id})`)
      return { id }
    },
  )

  ipcMain.handle(
    'providers:updateCustom',
    (_event, id: unknown, patch: { name?: unknown; baseUrl?: unknown; apiKey?: unknown; models?: unknown }) => {
      if (!Number.isInteger(id) || (id as number) <= 0) throw new Error('Invalid provider ID')
      const parsed = parseCustomProviderInput(patch ?? {}, { partial: true })
      return updateCustomProvider(id as number, parsed as { name?: string; baseUrl?: string; apiKey?: string; models?: Array<{ id: string; label: string }> })
    },
  )

  ipcMain.handle('providers:removeCustom', (_event, id: unknown) => {
    if (!Number.isInteger(id) || (id as number) <= 0) throw new Error('Invalid provider ID')
    return removeCustomProvider(id as number)
  })

  /**
   * Probe a custom endpoint (or an existing one by id) with one tiny
   * completion so the settings UI can show "works / does not work" before
   * the user commits anything.
   */
  ipcMain.handle(
    'providers:testCustom',
    async (_event, input: { baseUrl?: unknown; apiKey?: unknown; model?: unknown; providerId?: unknown }) => {
      let baseUrl: string
      let apiKey: string
      let modelId: string

      const providerId = Number(input?.providerId)
      const stored = Number.isFinite(providerId) && providerId > 0 ? getCustomProviderCredential(providerId) : null

      if (!stored && typeof input?.baseUrl === 'string' && input.baseUrl.trim()) {
        baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
        apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
        modelId = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : ''
      } else if (stored) {
        baseUrl = stored.baseUrl
        apiKey = input?.apiKey != null && String(input.apiKey).trim() ? String(input.apiKey).trim() : stored.apiKey
        modelId = typeof input?.model === 'string' && input.model.trim() ? input.model.trim() : stored.models[0]?.id || ''
      } else {
        return { ok: false, error: 'Nothing to test: provide a base URL or pick a saved provider.' }
      }

      if (!baseUrl) return { ok: false, error: 'Base URL is required.' }
      try { void new URL(baseUrl) } catch { return { ok: false, error: 'Base URL is not a valid URL.' } }
      if (!apiKey) return { ok: false, error: 'API key is required for this endpoint.' }
      if (!modelId) return { ok: false, error: 'Model name is required for this endpoint.' }

      try {
        const { createOpenAI } = await import('@ai-sdk/openai')
        const model = createOpenAI({ baseURL: baseUrl, apiKey })(modelId)
        const { text } = await generateText({
          model,
          prompt: 'Reply with exactly: OK',
          maxOutputTokens: 16,
          abortSignal: AbortSignal.timeout(CUSTOM_PROVIDER_TIMEOUT_MS),
        })
        logger.info('providers', `custom endpoint test ok (${baseUrl}, model ${modelId})`)
        return { ok: true, sample: text.slice(0, 80) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('providers', `custom endpoint test failed (${baseUrl}, model ${modelId}): ${message}`)
        return { ok: false, error: message.slice(0, 300) }
      }
    },
  )

  ipcMain.handle('api:verifyCredentials', async (_event, request: ProviderVerificationRequest): Promise<CredentialVerificationReport> => {
    const payload = request && typeof request === 'object' ? request : {}
    const results: ProviderVerificationResult[] = []

    for (const provider of ['google', 'zhipu', 'openai', 'anthropic'] as const) {
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
    // Verification only answers "does this key work?" — no tier detection.
    return { ok: summary.ok, results, message: summary.message }
  })
}

/** Validate renderer-supplied custom-provider fields into db-shaped input. */
function parseCustomProviderInput(
  input: { name?: unknown; baseUrl?: unknown; apiKey?: unknown; models?: unknown },
  options: { partial?: boolean } = {},
): { name?: string; baseUrl?: string; apiKey?: string; models?: Array<{ id: string; label: string }> } {
  const out: ReturnType<typeof parseCustomProviderInput> = {}

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Provider name is required')
    out.name = input.name.trim()
  } else if (!options.partial) throw new Error('Provider name is required')

  if (input.baseUrl !== undefined) {
    if (typeof input.baseUrl !== 'string' || !input.baseUrl.trim()) throw new Error('Base URL is required')
    const trimmed = input.baseUrl.trim().replace(/\/+$/, '')
    try { void new URL(trimmed) } catch { throw new Error('Base URL is not a valid URL') }
    out.baseUrl = trimmed
  } else if (!options.partial) throw new Error('Base URL is required')

  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string') throw new Error('API key must be a string')
    out.apiKey = input.apiKey.trim()
  }

  if (input.models !== undefined) {
    if (!Array.isArray(input.models)) throw new Error('Models must be a list')
    const models = input.models
      .map((m: any) =>
        typeof m === 'string'
          ? { id: m.trim(), label: m.trim() }
          : m && typeof m.id === 'string'
            ? { id: m.id.trim(), label: (typeof m.label === 'string' && m.label.trim()) || m.id.trim() }
            : null,
      )
      .filter((m): m is { id: string; label: string } => Boolean(m && m.id))
    if (models.length === 0 && !options.partial) throw new Error('At least one model name is required')
    out.models = models
  } else if (!options.partial) throw new Error('At least one model name is required')

  return out
}
