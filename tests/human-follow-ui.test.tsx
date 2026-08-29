// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AppError } from 'src/types/app-error'
import type { HumanResult, HumanUser, Paginated } from 'src/features/human/types'

vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))

import HumanFollow from 'src/features/human/components/HumanFollow'

import {
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  markSentinelIntersecting,
} from './helpers/human-ui-mocks'

const listMock = vi.fn()
const actionMock = vi.fn()
const verifyMock = vi.fn()

function makeUser(screenName: string, extra: Partial<HumanUser> = {}): HumanUser {
  return {
    screenName,
    name: screenName.toUpperCase(),
    bio: `bio of ${screenName}`,
    verified: false,
    profileImageUrl: `https://x.com/${screenName}.png`,
    ...extra,
  }
}

function okPage(items: HumanUser[], hasMore: boolean): HumanResult<Paginated<HumanUser>> {
  return { ok: true, data: { items, hasMore } }
}

function appError(overrides: Partial<AppError>): AppError {
  return { code: 'TEST_ERROR', category: 'internal', message: 'boom', retryable: false, ...overrides }
}

beforeEach(() => {
  cleanup()
  installFakeIntersectionObserver()
  ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
  listMock.mockReset()
  actionMock.mockReset()
  verifyMock.mockReset()
  ;(window as any).api = {
    platform: 'linux',
    humanFollowList: listMock,
    humanFollowAction: actionMock,
    humanVerifySession: verifyMock,
  }
})

afterEach(cleanup)

describe('HumanFollow — renderer seam (T6)', () => {
  it('renders person rows with avatar, name, badge, handle and bio', async () => {
    listMock.mockResolvedValue(
      okPage([makeUser('bob', { verified: true }), makeUser('carol')], false),
    )

    render(<HumanFollow />)
    await screen.findByText('BOB')

    expect(screen.getByText('@bob')).toBeTruthy()
    expect(screen.getByText('bio of bob')).toBeTruthy()
    expect(screen.getByText('@carol')).toBeTruthy()
    // Following list rows start followed.
    expect(screen.getByRole('button', { name: 'Following bob' })).toBeTruthy()
    // Hover affordance for followed rows: the hidden Unfollow label exists.
    expect(screen.getAllByText('Unfollow').length).toBeGreaterThan(0)
  })

  it('switches Following → Followers, mounting the second list lazily and keeping the first alive', async () => {
    listMock.mockImplementation(async (req: { subTab: string }) =>
      req.subTab === 'followers'
        ? okPage([makeUser('pat')], false)
        : okPage([makeUser('bob')], false),
    )

    render(<HumanFollow />)
    await screen.findByText('@bob')

    fireEvent.click(screen.getByRole('button', { name: 'Followers' }))
    await screen.findByText('@pat')

    expect(listMock).toHaveBeenLastCalledWith({ subTab: 'followers', count: 10 })
    // Follower relationships start unknown → Follow pill.
    expect(screen.getByRole('button', { name: 'Follow pat' })).toBeTruthy()
    // Keep-alive: the Following list stays mounted (hidden) with its rows.
    expect(screen.getByText('@bob')).toBeTruthy()
    // Switching back is instant — no additional request.
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))
    await screen.findByText('@bob')
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('flips Follow → Following optimistically and rolls back on failure', async () => {
    listMock.mockImplementation(async (req: { subTab: string }) =>
      req.subTab === 'followers'
        ? okPage([makeUser('pat')], false)
        : okPage([makeUser('bob')], false),
    )
    let settleWrite: ((value: HumanResult<{ handle: string; following: boolean }>) => void) | undefined
    actionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleWrite = resolve
        }),
    )

    render(<HumanFollow />)
    // Follower relationships start unknown → the pill offers Follow.
    fireEvent.click(screen.getByRole('button', { name: 'Followers' }))
    await screen.findByText('@pat')

    fireEvent.click(screen.getByRole('button', { name: 'Follow pat' }))
    // Optimistic: flips immediately while the write is in flight.
    expect(screen.getByRole('button', { name: 'Following pat' })).toBeTruthy()

    settleWrite?.({ ok: false, error: appError({ category: 'rate-limit', retryable: true, action: 'retry' }) })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Follow pat' })).toBeTruthy())
  })

  it('keeps the optimistic state when the write succeeds', async () => {
    listMock.mockImplementation(async (req: { subTab: string }) =>
      req.subTab === 'followers'
        ? okPage([makeUser('pat')], false)
        : okPage([makeUser('bob')], false),
    )
    actionMock.mockResolvedValue({ ok: true, data: { handle: 'pat', following: true } })

    render(<HumanFollow />)
    fireEvent.click(screen.getByRole('button', { name: 'Followers' }))
    await screen.findByText('@pat')

    fireEvent.click(screen.getByRole('button', { name: 'Follow pat' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Following pat' })).toBeTruthy())
    expect(actionMock).toHaveBeenCalledWith({ handle: 'pat', action: 'follow' })
  })

  it('grows the requested count by 10 per page with dedupe', async () => {
    listMock.mockImplementation(async (req: { count?: number }) => {
      const count = req.count ?? 10
      const items = Array.from({ length: Math.min(count, 15) }, (_, i) => makeUser(`u${i + 1}`))
      return okPage(items, count < 15)
    })

    render(<HumanFollow />)
    await screen.findByText('@u1')

    markSentinelIntersecting()
    await screen.findByText('@u15')

    expect(listMock).toHaveBeenLastCalledWith({ subTab: 'following', count: 20 })
  })

  it('shows the auth gate when unauthenticated', async () => {
    listMock.mockResolvedValue({ ok: false, error: appError({ category: 'auth', action: 'reauthenticate' }) })

    render(<HumanFollow />)
    await screen.findByText(/log in to x.com to see your network/i)
  })

  it('renders the operational error with retry', async () => {
    listMock
      .mockResolvedValueOnce({
        ok: false,
        error: appError({ category: 'network', retryable: true, action: 'retry', message: 'X is unreachable.' }),
      })
      .mockResolvedValueOnce(okPage([makeUser('bob')], false))

    render(<HumanFollow />)
    expect(await screen.findByText('X is unreachable.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('@bob')
  })

  it('shows friendly copy for empty lists', async () => {
    listMock.mockResolvedValue(okPage([], false))

    render(<HumanFollow />)
    expect(await screen.findByText('Not following anyone yet')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Followers' }))
    await screen.findByText('No followers yet')
  })

  it('locks sub-tabs and pills while disabled (rebuild lock)', async () => {
    listMock.mockResolvedValue(okPage([makeUser('bob')], false))

    render(<HumanFollow disabled />)
    await screen.findByText('@bob')

    expect((screen.getByRole('button', { name: 'Followers' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Following bob' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
