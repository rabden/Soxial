import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_MODEL_CATALOG,
  CUSTOM_ID_PREFIX,
  LEGACY_MODEL_IDS,
  OPENAI_MODEL_CATALOG,
  apiKeyProviderFor,
  customModelId,
  normalizeModelId,
  parseModelRef,
} from '../electron/main/models'

describe('normalizeModelId', () => {
  it('maps each legacy id onto its current equivalent', () => {
    expect(normalizeModelId('gemini-3.6-flash')).toBe('gemini-3.7-flash')
    expect(normalizeModelId('glm-5.2')).toBe('glm-5.3')
  })

  it('passes through unknown and current ids unchanged', () => {
    expect(normalizeModelId('gemini-3.7-flash')).toBe('gemini-3.7-flash')
    expect(normalizeModelId('glm-5.3')).toBe('glm-5.3')
    expect(normalizeModelId('some-future-model')).toBe('some-future-model')
    expect(normalizeModelId('')).toBe('')
  })

  it('keeps LEGACY_MODEL_IDS scoped to documented renames', () => {
    expect(Object.keys(LEGACY_MODEL_IDS).sort()).toEqual(['gemini-3.6-flash', 'glm-5.2'])
  })
})

describe('parseModelRef', () => {
  it('classifies bare legacy ids by prefix', () => {
    expect(parseModelRef('gemini-3.7-flash')).toEqual({ kind: 'google', modelId: 'gemini-3.7-flash' })
    expect(parseModelRef('glm-5.3')).toEqual({ kind: 'zhipu', modelId: 'glm-5.3' })
  })

  it('normalizes legacy aliases before classifying', () => {
    expect(parseModelRef('glm-5.2').modelId).toBe('glm-5.3')
  })

  it('splits hosted provider namespaces', () => {
    expect(parseModelRef('openai/gpt-4o')).toEqual({ kind: 'openai', modelId: 'gpt-4o' })
    expect(parseModelRef('anthropic/claude-sonnet-4-5')).toEqual({ kind: 'anthropic', modelId: 'claude-sonnet-4-5' })
  })

  it('splits custom provider ids, keeping the model id intact', () => {
    expect(parseModelRef('custom/7/qwen-3-235b')).toEqual({ kind: 'custom', customProviderId: 7, modelId: 'qwen-3-235b' })
    expect(parseModelRef('custom/12/deepseek/v3.1')).toEqual({ kind: 'custom', customProviderId: 12, modelId: 'deepseek/v3.1' })
  })

  it('degrades malformed custom ids to an unusable NaN provider', () => {
    const ref = parseModelRef('custom/not-a-number')
    expect(ref.kind).toBe('custom')
    expect(ref.customProviderId).toBeNaN()
  })

  it('round-trips customModelId through parseModelRef', () => {
    const id = customModelId(3, 'llama-4-maverick')
    expect(id.startsWith(CUSTOM_ID_PREFIX)).toBe(true)
    expect(parseModelRef(id)).toEqual({ kind: 'custom', customProviderId: 3, modelId: 'llama-4-maverick' })
  })
})

describe('apiKeyProviderFor', () => {
  it('maps every hosted kind onto its api_keys provider row family', () => {
    expect(apiKeyProviderFor('google')).toBe('google')
    expect(apiKeyProviderFor('zhipu')).toBe('zhipu')
    expect(apiKeyProviderFor('openai')).toBe('openai')
    expect(apiKeyProviderFor('anthropic')).toBe('anthropic')
  })
})

describe('hosted catalogs', () => {
  it('exposes unique, non-empty model ids with labels', () => {
    for (const catalog of [OPENAI_MODEL_CATALOG, ANTHROPIC_MODEL_CATALOG]) {
      const ids = catalog.map(m => m.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const entry of catalog) {
        expect(entry.id.trim()).not.toBe('')
        expect(entry.label.trim()).not.toBe('')
      }
    }
  })
})
