import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ANALYSIS_DISCLOSURE,
  REQUIRED_IDENTITY_STAGES,
  canAdvanceIdentityStage,
  getIdentityStageActionLabel,
  getOptionalStepActionLabel,
  hasContent,
  isRequiredIdentityStage,
} from '../src/features/onboarding/onboarding-steps'

describe('identity stage requirements', () => {
  it('requires only name, timezone, and primary goal', () => {
    expect([...REQUIRED_IDENTITY_STAGES].sort()).toEqual(['goal', 'name', 'timezone'])
    expect(isRequiredIdentityStage('name')).toBe(true)
    expect(isRequiredIdentityStage('timezone')).toBe(true)
    expect(isRequiredIdentityStage('goal')).toBe(true)
    expect(isRequiredIdentityStage('niche')).toBe(false)
    expect(isRequiredIdentityStage('superpower')).toBe(false)
  })

  it('blocks required stages while empty', () => {
    expect(canAdvanceIdentityStage('name', '')).toBe(false)
    expect(canAdvanceIdentityStage('name', '   ')).toBe(false)
    expect(canAdvanceIdentityStage('timezone', undefined)).toBe(false)
    expect(canAdvanceIdentityStage('goal', '')).toBe(false)
  })

  it('advances required stages once answered', () => {
    expect(canAdvanceIdentityStage('name', 'Hossain')).toBe(true)
    expect(canAdvanceIdentityStage('timezone', 'Asia/Dhaka')).toBe(true)
    expect(canAdvanceIdentityStage('goal', 'Audience building')).toBe(true)
  })

  it('never blocks optional stages', () => {
    expect(canAdvanceIdentityStage('niche', '')).toBe(true)
    expect(canAdvanceIdentityStage('niche', '   ')).toBe(true)
    expect(canAdvanceIdentityStage('superpower', undefined)).toBe(true)
    expect(canAdvanceIdentityStage('superpower', 'I make complex ideas simple')).toBe(true)
  })
})

describe('single-button skip/continue affordance', () => {
  it('reads Skip while an optional field is empty', () => {
    expect(getOptionalStepActionLabel('')).toBe('Skip')
    expect(getOptionalStepActionLabel(undefined)).toBe('Skip')
    expect(getOptionalStepActionLabel(null)).toBe('Skip')
  })

  it('treats whitespace-only input as still skippable', () => {
    expect(getOptionalStepActionLabel('   ')).toBe('Skip')
    expect(getOptionalStepActionLabel('\n\t')).toBe('Skip')
    expect(hasContent('   ')).toBe(false)
  })

  it('becomes Continue once real content is entered', () => {
    expect(getOptionalStepActionLabel('developer tools')).toBe('Continue')
    expect(getOptionalStepActionLabel('  founders  ')).toBe('Continue')
  })

  it('always reads Continue on required identity stages', () => {
    expect(getIdentityStageActionLabel('name', 'Hossain')).toBe('Continue')
    expect(getIdentityStageActionLabel('goal', 'Job hunting')).toBe('Continue')
  })

  it('switches label on optional identity stages', () => {
    expect(getIdentityStageActionLabel('niche', '')).toBe('Skip')
    expect(getIdentityStageActionLabel('niche', 'I build dev tools')).toBe('Continue')
    expect(getIdentityStageActionLabel('superpower', '  ')).toBe('Skip')
  })
})

describe('account analysis disclosure', () => {
  it('states what is sent and what is never sent', () => {
    expect(ACCOUNT_ANALYSIS_DISCLOSURE).toContain('sends a compacted selection of account activity')
    expect(ACCOUNT_ANALYSIS_DISCLOSURE).toContain('your chosen AI provider')
    expect(ACCOUNT_ANALYSIS_DISCLOSURE).toContain('API keys and browser credentials are never included')
  })
})
