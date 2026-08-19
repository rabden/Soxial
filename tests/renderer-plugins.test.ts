import { describe, expect, it } from 'vitest'
import { curatedCodePlugin } from '../src/lib/curated-code-plugin'
import { lazyMermaidPlugin } from '../src/lib/lazy-mermaid-plugin'

describe('rich renderer plugins', () => {
  it('supports curated languages and falls back for unsupported fences', () => {
    expect(curatedCodePlugin.supportsLanguage('typescript')).toBe(true)
    expect(curatedCodePlugin.supportsLanguage('js')).toBe(true)
    expect(curatedCodePlugin.supportsLanguage('rust')).toBe(false)
    expect(curatedCodePlugin.getSupportedLanguages()).toHaveLength(12)
  })

  it('keeps Mermaid behind a render-time dynamic import', () => {
    expect(lazyMermaidPlugin.language).toBe('mermaid')
    expect(lazyMermaidPlugin.getMermaid().render).toBeTypeOf('function')
  })
})
