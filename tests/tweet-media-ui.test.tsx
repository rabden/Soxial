// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

import { PostAttachments } from '../src/components/ui/post-attachment'
import { TweetCard } from '../src/components/ui/tweet-card'

/* ------------------------------------------------------------------ *
 * jsdom has neither IntersectionObserver nor playable media — stub the
 * observer (VideoMedia's autoplay seam) and drive <video> failures by
 * dispatching error events directly.
 * ------------------------------------------------------------------ */
class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  cleanup()
  ;(globalThis as any).IntersectionObserver = StubIntersectionObserver
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('VideoMedia — transient failure recovery', () => {
  const videoAttachment = [
    { type: 'video', url: 'https://video.twimg.com/ext_tw_video/1/vid/720x1280/clip.mp4?tag=12' },
  ]

  function renderVideo() {
    return render(<PostAttachments attachments={videoAttachment} mediaClassName="rounded-2xl" />)
  }

  it('remounts the video and retries when the stream errors, then recovers', async () => {
    vi.useFakeTimers()
    const { container } = renderVideo()

    const first = container.querySelector('video') as HTMLVideoElement
    expect(first).toBeTruthy()

    // First transient failure → remount after the 400ms backoff.
    fireEvent.error(first)
    expect(container.querySelector('video')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(400)
    })

    const second = container.querySelector('video') as HTMLVideoElement
    expect(second).toBeTruthy()
    expect(second).not.toBe(first) // fresh element — Chromium re-issues the request
  })

  it('gives up after the retry budget and shows the manual recovery escape hatch', () => {
    vi.useFakeTimers()
    const { container } = renderVideo()

    // Initial load + 2 retries all fail.
    for (const delay of [0, 400, 800]) {
      const video = container.querySelector('video') as HTMLVideoElement
      fireEvent.error(video)
      act(() => {
        vi.advanceTimersByTime(delay + 1)
      })
    }
    // The failure after the budget is spent must not remount again.
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)

    expect(screen.getByText('Video failed to load')).toBeTruthy()
    expect(screen.getByText('Open in browser')).toBeTruthy()
    // The dead element is gone.
    expect(container.querySelector('video')).toBeNull()
  })

  it('resets the retry budget when the source changes', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <PostAttachments
        attachments={[{ type: 'video', url: 'https://video.twimg.com/a/1.mp4?tag=12' }]}
      />,
    )

    // Spend one retry on the first source.
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    act(() => {
      vi.advanceTimersByTime(400)
    })

    // New src → fresh budget: two more failures still remount instead of
    // jumping straight to the failure UI.
    rerender(
      <PostAttachments
        attachments={[{ type: 'video', url: 'https://video.twimg.com/a/2.mp4?tag=12' }]}
      />,
    )
    expect(screen.queryByText('Video failed to load')).toBeNull()
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelector('video')).toBeTruthy()
    expect(screen.queryByText('Video failed to load')).toBeNull()
  })
})

describe('Share — copied checkmark keeps the row height stable', () => {
  it('renders the checkmark in a fixed 16×16 box identical to the icon footprint', async () => {
    const { container } = render(
      <TweetCard
        variant="feed"
        id="42"
        authorName="A"
        authorHandle="a"
        content="share me"
      />,
    )

    const shareButton = screen.getByRole('button', { name: 'Share' })
    const icon = shareButton.querySelector('svg')
    expect(icon).toBeTruthy()

    // handleShare awaits the clipboard write before flipping to the check.
    fireEvent.click(shareButton)
    let check: HTMLSpanElement | null = null
    await waitFor(() => {
      check = shareButton.querySelector('span') as HTMLSpanElement | null
      expect(check).toBeTruthy()
    })
    expect(check!.textContent).toBe('✓')
    // Same fixed footprint as the 16px icon (size-4) with no line-box growth
    // (leading-none) — the action row must not change height on swap.
    expect(check!.className).toContain('size-4')
    expect(check!.className).toContain('leading-none')
    // Icon disappears; only the check remains inside the pill.
    expect(shareButton.querySelector('svg')).toBeNull()
    expect(container).toBeTruthy()
  })
})
