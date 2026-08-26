import { describe, expect, it } from 'vitest'
import { LEGACY_MODEL_IDS, PRO_MODELS, normalizeModelId, requiredTierFor } from '../electron/main/models'

describe('requiredTierFor', () => {
  it('returns pro for every current pro-tier id', () => {
    expect(requiredTierFor('gemini-3.1-pro')).toBe('pro')
    expect(requiredTierFor('glm-5.3')).toBe('pro')
    expect(requiredTierFor('glm-5-turbo')).toBe('pro')
  })

  it('returns undefined for flash and lower-tier ids', () => {
    expect(requiredTierFor('gemini-3.7-flash')).toBeUndefined()
    expect(requiredTierFor('gemini-3.5-flash-lite')).toBeUndefined()
    expect(requiredTierFor('gemma-4-31b-it')).toBeUndefined()
    expect(requiredTierFor('glm-4.7-flash')).toBeUndefined()
    expect(requiredTierFor('glm-4.5-flash')).toBeUndefined()
  })

  it('resolves legacy aliases before classification', () => {
    expect(requiredTierFor('glm-5.2')).toBe('pro')
    expect(requiredTierFor('gemini-3.6-flash')).toBeUndefined()
  })

  it('returns undefined for unknown ids', () => {
    expect(requiredTierFor('not-a-model')).toBeUndefined()
    expect(requiredTierFor('')).toBeUndefined()
  })
})

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
})

describe('model tables', () => {
  it('keeps PRO_MODELS scoped to the pro set', () => {
    expect([...PRO_MODELS].sort()).toEqual(['gemini-3.1-pro', 'glm-5-turbo', 'glm-5.3'])
  })

  it('keeps LEGACY_MODEL_IDS scoped to documented renames', () => {
    expect(Object.keys(LEGACY_MODEL_IDS).sort()).toEqual(['gemini-3.6-flash', 'glm-5.2'])
  })
})
