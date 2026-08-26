// electron/main/models.ts — single owner of model-id policy. Persistence stays in db.ts;
// this module classifies, never stores. A small typed module beats scattering string
// comparisons across call sites — the same house pattern as GeneratedImage { path, backend }
// in puter.ts: one lightweight typed home for the knowledge, so a rename edits this file
// instead of five hand-copied predicates and parallel alias maps that drift apart.

/** Model ids saved before renames resolve onto their current equivalents. */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  'gemini-3.6-flash': 'gemini-3.7-flash',
  'glm-5.2': 'glm-5.3',
}

export function normalizeModelId(model: string): string {
  return LEGACY_MODEL_IDS[model] ?? model
}

// ─── Provider-namespaced model ids ──────────────────────────────────────────
//
//   gemini-*            → Google        (legacy bare ids stay valid)
//   glm-*               → Z.AI/Zhipu    (legacy bare ids stay valid)
//   openai/<model>      → OpenAI
//   anthropic/<model>   → Anthropic
//   custom/<id>/<model> → user-defined OpenAI-compatible endpoint

export type ProviderKind = 'google' | 'zhipu' | 'openai' | 'anthropic' | 'custom'

export interface ModelRef {
  kind: ProviderKind
  /** Bare model id within the provider ('gemini-3.7-flash', 'gpt-4o', …). */
  modelId: string
  /** Row id in custom_providers; set iff kind === 'custom'. */
  customProviderId?: number
}

export const OPENAI_ID_PREFIX = 'openai/'
export const ANTHROPIC_ID_PREFIX = 'anthropic/'
export const CUSTOM_ID_PREFIX = 'custom/'

/**
 * Default catalogs for the built-in hosted providers — starting points, not
 * walls; user-defined custom endpoints cover anything not listed here.
 */
export const OPENAI_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gpt-5.2', label: 'GPT-5.2' },
  { id: 'gpt-5-mini', label: 'GPT-5 mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4o' },
]

export const ANTHROPIC_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

/** Compose a fully-qualified model id from a custom provider row and bare model id. */
export function customModelId(providerId: number, modelId: string): string {
  return `${CUSTOM_ID_PREFIX}${providerId}/${modelId}`
}

export function parseModelRef(rawModel: string): ModelRef {
  const model = normalizeModelId(rawModel)
  if (model.startsWith(OPENAI_ID_PREFIX)) return { kind: 'openai', modelId: model.slice(OPENAI_ID_PREFIX.length) }
  if (model.startsWith(ANTHROPIC_ID_PREFIX)) return { kind: 'anthropic', modelId: model.slice(ANTHROPIC_ID_PREFIX.length) }
  if (model.startsWith(CUSTOM_ID_PREFIX)) {
    const rest = model.slice(CUSTOM_ID_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash > 0) {
      const id = Number(rest.slice(0, slash))
      if (Number.isFinite(id) && id > 0) return { kind: 'custom', customProviderId: id, modelId: rest.slice(slash + 1) }
    }
    return { kind: 'custom', customProviderId: Number.NaN, modelId: rest }
  }
  return { kind: model.startsWith('glm') ? 'zhipu' : 'google', modelId: model }
}

/**
 * Which api_keys.provider row family serves this model ref. Custom endpoints
 * store their credential on their own row, never in api_keys.
 */
export function apiKeyProviderFor(kind: ProviderKind): string {
  return kind
}
