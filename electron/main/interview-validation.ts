// Validation for the onboarding interview.
//
// Enforced in code rather than by prompt wording: question count, shape, and
// the one-interview-per-run rule all hold even if the model misbehaves.

export const MAX_INTERVIEW_QUESTIONS = 8

export interface InterviewQuestion {
  id: string
  text: string
  type: 'single' | 'multi' | 'text'
  options?: string[]
}

export type InterviewRejectionCode =
  | 'INTERVIEW_ALREADY_REQUESTED'
  | 'NO_QUESTIONS'
  | 'TOO_MANY_QUESTIONS'
  | 'DUPLICATE_QUESTION_ID'
  | 'EMPTY_QUESTION_TEXT'
  | 'MISSING_OPTIONS'
  | 'DUPLICATE_OPTIONS'
  | 'ASKS_KNOWN_IDENTITY'
  | 'ASKS_FOR_SECRET'

export interface InterviewValidationResult {
  ok: boolean
  code?: InterviewRejectionCode
  error?: string
  questions?: InterviewQuestion[]
}

/** Identity the user already gave us, or that the app owns outright. */
export interface KnownIdentity {
  name?: string | null
  timezone?: string | null
  twitterHandle?: string | null
  redditUsername?: string | null
}

const SECRET_PATTERN = /\b(api[\s_-]?key|password|secret|token|credential|private key|seed phrase)\b/i

function asksAboutKnownIdentity(text: string, known: KnownIdentity): boolean {
  const lower = text.toLowerCase()

  // Only block when the value is already known; a skipped field is fair game.
  if (known.name && /\b(your|the)\s+name\b|what.{0,12}\bcall you\b/.test(lower)) return true
  if (known.timezone && /\b(time\s?zone|timezone|what time are you|where are you based)\b/.test(lower)) return true
  if (known.twitterHandle && /\b(twitter|x)\s+(handle|username|@)/.test(lower)) return true
  if (known.redditUsername && /\breddit\s+(handle|username|u\/)/.test(lower)) return true

  return false
}

export function validateInterviewQuestions(
  input: unknown,
  context: { alreadyRequested?: boolean; known?: KnownIdentity } = {},
): InterviewValidationResult {
  if (context.alreadyRequested) {
    return {
      ok: false,
      code: 'INTERVIEW_ALREADY_REQUESTED',
      error: 'The onboarding interview has already been asked. Build the strategy from the answers you already have.',
    }
  }

  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, code: 'NO_QUESTIONS', error: 'Provide at least one question, or skip the interview entirely.' }
  }

  if (input.length > MAX_INTERVIEW_QUESTIONS) {
    return {
      ok: false,
      code: 'TOO_MANY_QUESTIONS',
      error: `Ask at most ${MAX_INTERVIEW_QUESTIONS} questions. Drop the ones you can infer from the gathered evidence.`,
    }
  }

  const known = context.known ?? {}
  const seenIds = new Set<string>()
  const questions: InterviewQuestion[] = []

  for (const raw of input) {
    const question = raw as Partial<InterviewQuestion>
    const id = typeof question.id === 'string' ? question.id.trim() : ''
    const text = typeof question.text === 'string' ? question.text.trim() : ''
    const type = question.type

    if (!id || !text) {
      return { ok: false, code: 'EMPTY_QUESTION_TEXT', error: 'Every question needs a non-empty id and text.' }
    }
    if (seenIds.has(id)) {
      return { ok: false, code: 'DUPLICATE_QUESTION_ID', error: `Duplicate question id "${id}".` }
    }
    seenIds.add(id)

    if (type !== 'single' && type !== 'multi' && type !== 'text') {
      return { ok: false, code: 'EMPTY_QUESTION_TEXT', error: `Question "${id}" has an invalid type.` }
    }

    if (SECRET_PATTERN.test(text)) {
      return { ok: false, code: 'ASKS_FOR_SECRET', error: 'Never ask the user for credentials or secrets.' }
    }

    if (asksAboutKnownIdentity(text, known)) {
      return {
        ok: false,
        code: 'ASKS_KNOWN_IDENTITY',
        error: `Question "${id}" asks for identity the user already provided. Ask only about genuine gaps.`,
      }
    }

    let options: string[] | undefined
    if (type === 'single' || type === 'multi') {
      const provided = Array.isArray(question.options)
        ? question.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        : []
      if (provided.length < 2) {
        return {
          ok: false,
          code: 'MISSING_OPTIONS',
          error: `Question "${id}" is ${type} and needs at least two options.`,
        }
      }
      const normalized = provided.map(option => option.trim())
      if (new Set(normalized.map(o => o.toLowerCase())).size !== normalized.length) {
        return { ok: false, code: 'DUPLICATE_OPTIONS', error: `Question "${id}" has duplicate options.` }
      }
      options = normalized
    }

    questions.push({ id, text, type, options })
  }

  return { ok: true, questions }
}

/**
 * Recommended question budget for the evidence available. Strong evidence
 * should produce a short interview; a bare account needs a real one.
 */
export function recommendedQuestionCount(evidence: {
  postCount?: number
  hasTwitter?: boolean
  hasReddit?: boolean
}): { min: number; max: number } {
  const posts = evidence.postCount ?? 0
  const connected = Boolean(evidence.hasTwitter || evidence.hasReddit)

  if (!connected) return { min: 6, max: MAX_INTERVIEW_QUESTIONS }
  if (posts >= 30) return { min: 2, max: 4 }
  if (posts >= 5) return { min: 3, max: 6 }
  return { min: 5, max: MAX_INTERVIEW_QUESTIONS }
}

/** The six strategic categories the agent must rate before interviewing. */
export type EvidenceCategory = 'positioning' | 'audience' | 'voice' | 'businessOutcome' | 'timeCapacity' | 'riskTolerance'

export interface ConfidenceEntry {
  confidence: number
  evidence?: string[]
  contradiction?: string
}

/**
 * Question budget implied by a recorded evidence assessment, following the
 * guidance bands: ≥0.8 do not ask, 0.5-0.79 confirm sparingly, <0.5 interview.
 * Returns null when no usable assessment exists — the post-count heuristic
 * applies instead.
 */
export function recommendedQuestionCountFromAssessment(
  assessment: Partial<Record<EvidenceCategory, ConfidenceEntry>> | null | undefined,
): { min: number; max: number } | null {
  if (!assessment) return null
  const entries = Object.values(assessment).filter(
    (entry): entry is ConfidenceEntry => !!entry && Number.isFinite(entry.confidence),
  )
  if (entries.length === 0) return null

  const average = entries.reduce((sum, entry) => sum + entry.confidence, 0) / entries.length
  if (average >= 0.8) return { min: 0, max: 2 }
  if (average >= 0.5) return { min: 2, max: 4 }
  return { min: 5, max: MAX_INTERVIEW_QUESTIONS }
}
