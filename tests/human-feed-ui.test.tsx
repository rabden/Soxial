// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanTweet, Paginated } from 'src/features/human/types'

vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))

import HumanFeed from 'src/features/human/components/HumanFeed'

/* ------------------------------------------------------------------ *
 * IntersectionObserver stub — jsdom has none. Tests drive pagination
 * deterministically by marking the sentinel intersecting.
 * ------------------------------------------------------------------ */
import {
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  markSentinelIntersecting,
} from './helpers/human-ui-mocks'

const feedMock = vi.fn()
const verifyMock = vi.fn()

function makeTweet(id: string, text?: string): HumanTweet {
  return {
    id,
    text: text ?? `tweet-${id}`,
    author: { screenName: 'alice', name: 'Alice' },
    metrics: { likes: 1, views: 10 },
  }
}

function okPage(items: HumanTweet[], nextCursor?: string): HumanResult<Paginated<HumanTweet>> {
  return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}), hasMore: Boolean(nextCursor) } }
}

function appError(overrides: Partial<AppError>): AppError {
  return {
    code: 'TEST_ERROR',
    category: 'internal',
    message: 'boom',
    retryable: false,
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  installFakeIntersectionObserver()
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  feedMock.mockReset()
  verifyMock.mockReset()
  ;(window as any).api = {
    platform: 'linux',
    humanFeed: feedMock,
    humanVerifySession: verifyMock,
  }
})

afterEach(cleanup)

describe('HumanFeed — renderer seam', () => {
  it('loads page 1, paginates via the sentinel cursor without duplicates', async () => {
    feedMock.mockImplementation(async (req: { cursor?: string }) => {
      if (!req.cursor) return okPage(Array.from({ length: 10 }, (_, i) => makeTweet(String(i + 1))), 'cursor-2')
      if (req.cursor === 'cursor-2') return okPage([makeTweet('10'), makeTweet('11'), makeTweet('12')]) // page 1 overlap
      return okPage([])
    })

    render(<HumanFeed />)

    await screen.findByText('tweet-3')
    expect(feedMock).toHaveBeenCalledTimes(1)
    expect(feedMock.mock.calls[0][0]).toEqual({ type: 'for-you', cursor: undefined })

    markSentinelIntersecting()
    await screen.findByText('tweet-12')

    expect(feedMock).toHaveBeenCalledTimes(2)
    expect(feedMock.mock.calls[1][0]).toEqual({ type: 'for-you', cursor: 'cursor-2' })
    // Duplicated tweet-10 from page 2 is rendered exactly once.
    expect(screen.getAllByText('tweet-10')).toHaveLength(1)
    // hasMore=false after the last page: caught-up copy replaces the sentinel.
    expect(screen.getByText(/all caught up/i)).toBeTruthy()
  })

  it('switching For you → Following resets the feed and reloads page 1', async () => {
    feedMock.mockImplementation(async (req: { type?: string }) =>
      req.type === 'following'
        ? okPage([makeTweet('f1', 'following-1')])
        : okPage([makeTweet('y1', 'foryou-1')]),
    )

    render(<HumanFeed />)
    await screen.findByText('foryou-1')

    fireEvent.click(screen.getByRole('button', { name: 'Following' }))

    await screen.findByText('following-1')
    expect(screen.queryByText('foryou-1')).toBeNull()
    const lastCall = feedMock.mock.calls[feedMock.mock.calls.length - 1][0]
    expect(lastCall.type).toBe('following')
    expect(lastCall.cursor).toBeUndefined()
  })

  it('discards a stale page-1 response after the reset key changes', async () => {
    let releaseFirst: ((value: HumanResult<Paginated<HumanTweet>>) => void) | undefined
    feedMock.mockImplementation(async (req: { type?: string }) => {
      if (req.type === 'for-you' && !releaseFirst) {
        return new Promise<HumanResult<Paginated<HumanTweet>>>((resolve) => {
          releaseFirst = resolve
        })
      }
      return req.type === 'following'
        ? okPage([makeTweet('f1', 'following-1')])
        : okPage([makeTweet('y1', 'foryou-1')])
    })

    render(<HumanFeed />)
    // Switch before the first (slow) response lands.
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))
    await screen.findByText('following-1')

    // Now let the stale For-you page resolve — it must be discarded.
    releaseFirst?.(okPage([makeTweet('y1', 'foryou-1')]))
    await waitFor(() => expect(feedMock).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('foryou-1')).toBeNull()
  })

  it('shows the auth gate with re-check for auth failures', async () => {
    feedMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })
    verifyMock.mockResolvedValue({ ok: true, data: { authenticated: true, user: null } })

    render(<HumanFeed />)
    await screen.findByText(/log in to x.com to see your feed/i)

    fireEvent.click(screen.getByRole('button', { name: /re-check/i }))
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1))
    // Session verified → the feed reloads.
    await waitFor(() => expect(feedMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('keeps the auth gate when re-check still fails', async () => {
    feedMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })
    verifyMock.mockResolvedValue({
      ok: false,
      error: appError({ category: 'auth', code: 'TWITTER_AUTH_REQUIRED' }),
    })

    render(<HumanFeed />)
    await screen.findByText(/log in to x.com to see your feed/i)

    fireEvent.click(screen.getByRole('button', { name: /re-check/i }))
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/log in to x.com to see your feed/i)).toBeTruthy()
    expect(feedMock).toHaveBeenCalledTimes(1)
  })

  it('renders the operational error component with retry for rate limits', async () => {
    const error = appError({
      code: 'TWITTER_RATE_LIMITED',
      category: 'rate-limit',
      message: 'X is rate limiting requests.',
      retryable: true,
      action: 'retry',
      retryAfterMs: 300_000,
    })
    feedMock.mockResolvedValueOnce({ ok: false, error }).mockResolvedValueOnce(okPage([makeTweet('r1', 'recovered-1')]))

    render(<HumanFeed />)
    expect(await screen.findByText('X is rate limiting requests.')).toBeTruthy()
    expect(screen.getByText(/try again in 5 minutes/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('recovered-1')
  })

  it('shows friendly copy for an empty timeline', async () => {
    feedMock.mockResolvedValue(okPage([]))

    render(<HumanFeed />)
    await screen.findByText('No posts yet')
  })

  it('preserves loaded items when a load-more fails, with retry', async () => {
    feedMock.mockImplementation(async (req: { cursor?: string }) => {
      if (!req.cursor) return okPage([makeTweet('a', 'first-item')], 'cursor-2')
      return { ok: false, error: appError({ category: 'network', retryable: true, action: 'retry' }) }
    })

    render(<HumanFeed />)
    await screen.findByText('first-item')

    markSentinelIntersecting()
    await screen.findByText('boom')
    // First-page item survives the load-more failure.
    expect(screen.getByText('first-item')).toBeTruthy()

    feedMock.mockImplementation(async () => okPage([makeTweet('b', 'second-item')]))
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('second-item')
  })

  it('locks the sub-toggle while disabled (rebuild lock)', async () => {
    feedMock.mockResolvedValue(okPage([]))

    render(<HumanFeed disabled />)
    await screen.findByText('No posts yet')

    expect((screen.getByRole('button', { name: 'For you' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Following' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
