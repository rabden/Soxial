// electron/main/context-errors.ts — classify provider context-overflow
// errors (spec #53). Same style as agent.ts's rate-limit/auth/transient
// classifiers: pattern-match the provider message, never throw. Checked
// BEFORE the transient classifier in the run loop — an overflow is not
// retryable as-is, it needs compaction first.

const CONTEXT_ERROR_PATTERNS: ReadonlyArray<string> = [
  // OpenAI: "This model's maximum context length is 8192 tokens. However..."
  'maximum context length',
  'context length',
  // Generic / Together-style: "Input exceeds context window"
  'context window',
  // Anthropic: "prompt is too long: 200000 tokens > 180000 maximum"
  'prompt is too long',
  // Gemini: "The input token count (123) exceeds the maximum number of tokens allowed (456)"
  'input token count exceeds',
  'exceeds the maximum number of tokens',
  // OpenAI older / generic: "To reduce the length of the messages..."
  'reduce the length of the messages',
  'too many input tokens',
  'input tokens exceed',
  'exceeds token limit',
  'token limit exceeded',
  'token limit reached',
  // OpenAI 413-style body: "Request too large"
  'request too large',
  'input length exceeds',
  'exceeds available context',
  'exceed the maximum context',
]

export function isContextLengthError(e: any): boolean {
  const raw = e?.message ?? (typeof e === 'string' ? e : '')
  if (!raw) return false
  const message = String(raw).toLowerCase()
  return CONTEXT_ERROR_PATTERNS.some(pattern => message.includes(pattern))
}
