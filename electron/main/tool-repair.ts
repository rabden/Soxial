// Malformed tool-argument repair ladder, ported from the grok-build harness
// (`prepare_tool_call` in xai-grok-shell). Models occasionally emit broken
// tool-call arguments: empty strings, concatenated JSON objects, fenced or
// trailing-garbage JSON. Refusing those wastes a whole provider round-trip;
// repairing them locally is free and keeps history valid.
//
// Ladder (first match wins):
//   1. "" / whitespace            → {}
//   2. already-valid JSON value   → as-is (validated against the tool schema)
//   3. markdown-fenced JSON       → unfenced, then re-parse
//   4. concatenated objects       → stream-split into candidates
//   5. leading garbage            → first balanced {...} substring
// Each candidate is validated against the named tool's zod schema; the first
// schema-valid candidate wins. If none validates, the original parse error is
// returned so the SDK produces its self-correcting tool-error for the model.

type ZodLike = { safeParse: (value: unknown) => { success: boolean; data?: unknown } }

/** Split a string of concatenated top-level JSON values ("{...}{...}" / "[..]{..}"). */
export function splitConcatenatedJson(raw: string): unknown[] {
  const values: unknown[] = []
  const openers = new Set(['{', '['])

  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (openers.has(ch)) {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          values.push(JSON.parse(raw.slice(start, i + 1)))
        } catch {
          /* skip unparseable segment */
        }
        start = -1
      }
      if (depth < 0) depth = 0 // stray closer outside any value
    }
  }
  return values
}

/** Strip markdown fences and trim surrounding prose around a JSON body. */
export function unfence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) return fenced[1].trim()
  return raw.trim()
}

/** First balanced top-level {...} or [...] substring, honoring strings. */
function firstBalancedValue(raw: string): string | null {
  const openIdx = raw.search(/[{[]/)
  if (openIdx === -1) return null
  const open = raw[openIdx]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = openIdx; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return raw.slice(openIdx, i + 1)
    }
  }
  return null
}

/**
 * Enumerate plausible parsed inputs for a raw model-emitted argument string,
 * in ladder order. Pure — exported for tests and reuse by refine paths.
 */
export function parseToolInputCandidates(rawInput: unknown): { value?: unknown; parseError?: string } {
  if (typeof rawInput !== 'string') {
    return { value: rawInput ?? {} }
  }
  const raw = rawInput.trim()
  if (raw === '' ) return { value: {} }

  // 2. Already-valid JSON.
  try {
    return { value: JSON.parse(raw) }
  } catch { /* continue down the ladder */ }

  // 3. Fenced JSON.
  const unfencedRaw = unfence(raw)
  if (unfencedRaw !== raw) {
    try {
      return { value: JSON.parse(unfencedRaw) }
    } catch { /* continue */ }
  }

  // 4. Concatenated objects.
  const parts = splitConcatenatedJson(raw)
  if (parts.length > 1) return { value: parts }

  // 5. Leading garbage with an embedded balanced value.
  const embedded = firstBalancedValue(unfencedRaw)
  if (embedded) {
    try {
      return { value: JSON.parse(embedded) }
    } catch { /* fall through */ }
  }

  return { parseError: 'Arguments are not parseable as JSON.' }
}

/**
 * Build the AI SDK `experimental_repairToolCall` implementation over a raw
 * tool map whose entries carry zod `parameters`.
 */
export function createToolRepairLadder(rawTools: Record<string, { parameters?: any }>) {
  return async ({ toolCall }: { toolCall: { toolCallId: string; toolName: string; input: unknown; [k: string]: unknown } }) => {
    const toolName: string = toolCall.toolName
    const schema: ZodLike | undefined = rawTools?.[toolName]?.parameters
    const { value, parseError } = parseToolInputCandidates(toolCall.input)

    if (parseError !== undefined || value === undefined) return null

    // Concatenated objects: prefer the first candidate the schema accepts.
    const candidates: unknown[] = Array.isArray(value) && typeof toolCall.input === 'string'
      ? value
      : [value]

    for (const candidate of candidates) {
      if (schema && typeof schema.safeParse === 'function') {
        const checked = schema.safeParse(candidate)
        if (!checked.success) continue
        return { ...toolCall, input: checked.data }
      }
      return { ...toolCall, input: candidate }
    }
    return null
  }
}
