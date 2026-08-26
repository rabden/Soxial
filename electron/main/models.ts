// electron/main/models.ts — single owner of model-id policy. Persistence stays in db.ts;
// this module classifies, never stores. A small typed module beats scattering string
// comparisons across call sites — the same house pattern as GeneratedImage { path, backend }
// in puter.ts: one lightweight typed home for the knowledge, so a rename edits this file
// instead of five hand-copied predicates and parallel alias maps that drift apart.
export const PRO_MODELS: ReadonlySet<string> = new Set([
  'gemini-3.1-pro',
  'glm-5.3',
  'glm-5-turbo',
])

/** Model ids saved before renames resolve onto their current equivalents. */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  'gemini-3.6-flash': 'gemini-3.7-flash',
  'glm-5.2': 'glm-5.3',
}

export function normalizeModelId(model: string): string {
  return LEGACY_MODEL_IDS[model] ?? model
}

/** Tier an API key must hold to serve this model; undefined = any active key. */
export function requiredTierFor(model: string): 'pro' | undefined {
  return PRO_MODELS.has(normalizeModelId(model)) ? 'pro' : undefined
}
