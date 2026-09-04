import { describe, expect, test } from 'vitest'
import { createTools } from '../electron/main/tools'
import { getSystemPrompt } from '../electron/main/agent-system-prompt'
import { getOnboardingSystemPrompt } from '../electron/main/onboarding-system-prompt'

describe('Platform Auto-Discovery and Dynamic Tool Scoping', () => {
  test('createTools scopes tools to X-only mode', () => {
    const tools = createTools({ platforms: { twitter: true, reddit: false } }) as Record<string, any>

    // Generic tools must be present
    expect(tools.read_profile).toBeDefined()
    expect(tools.update_soxial_profile).toBeDefined()
    expect(tools.schedule_post).toBeDefined()
    expect(tools.generate_image).toBeDefined()

    // X/Twitter tools must be present
    expect(tools.twitter_whoami).toBeDefined()
    expect(tools.twitter_post).toBeDefined()
    expect(tools.twitter_search).toBeDefined()
    expect(tools.twitter_reply).toBeDefined()

    // Reddit tools must be excluded
    expect(tools.reddit_login).toBeUndefined()
    expect(tools.reddit_whoami).toBeUndefined()
    expect(tools.reddit_search).toBeUndefined()
    expect(tools.reddit_comment).toBeUndefined()
    expect(tools.reddit_sub).toBeUndefined()

    // schedule_post platform schema should only accept twitter
    const parsed = tools.schedule_post.parameters.safeParse({
      platform: 'twitter',
      type: 'thought',
      text: 'Hello X',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(parsed.success).toBe(true)

    const invalidReddit = tools.schedule_post.parameters.safeParse({
      platform: 'reddit',
      type: 'thought',
      text: 'Hello Reddit',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(invalidReddit.success).toBe(false)
  })

  test('createTools scopes tools to Reddit-only mode', () => {
    const tools = createTools({ platforms: { twitter: false, reddit: true } }) as Record<string, any>

    // Generic tools must be present
    expect(tools.read_profile).toBeDefined()
    expect(tools.update_soxial_profile).toBeDefined()
    expect(tools.schedule_post).toBeDefined()

    // Reddit tools must be present
    expect(tools.reddit_login).toBeDefined()
    expect(tools.reddit_whoami).toBeDefined()
    expect(tools.reddit_search).toBeDefined()
    expect(tools.reddit_comment).toBeDefined()

    // X/Twitter tools must be excluded
    expect(tools.twitter_whoami).toBeUndefined()
    expect(tools.twitter_post).toBeUndefined()
    expect(tools.twitter_search).toBeUndefined()

    // schedule_post platform schema should only accept reddit
    const parsed = tools.schedule_post.parameters.safeParse({
      platform: 'reddit',
      type: 'discussion',
      text: 'Title\nBody',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(parsed.success).toBe(true)

    const invalidTwitter = tools.schedule_post.parameters.safeParse({
      platform: 'twitter',
      type: 'thought',
      text: 'Hello X',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(invalidTwitter.success).toBe(false)
  })

  test('createTools includes all tools in Dual mode', () => {
    const tools = createTools({ platforms: { twitter: true, reddit: true } }) as Record<string, any>

    expect(tools.twitter_post).toBeDefined()
    expect(tools.reddit_comment).toBeDefined()
    expect(tools.read_profile).toBeDefined()

    const parseTwitter = tools.schedule_post.parameters.safeParse({
      platform: 'twitter',
      type: 'thought',
      text: 'Hello X',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(parseTwitter.success).toBe(true)

    const parseReddit = tools.schedule_post.parameters.safeParse({
      platform: 'reddit',
      type: 'discussion',
      text: 'Title\nBody',
      scheduled_time: '2026-09-01T12:00:00Z',
    })
    expect(parseReddit.success).toBe(true)
  })

  test('getSystemPrompt tailors description for single vs dual platform', () => {
    const twitterPrompt = getSystemPrompt({ twitter: true, reddit: false })
    expect(twitterPrompt).toContain('adaptive social media manager for X/Twitter.')

    const redditPrompt = getSystemPrompt({ twitter: false, reddit: true })
    expect(redditPrompt).toContain('adaptive social media manager for Reddit.')

    const dualPrompt = getSystemPrompt({ twitter: true, reddit: true })
    expect(dualPrompt).toContain('adaptive social media manager for X/Twitter and Reddit.')
  })

  test('getOnboardingSystemPrompt tailors description for single vs dual platform', () => {
    const twitterPrompt = getOnboardingSystemPrompt({ twitter: true, reddit: false })
    expect(twitterPrompt).toContain('onboarding session for X/Twitter.')

    const redditPrompt = getOnboardingSystemPrompt({ twitter: false, reddit: true })
    expect(redditPrompt).toContain('onboarding session for Reddit.')
  })
})
