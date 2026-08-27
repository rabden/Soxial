// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanTweet, HumanUser, Paginated } from 'src/features/human/types'

vi.mock('motion/react', async () => {
  const React = await import('react')
  const identity =
    (tag: string) =>
    ({ children, ...props }: any) =>
      React.createElement(tag, props, children)
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => identity(tag) }),
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  }
})

import HumanProfile from 'src/features/human/components/HumanProfile'

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void
  constructor(
    callback: (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void,
    _options?: IntersectionObserverInit,
  ) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function markSentinelIntersecting() {
  for (const observer of FakeIntersectionObserver.instances) {
    observer.callback([{ isIntersecting: true }], observer)
  }
}

const profileMock = vi.fn()
const postsMock = vi.fn()
const verifyMock = vi.fn()

const alice: HumanUser = {
  id: '7',
  screenName: 'alice',
  name: 'Alice',
  bio: 'building things',
  location: 'Berlin',
  url: 'https://alice.dev',
  followers: 1200,
  following: 300,
  tweets: 42,
  verified: true,
  profileImageUrl: 'https://x.com/a.png',
  createdAt: '2019-03-05T12:00:00.000Z',
}

function makeTweet(id: string, isoDate: string, text?: string): HumanTweet {
  return {
    id,
    text: text ?? `post-${id}`,
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

beforeEach(() => {
  cleanup()
  FakeIntersectionObserver.instances = []
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  profileMock.mockReset()
  postsMock.mockReset()
  verifyMock.mockReset()
  ;(window as any).api = {
    platform: 'linux',
    humanProfile: profileMock,
    humanProfilePosts: postsMock,
    humanVerifySession: verifyMock,
  }
})

afterEach(cleanup)

describe('HumanProfile — renderer seam', () => {
  it('renders the header from the normalized profile', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockResolvedValue(okPage([], false))

    render(<HumanProfile />)

    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText('building things')).toBeTruthy()
    expect(screen.getByText('Berlin')).toBeTruthy()
    expect(screen.getByText(/Joined March 2019/i)).toBeTruthy()
    expect(screen.getByText('1.2K')).toBeTruthy() // followers
    expect(screen.getByText('300')).toBeTruthy() // following
  })

  it('separates Posts and Replies by sub-tab and resets pagination on switch', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockImplementation(async (req: { subTab: string }) =>
      req.subTab === 'posts'
        ? okPage([makeTweet('p1', '2026-08-20T10:00:00Z', 'my post')], false)
        : okPage([makeTweet('r1', '2026-08-21T10:00:00Z', 'my reply')], false),
    )

    render(<HumanProfile />)
    await screen.findByText('my post')

    fireEvent.click(screen.getByRole('button', { name: 'Replies' }))
    await screen.findByText('my reply')

    expect(screen.queryByText('my post')).toBeNull()
    expect(postsMock).toHaveBeenLastCalledWith({ subTab: 'replies', count: 10, until: undefined })
  })

  it('advances the date window from the oldest seen item, newest-first', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockImplementation(async (req: { until?: string }) => {
      if (!req.until) {
        return okPage(
          [
            makeTweet('1', '2026-08-27T10:00:00Z'),
            makeTweet('2', '2026-08-26T09:00:00Z'),
            makeTweet('3', '2026-08-25T08:00:00Z'),
          ],
          true,
        )
      }
      if (req.until === '2026-08-25') {
        return okPage([makeTweet('4', '2026-08-20T08:00:00Z')], false)
      }
      return okPage([], false)
    })

    render(<HumanProfile />)
    await screen.findByText('post-1')

    markSentinelIntersecting()
    await screen.findByText('post-4')

    expect(postsMock).toHaveBeenCalledTimes(2)
    expect(postsMock.mock.calls[1][0]).toEqual({ subTab: 'posts', count: 10, until: '2026-08-25' })
    expect(screen.getByText(/all caught up/i)).toBeTruthy()
  })

  it('shows the auth gate when unauthenticated', async () => {
    profileMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })
    postsMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })
    verifyMock.mockResolvedValue({ ok: true, data: { authenticated: true, user: null } })

    render(<HumanProfile />)
    await screen.findByText(/log in to x.com to see your profile/i)

    fireEvent.click(screen.getByRole('button', { name: /re-check/i }))
    await vi.waitFor(() => expect(profileMock).toHaveBeenCalledTimes(2))
  })

  it('renders the operational error for non-auth failures', async () => {
    profileMock.mockResolvedValue({
      ok: false,
      error: appError({ category: 'network', retryable: true, action: 'retry', message: 'X is unreachable.' }),
    })
    postsMock.mockResolvedValue(okPage([], false))

    render(<HumanProfile />)
    expect(await screen.findByText('X is unreachable.')).toBeTruthy()
  })

  it('shows empty copy per sub-tab', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockResolvedValue(okPage([], false))

    render(<HumanProfile />)
    expect(await screen.findByText('No posts yet')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Replies' }))
    await screen.findByText('No replies yet')
  })
})
