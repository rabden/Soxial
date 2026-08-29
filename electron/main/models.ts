// electron/main/models.ts — single owner of model-id policy. Persistence stays in db.ts;
// this module classifies, never stores. A small typed module beats scattering string
// comparisons across call sites — the same house pattern as GeneratedImage { path, backend }
// in puter.ts: one lightweight typed home for the knowledge, so a rename edits this file
// instead of five hand-copied predicates and parallel alias maps that drift apart.

/** Model ids saved before renames resolve onto their current equivalents. */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  'gemini-3.6-flash': 'gemini-3.7-flash',
  'glm-5.2': 'glm-5.3',
  'glm-5-turbo': 'glm-5.3-flash',
  'openai/gpt-5.2': 'openai/gpt-5.6-luna',
  'openai/gpt-5-mini': 'openai/gpt-5.4-mini',
  'openai/gpt-4.1': 'openai/gpt-5.5',
  'openai/gpt-4o': 'openai/gpt-5.6-luna',
  'anthropic/claude-opus-4-1': 'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-4-5': 'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4-5': 'anthropic/claude-sonnet-5',
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

export const GOOGLE_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
]

export const ZHIPU_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'glm-5.3', label: 'GLM 5.3' },
  { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash' },
  { id: 'glm-4.7-flash', label: 'GLM 4.7 Flash' },
  { id: 'glm-4.5-flash', label: 'GLM 4.5 Flash' },
  { id: 'glm-4.6v-flash', label: 'GLM 4.6V Flash' },
]

/**
 * Default catalogs for the built-in hosted providers — starting points, not
 * walls; user-defined custom endpoints cover anything not listed here.
 * OpenAI default is gpt-5.6-luna, Anthropic default is claude-sonnet-5 — they
 * sit first so the fallback chain tries the default first.
 */
export const OPENAI_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
]

export const ANTHROPIC_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
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

// ─── Vision capability ──────────────────────────────────────────────────────
// Central truth for which models can see images. Used by the one-shot drafter
// and the main agent's image handling. Kept here so a model swap edits one place.

const GOOGLE_VISION_IDS = new Set(['gemini-3.7-flash', 'gemini-3.1-pro', 'gemini-3.5-flash-lite'])
const ZHIPU_VISION_IDS = new Set(['glm-5.3-flash', 'glm-4.6v-flash'])

export function isVisionCapable(modelId: string): boolean {
  const ref = parseModelRef(modelId)
  if (ref.kind === 'google') return GOOGLE_VISION_IDS.has(ref.modelId)
  if (ref.kind === 'zhipu') return ZHIPU_VISION_IDS.has(ref.modelId)
  if (ref.kind === 'openai' || ref.kind === 'anthropic') return true
  // Custom endpoints: assume vision capable — the caller will discover otherwise.
  if (ref.kind === 'custom') return true
  return false
}
