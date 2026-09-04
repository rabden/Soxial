import { describe, expect, it } from 'vitest'
import {
  MAX_INTERVIEW_QUESTIONS,
  recommendedQuestionCount,
  recommendedQuestionCountFromAssessment,
  validateInterviewQuestions,
} from '../electron/main/interview-validation'
import { getOnboardingSystemPrompt } from '../electron/main/onboarding-system-prompt'

const validQuestion = {
  id: 'q_outcome',
  text: 'What outcome matters most in the next six months?',
  type: 'single' as const,
  options: ['Clients', 'Job offers', 'Audience'],
}

describe('one interview per run', () => {
  it('accepts the first interview', () => {
    const result = validateInterviewQuestions([validQuestion], { alreadyRequested: false })
    expect(result.ok).toBe(true)
    expect(result.questions).toHaveLength(1)
  })

  it('rejects a second interview with a typed code', () => {
    const result = validateInterviewQuestions([validQuestion], { alreadyRequested: true })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INTERVIEW_ALREADY_REQUESTED')
    expect(result.error).toContain('already been asked')
  })
})

describe('question shape validation', () => {
  it('rejects an empty batch', () => {
    expect(validateInterviewQuestions([]).code).toBe('NO_QUESTIONS')
    expect(validateInterviewQuestions(null).code).toBe('NO_QUESTIONS')
  })

  it('rejects more than the maximum number of questions', () => {
    const many = Array.from({ length: MAX_INTERVIEW_QUESTIONS + 1 }, (_, i) => ({
      ...validQuestion,
      id: `q_${i}`,
    }))
    expect(validateInterviewQuestions(many).code).toBe('TOO_MANY_QUESTIONS')
  })

  it('rejects duplicate question ids', () => {
    const result = validateInterviewQuestions([validQuestion, { ...validQuestion }])
    expect(result.code).toBe('DUPLICATE_QUESTION_ID')
  })

  it('rejects empty text or a bad type', () => {
    expect(validateInterviewQuestions([{ id: 'q', text: '   ', type: 'text' }]).code).toBe('EMPTY_QUESTION_TEXT')
    expect(validateInterviewQuestions([{ id: 'q', text: 'ok?', type: 'dropdown' }]).code).toBe('EMPTY_QUESTION_TEXT')
  })

  it('requires at least two options for choice questions', () => {
    expect(validateInterviewQuestions([{ id: 'q', text: 'Pick one', type: 'single' }]).code).toBe('MISSING_OPTIONS')
    expect(validateInterviewQuestions([{ id: 'q', text: 'Pick one', type: 'single', options: ['Only'] }]).code).toBe('MISSING_OPTIONS')
    expect(validateInterviewQuestions([{ id: 'q', text: 'Pick some', type: 'multi', options: ['A', 'B'] }]).ok).toBe(true)
  })

  it('rejects duplicate options', () => {
    const result = validateInterviewQuestions([{ id: 'q', text: 'Pick', type: 'single', options: ['Yes', 'yes'] }])
    expect(result.code).toBe('DUPLICATE_OPTIONS')
  })

  it('allows free-text questions without options', () => {
    expect(validateInterviewQuestions([{ id: 'q', text: 'What shipped recently?', type: 'text' }]).ok).toBe(true)
  })

  it('trims and normalizes accepted questions', () => {
    const result = validateInterviewQuestions([{ id: '  q_a  ', text: '  Why?  ', type: 'single', options: [' A ', ' B '] }])
    expect(result.questions?.[0]).toEqual({ id: 'q_a', text: 'Why?', type: 'single', options: ['A', 'B'] })
  })
})

describe('never re-ask known identity or secrets', () => {
  const known = { name: 'Hossain', timezone: 'Asia/Dhaka', twitterHandle: 'rabden', redditUsername: 'rabden' }

  it('rejects questions about identity the user already gave', () => {
    for (const text of [
      'What is your name?',
      'What timezone are you in?',
      'What is your Twitter handle?',
      'What is your Reddit username?',
    ]) {
      const result = validateInterviewQuestions([{ id: 'q', text, type: 'text' }], { known })
      expect(result.code, text).toBe('ASKS_KNOWN_IDENTITY')
    }
  })

  it('allows asking about identity fields that were skipped', () => {
    const result = validateInterviewQuestions(
      [{ id: 'q', text: 'What timezone are you in?', type: 'text' }],
      { known: { name: 'Hossain' } },
    )
    expect(result.ok).toBe(true)
  })

  it('allows asking about skippable strategy fields', () => {
    const result = validateInterviewQuestions(
      [{ id: 'q_niche', text: 'Who exactly is your target audience?', type: 'text' }],
      { known },
    )
    expect(result.ok).toBe(true)
  })

  it('never lets the agent ask for credentials', () => {
    for (const text of ['What is your API key?', 'Share your password', 'Paste your access token']) {
      expect(validateInterviewQuestions([{ id: 'q', text, type: 'text' }]).code, text).toBe('ASKS_FOR_SECRET')
    }
  })
})

describe('evidence-driven question budget', () => {
  it('asks fewer questions when the account has a rich history', () => {
    expect(recommendedQuestionCount({ postCount: 120, hasTwitter: true })).toEqual({ min: 2, max: 4 })
  })

  it('asks more questions when evidence is thin', () => {
    expect(recommendedQuestionCount({ postCount: 1, hasTwitter: true }).max).toBe(MAX_INTERVIEW_QUESTIONS)
  })

  it('falls back to a full interview with no connected platform', () => {
    expect(recommendedQuestionCount({ postCount: 0 })).toEqual({ min: 6, max: MAX_INTERVIEW_QUESTIONS })
  })

  it('scales between the extremes', () => {
    expect(recommendedQuestionCount({ postCount: 10, hasReddit: true })).toEqual({ min: 3, max: 6 })
  })
})

describe('interview prompt guidance', () => {
  it('tells the agent to adapt the count to evidence confidence', () => {
    const prompt = getOnboardingSystemPrompt({ twitter: true, reddit: true })
    expect(prompt).toContain('AT MOST ONCE')
    expect(prompt).toContain('Rich history')
    expect(prompt).toContain('skip the interview entirely')
    expect(prompt).toContain('Never ask for the user\'s name, timezone, or platform handles')
  })
})

describe('assessment-driven question budget', () => {
  it('high average confidence means do not ask', () => {
    expect(recommendedQuestionCountFromAssessment({
      positioning: { confidence: 0.9 },
      audience: { confidence: 0.85 },
      voice: { confidence: 0.8 },
      businessOutcome: { confidence: 0.95 },
      timeCapacity: { confidence: 0.9 },
      riskTolerance: { confidence: 0.8 },
    })).toEqual({ min: 0, max: 2 })
  })

  it('medium confidence confirms sparingly', () => {
    expect(recommendedQuestionCountFromAssessment({
      positioning: { confidence: 0.7 },
      audience: { confidence: 0.6 },
    })).toEqual({ min: 2, max: 4 })
  })

  it('thin evidence produces a real interview', () => {
    expect(recommendedQuestionCountFromAssessment({
      positioning: { confidence: 0.2 },
      audience: { confidence: 0.4 },
    })).toEqual({ min: 5, max: MAX_INTERVIEW_QUESTIONS })
  })

  it('no usable assessment falls back to the post-count heuristic', () => {
    expect(recommendedQuestionCountFromAssessment(null)).toBeNull()
    expect(recommendedQuestionCountFromAssessment({})).toBeNull()
    expect(recommendedQuestionCountFromAssessment({ positioning: {} as any })).toBeNull()
  })
})
