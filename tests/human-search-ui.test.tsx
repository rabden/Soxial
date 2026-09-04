// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanTweet, Paginated } from 'src/features/human/types'

vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))

import HumanSearch from 'src/features/human/components/HumanSearch'

import {
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  markSentinelIntersecting,
} from './helpers/human-ui-mocks'

const searchMock = vi.fn()
const verifyMock = vi.fn()

function makeTweet(id: string, isoDate: string, text?: string): HumanTweet {
  return {
    id,
    text: text ?? `result-${id}`,
    author: { screenName: 'alice', name: 'Alice' },
    createdAtISO: isoDate,
    metrics: { likes: 1 },
  }
}

function okPage(items: HumanTweet[], hasMore: boolean): HumanResult<Paginated<HumanTweet>> {
  return { ok: true, data: { items, hasMore } }
}

function appError(overrides: Partial<AppError>): AppError {
  return { code: 'TEST_ERROR', category: 'internal', message: 'boom', retryable: false, ...overrides }
}

async function typeQuery(query: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search X' }), { target: { value: query } })
  // Let the 300 ms debounce settle.
  await new Promise((r) => setTimeout(r, 350))
}

beforeEach(() => {
  cleanup()
  installFakeIntersectionObserver()
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  searchMock.mockReset()
  verifyMock.mockReset()
  ;(window as any).api = {
    platform: 'linux',
    humanSearch: searchMock,
    humanVerifySession: verifyMock,
  }
})

afterEach(cleanup)

describe('HumanSearch — renderer seam (T7)', () => {
  it('debounces keystrokes: only the settled query fires a request', async () => {
    searchMock.mockResolvedValue(okPage([makeTweet('1', '2026-08-20T10:00:00Z')], false))

    render(<HumanSearch />)
    const input = screen.getByRole('textbox', { name: 'Search X' })

    fireEvent.change(input, { target: { value: 'he' } })
    fireEvent.change(input, { target: { value: 'hell' } })
    fireEvent.change(input, { target: { value: 'hello' } })

    await screen.findByText('result-1')

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock.mock.calls[0][0]).toMatchObject({ query: 'hello', product: 'Top' })
  })

  it('clears stale results before the new query lands', async () => {
    let releaseSecond: ((value: HumanResult<Paginated<HumanTweet>>) => void) | undefined
    searchMock.mockImplementation(async (req: { query: string }) => {
      if (req.query === 'foo') return okPage([makeTweet('f1', '2026-08-20T10:00:00Z', 'foo-result')], false)
      return new Promise((resolve) => {
        releaseSecond = resolve
      })
    })

    render(<HumanSearch />)
    await typeQuery('foo')
    await screen.findByText('foo-result')

    // Second query never resolves until we allow it.
    await typeQuery('bar')
    // The moment the debounce commits 'bar', foo's results are gone.
    expect(screen.queryByText('foo-result')).toBeNull()

    releaseSecond?.(okPage([makeTweet('b1', '2026-08-21T10:00:00Z', 'bar-result')], false))
    await screen.findByText('bar-result')
    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'bar' }))
  })

  it('switching product tabs resets pagination and re-searches', async () => {
    searchMock.mockImplementation(async (req: { product?: string }) =>
      req.product === 'Latest'
        ? okPage([makeTweet('l1', '2026-08-20T10:00:00Z', 'latest-result')], false)
        : okPage([makeTweet('t1', '2026-08-20T10:00:00Z', 'top-result')], false),
    )

    render(<HumanSearch />)
    await typeQuery('cats')
    await screen.findByText('top-result')

    fireEvent.click(screen.getByRole('button', { name: 'Latest' }))
    await screen.findByText('latest-result')

    expect(screen.queryByText('top-result')).toBeNull()
    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ product: 'Latest' }))
  })

  it('passes surfaced filters through to the connector', async () => {
    searchMock.mockResolvedValue(okPage([makeTweet('1', '2026-08-20T10:00:00Z')], false))

    render(<HumanSearch />)
    await typeQuery('ship it')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle filters' }))
    fireEvent.change(screen.getByLabelText('From (@handle)'), { target: { value: 'elonmusk' } })
    fireEvent.change(screen.getByLabelText('Min likes'), { target: { value: '50' } })
    await new Promise((r) => setTimeout(r, 350))

    await vi.waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'ship it', from: 'elonmusk', minLikes: 50 }),
      ),
    )
  })

  it('paginates by advancing the date window from the oldest result', async () => {
    searchMock.mockImplementation(async (req: { until?: string }) => {
      if (!req.until) {
        return okPage(
          [makeTweet('1', '2026-08-27T10:00:00Z'), makeTweet('2', '2026-08-25T08:00:00Z')],
          true,
        )
      }
      if (req.until === '2026-08-25') return okPage([makeTweet('3', '2026-08-20T08:00:00Z')], false)
      return okPage([], false)
    })

    render(<HumanSearch />)
    await typeQuery('cats')
    await screen.findByText('result-1')

    markSentinelIntersecting()
    await screen.findByText('result-3')

    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ until: '2026-08-25' }))
    expect(screen.getByText(/no more results/i)).toBeTruthy()
  })

  it('shows idle prompt before any query, then No results for empty hits', async () => {
    searchMock.mockResolvedValue(okPage([], false))

    render(<HumanSearch />)
    expect(screen.getByText('Search X')).toBeTruthy()
    expect(searchMock).not.toHaveBeenCalled()

    await typeQuery('nothingmatches')
    await screen.findByText('No results')
  })

  it('shows the auth gate when unauthenticated', async () => {
    searchMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })

    render(<HumanSearch />)
    await typeQuery('x')
    await screen.findByText(/log in to x.com to search/i)
  })

  it('renders the operational error with retry for rate limits', async () => {
    searchMock
      .mockResolvedValueOnce({
        ok: false,
        error: appError({
          category: 'rate-limit',
          retryable: true,
          action: 'retry',
          message: 'X is rate limiting requests.',
          retryAfterMs: 300_000,
        }),
      })
      .mockResolvedValueOnce(okPage([makeTweet('r1', '2026-08-20T10:00:00Z', 'recovered')], false))

    render(<HumanSearch />)
    await typeQuery('x')
    expect(await screen.findByText('X is rate limiting requests.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('recovered')
  })
})
