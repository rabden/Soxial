import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userDataDir = mkdtempSync(join(tmpdir(), 'soxial-providers-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
}))

import {
  addApiKey,
  addCustomProvider,
  getAvailableApiKeyForModel,
  getAvailableModels,
  getCustomProviderCredential,
  getDb,
  isModelExhaustedForAllKeys,
  listActiveCustomProviders,
  removeCustomProvider,
  updateCustomProvider,
} from '../electron/main/db'
import { buildChatFallbackChain, customModelId } from '../electron/main/providers'

beforeAll(() => {
  // Open the singleton against the mocked temp dir; schema + custom_providers
  // table must both initialize without error.
  getAvailableModels()
})

beforeEach(() => {
  // Reset provider state between tests; the db module is a singleton.
  getDb().prepare('DELETE FROM api_keys').run()
  getDb().prepare('DELETE FROM custom_providers').run()
})

describe('buildChatFallbackChain', () => {
  it('falls back to the default google model when no credentials exist', () => {
    expect(buildChatFallbackChain()).toEqual(['gemini-3.5-flash-lite'])
  })

  it('appends the full hosted catalogs once a provider has a key', () => {
    addApiKey('sk-test-openai', 'openai')
    const chain = buildChatFallbackChain()
    expect(chain).toContain('openai/gpt-5.6-luna')
    expect(chain).toContain('openai/gpt-5.4-mini')
    expect(chain.some(id => id.startsWith('anthropic/'))).toBe(false)
  })

  it('contributes at most three models per custom endpoint', () => {
    const id = addCustomProvider({
      name: 'local-gateway',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKey: 'local-key',
      models: [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
        { id: 'delta', label: 'Delta' },
        { id: 'epsilon', label: 'Epsilon' },
      ],
    })
    const chain = buildChatFallbackChain()
    expect(chain).toContain(customModelId(id, 'alpha'))
    expect(chain).toContain(customModelId(id, 'gamma'))
    expect(chain).not.toContain(customModelId(id, 'delta'))

    // The picker catalog is not capped: every model stays selectable.
    const models = getAvailableModels()
    for (const model of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      expect(models).toContain(customModelId(id, model))
    }
  })
})

describe('custom provider credentials', () => {
  it('stores, keeps on unrelated updates, and clears the credential', () => {
    const id = addCustomProvider({
      name: 'gateway',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'secret-one',
      models: [{ id: 'm1', label: 'M1' }],
    })
    expect(getCustomProviderCredential(id)?.apiKey).toBe('secret-one')

    updateCustomProvider(id, { name: 'renamed' })
    expect(getCustomProviderCredential(id)?.apiKey).toBe('secret-one')
    expect(getCustomProviderCredential(id)?.name).toBe('renamed')

    updateCustomProvider(id, { apiKey: 'secret-two' })
    expect(getCustomProviderCredential(id)?.apiKey).toBe('secret-two')

    updateCustomProvider(id, { apiKey: '' })
    expect(getCustomProviderCredential(id)?.apiKey).toBe('')
  })

  it('deactivates on remove and drops its models from the picker', () => {
    const id = addCustomProvider({
      name: 'temp',
      baseUrl: 'https://temp.example.com/v1',
      models: [{ id: 'only-model', label: 'Only' }],
    })
    expect(getAvailableModels()).toContain(customModelId(id, 'only-model'))

    expect(removeCustomProvider(id)).toBe(true)
    expect(listActiveCustomProviders().find(p => p.id === id)).toBeUndefined()
    expect(getAvailableModels()).not.toContain(customModelId(id, 'only-model'))
    expect(getCustomProviderCredential(id)).toBeNull()
  })
})

describe('hosted key resolution', () => {
  it('resolves namespaced ids through their own provider family', () => {
    const keyId = addApiKey('sk-resolve-me', 'openai')
    const resolved = getAvailableApiKeyForModel('openai/gpt-5.6-luna')
    expect(resolved?.id).toBe(keyId)
    expect(resolved?.api_key).toBe('sk-resolve-me')
  })

  it('never routes custom endpoint ids into the api_keys pool', () => {
    expect(getAvailableApiKeyForModel('custom/9/some-model')).toBeNull()
    expect(isModelExhaustedForAllKeys('custom/9/some-model')).toBe(false)
  })
})
