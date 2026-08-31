/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { TweetCard } from '../src/components/ui/tweet-card'

/**
 * Issue #81 regression: tweets cached before the url-entities CLI patch
 * carry payloads with only the first 4 expanded urls (`legacy.entities.urls`
 * mirrors 4 of 8 for note tweets). post-cache served them fresh for the
 * full 14-day TTL, so TweetCard never refetched and links 5-8 stayed raw
 * t.co. The legacy envelope must read as stale so the SWR background
 * refresh replaces the payload on first render.
 */

const TWEET_ID = '2089263766428950683'
const TCO = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].map((s) => `https://t.co/${s}`)
const EXPANDED = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => `https://example.com/${s}`)
const TEXT_8 = TCO.join(' ')

function legacyTweet() {
  return {
    id: TWEET_ID,
    text: TEXT_8,
    // Pre-patch CLI payload: top-level urls mirror only the first 4 links.
    urls: EXPANDED.slice(0, 4),
    author: { screenName: 'neropursue', name: 'Nero' },
  }
}

function patchedTweet() {
  return {
    id: TWEET_ID,
    text: TEXT_8,
    urls: EXPANDED,
    entities: {
      urls: TCO.map((tco, i) => ({ url: tco, expanded_url: EXPANDED[i] })),
    },
    author: { screenName: 'neropursue', name: 'Nero' },
  }
}

function seedLegacyCache() {
  localStorage.setItem(
    `pc:tw:${TWEET_ID}`,
    JSON.stringify({ data: [legacyTweet()], ts: Date.now() }), // fresh ts, no version
  )
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('TweetCard stale-cache refresh (issue #81)', () => {
  it('background-refreshes a legacy-envelope cache hit and expands all 8 links', async () => {
    seedLegacyCache()
    const twitterTweet = vi.fn(() => Promise.resolve({ ok: true, data: [patchedTweet()] }))
    ;(window as any).api = {
      twitterTweet,
      fetchLinkPreview: vi.fn(() => Promise.resolve({})),
    }

    render(<TweetCard tweetId={TWEET_ID} />)

    // SWR: the legacy payload renders immediately (4 expanded, 4 raw)…
    expect(screen.getByText(/example\.com\/a/)).toBeTruthy()

    // …then the background refresh lands and every link is expanded.
    await waitFor(() => {
      expect(screen.queryByText(/t\.co\//)).toBeNull()
    })
    for (const url of EXPANDED) {
      expect(screen.getByText(new RegExp(url.replace(/\//g, '\\/')))).toBeTruthy()
    }

    expect(twitterTweet).toHaveBeenCalledWith(TWEET_ID)
    // The refresh must rewrite the entry in the current envelope so it
    // never goes through this migration again.
    const envelope = JSON.parse(localStorage.getItem(`pc:tw:${TWEET_ID}`)!)
    expect(typeof envelope.v).toBe('number')
    expect(envelope.v).toBeGreaterThan(1)
  })

  it('does not refetch a current-version fresh cache hit', async () => {
    // Current envelope: written through cachePost semantics (v + data + ts).
    const fresh = { v: 2, data: [patchedTweet()], ts: Date.now() }
    localStorage.setItem(`pc:tw:${TWEET_ID}`, JSON.stringify(fresh))
    const twitterTweet = vi.fn(() => new Promise(() => {}))
    ;(window as any).api = {
      twitterTweet,
      fetchLinkPreview: vi.fn(() => Promise.resolve({})),
    }

    render(<TweetCard tweetId={TWEET_ID} />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.getByText(/example\.com\/a/)).toBeTruthy()
    expect(twitterTweet).not.toHaveBeenCalled()
  })
})
