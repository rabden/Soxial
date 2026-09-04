// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanTweet, HumanUser, Paginated } from 'src/features/human/types'

vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))

import HumanProfile from 'src/features/human/components/HumanProfile'

import {
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  markSentinelIntersecting,
} from './helpers/human-ui-mocks'

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
  installFakeIntersectionObserver()
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

  it('separates Posts and Replies by sub-tab, mounting Replies lazily and keeping Posts alive', async () => {
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

    expect(postsMock).toHaveBeenLastCalledWith({ subTab: 'replies', count: 10, until: undefined })
    // Keep-alive: the Posts list stays mounted (hidden) with its items.
    expect(screen.getByText('my post')).toBeTruthy()
  })

  it('grows the Posts page count (user-posts has no cursor)', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockImplementation(async (req: { subTab: string; count?: number }) => {
      if (req.subTab !== 'posts') return okPage([], false)
      const count = req.count ?? 10
      const items = Array.from(
        { length: count },
        (_, i) => makeTweet(`p${i + 1}`, `2026-08-${String(28 - Math.floor(i / 2)).padStart(2, '0')}T10:00:00Z`),
      )
      return okPage(items, count < 30)
    })

    render(<HumanProfile />)
    await screen.findByText('post-p1')

    markSentinelIntersecting()
    await screen.findByText('post-p20')

    expect(postsMock).toHaveBeenCalledTimes(2)
    expect(postsMock.mock.calls[1][0]).toEqual({ subTab: 'posts', count: 20 })
  })

  it('advances the Replies date window from the oldest seen item', async () => {
    profileMock.mockResolvedValue({ ok: true, data: alice })
    postsMock.mockImplementation(async (req: { subTab: string; until?: string }) => {
      if (req.subTab !== 'replies') return okPage([], false)
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
    fireEvent.click(await screen.findByRole('button', { name: 'Replies' }))
    await screen.findByText('post-1')

    markSentinelIntersecting()
    await screen.findByText('post-4')

    expect(postsMock).toHaveBeenLastCalledWith({ subTab: 'replies', count: 10, until: '2026-08-25' })
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
