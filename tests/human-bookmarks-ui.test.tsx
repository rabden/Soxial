// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanTweet, Paginated } from 'src/features/human/types'

vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))

import HumanBookmarks from 'src/features/human/components/HumanBookmarks'

import {
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  markSentinelIntersecting,
} from './helpers/human-ui-mocks'

const bookmarksMock = vi.fn()
const verifyMock = vi.fn()

function makeTweet(id: string): HumanTweet {
  return {
    id,
    text: `bookmark-${id}`,
    author: { screenName: 'alice', name: 'Alice' },
    metrics: { likes: 1 },
  }
}

function okPage(items: HumanTweet[], hasMore: boolean): HumanResult<Paginated<HumanTweet>> {
  return { ok: true, data: { items, hasMore } }
}

function appError(overrides: Partial<AppError>): AppError {
  return { code: 'TEST_ERROR', category: 'internal', message: 'boom', retryable: false, ...overrides }
}

beforeEach(() => {
  cleanup()
  installFakeIntersectionObserver()
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  bookmarksMock.mockReset()
  verifyMock.mockReset()
  ;(window as any).api = {
    platform: 'linux',
    humanBookmarks: bookmarksMock,
    humanVerifySession: verifyMock,
  }
})

afterEach(cleanup)

describe('HumanBookmarks — renderer seam (T5)', () => {
  it('grows the requested count by 10 per page and dedupes overlapping items', async () => {
    bookmarksMock.mockImplementation(async (req: { count?: number }) => {
      const count = req.count ?? 10
      const items = Array.from({ length: Math.min(count, 15) }, (_, i) => makeTweet(String(i + 1)))
      return okPage(items, count < 15)
    })

    render(<HumanBookmarks />)
    await screen.findByText('bookmark-1')

    expect(bookmarksMock).toHaveBeenLastCalledWith({ count: 10 })

    markSentinelIntersecting()
    await screen.findByText('bookmark-15')

    expect(bookmarksMock).toHaveBeenLastCalledWith({ count: 20 })
    // Page 2 re-delivered items 1–10; each renders once.
    expect(screen.getAllByText('bookmark-7')).toHaveLength(1)
  })

  // Renders 200 rows across ~20 growth rounds — needs more than the default
  // 5s budget when the whole suite runs in parallel.
  it('stops at the connector cap', { timeout: 20_000 }, async () => {
    // Growth: page 1 asks 10; the next window derives from items.length + 10;
    // a near-cap page jumps the request to 200, which reports exhausted.
    bookmarksMock.mockImplementation(async (req: { count?: number }) => {
      const count = req.count ?? 10
      if (count === 10) return okPage(Array.from({ length: 10 }, (_, i) => makeTweet(String(i + 1))), true)
      if (count === 20) return okPage(Array.from({ length: 190 }, (_, i) => makeTweet(String(i + 1))), true)
      return okPage(Array.from({ length: 200 }, (_, i) => makeTweet(String(i + 1))), false)
    })

    render(<HumanBookmarks />)
    await screen.findByText('bookmark-1')

    markSentinelIntersecting()
    await vi.waitFor(() => expect(bookmarksMock).toHaveBeenLastCalledWith({ count: 20 }))

    markSentinelIntersecting()
    await vi.waitFor(() => expect(bookmarksMock).toHaveBeenLastCalledWith({ count: 200 }))

    // Cap requested and reported exhausted.
    await vi.waitFor(() => expect(screen.getByText(/reached the end of your bookmarks/i)).toBeTruthy())
  })

  it('shows login guidance when unauthenticated', async () => {
    bookmarksMock.mockResolvedValue({
      ok: false,
      error: appError({ category: 'auth', action: 'reauthenticate' }),
    })
    verifyMock.mockResolvedValue({ ok: true, data: { authenticated: true, user: null } })

    render(<HumanBookmarks />)
    await screen.findByText(/log in to x.com to see your bookmarks/i)

    fireEvent.click(screen.getByRole('button', { name: /re-check/i }))
    await vi.waitFor(() => expect(bookmarksMock).toHaveBeenCalledTimes(2))
  })

  it('shows empty copy for no bookmarks', async () => {
    bookmarksMock.mockResolvedValue(okPage([], false))

    render(<HumanBookmarks />)
    await screen.findByText('No bookmarks')
  })

  it('renders the operational error with retry for network failures', async () => {
    bookmarksMock
      .mockResolvedValueOnce({
        ok: false,
        error: appError({ category: 'network', retryable: true, action: 'retry', message: 'X is unreachable.' }),
      })
      .mockResolvedValueOnce(okPage([makeTweet('1')], false))

    render(<HumanBookmarks />)
    expect(await screen.findByText('X is unreachable.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('bookmark-1')
  })
})
