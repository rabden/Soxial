/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { TwitterReplyPreview } from '../src/components/ui/tweet-card'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
  ;(window as any).api = undefined
})

describe('TwitterReplyPreview — X thread parity', () => {
  it('renders the draft through the same feed TweetCard path as the original', () => {
    const onPost = vi.fn()
    const { container } = render(
      <TwitterReplyPreview
        original={{
          authorName: 'IamNathan',
          authorHandle: 'ProlificIA',
          content: 'Motion apps...',
        }}
        replyContent="gsap for scroll-driven work, no contest."
        replyName="Hossain Jahed"
        replyHandle="easemize"
        showPostButton
        onPost={onPost}
      />,
    )

    // Both bodies render.
    expect(screen.getByText('Motion apps...')).toBeTruthy()
    expect(screen.getByText('gsap for scroll-driven work, no contest.')).toBeTruthy()

    // The draft gets a full feed header (name + @handle), not a plain <p>.
    expect(screen.getByText('Hossain Jahed')).toBeTruthy()
    expect(screen.getByText('@easemize')).toBeTruthy()

    // One-to-one: both rows expose the feed action bar (Reply affordance each).
    expect(screen.getAllByRole('button', { name: 'Reply' })).toHaveLength(2)

    // The old muted proposal box is gone.
    expect(container.querySelector('.bg-muted\\/50')).toBeNull()

    // Approval affordance survives.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onPost).toHaveBeenCalledTimes(1)
  })

  it('renders a posted reply pair as two feed rows joined by the thread spine', async () => {
    ;(window as any).api = {
      twitterTweet: vi.fn((id: string) =>
        Promise.resolve({
          ok: true,
          data: [
            {
              id,
              text: id === '111' ? 'original post' : 'posted reply',
              author: { screenName: id === '111' ? 'bindureddy' : 'easemize', name: id === '111' ? 'Bindu Reddy' : 'Hossain Jahed' },
            },
          ],
        }),
      ),
    }

    const { container } = render(<TwitterReplyPreview originalId="111" replyId="222" />)

    await waitFor(() => expect(screen.getByText('original post')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('posted reply')).toBeTruthy())

    // Thread spine segments (avatar gutter, X-style) are present.
    const spines = container.querySelectorAll('div[aria-hidden="true"].bg-white\\/\\[0\\.12\\]')
    expect(spines.length).toBeGreaterThanOrEqual(2)

    // Both rows are feed cards with action bars.
    expect(screen.getAllByRole('button', { name: 'Reply' })).toHaveLength(2)
  })
})
