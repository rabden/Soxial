/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { RedditPostCard, RedditReplyPreview } from '../src/components/ui/reddit-post-card'
import { RichContent } from '../src/components/rich-content'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
  ;(window as any).api = undefined
})

const inlinePost = {
  id: 'drft9',
  title: 'Muse Spark any good?',
  // Prefixed, the way the old prompt told the model to emit it — the card
  // must still render a single r/ prefix.
  subreddit: 'r/LocalLLaMA',
  author: 'u/someone',
  selftext: 'Looking for real-world takes.',
  score: 12,
  numComments: 3,
}

describe('RedditReplyPreview — reddit-native, never twitter visuals', () => {
  it('renders the draft as a reddit comment under the post card', () => {
    const onPost = vi.fn()
    const { container } = render(
      <RedditReplyPreview
        original={inlinePost}
        replyContent="terra at that price is already a win."
        replyName="easemize"
        showPostButton
        onPost={onPost}
      />,
    )

    // Post card intact, prefixes normalized (no r/r/ or u/u/).
    expect(screen.getByText('Muse Spark any good?')).toBeTruthy()
    expect(screen.getByText('r/LocalLLaMA')).toBeTruthy()
    expect(container.textContent).not.toContain('r/r/LocalLLaMA')
    expect(screen.getByText('u/someone')).toBeTruthy()
    expect(container.textContent).not.toContain('u/u/someone')

    // Draft reads as a reddit comment: u/author + body.
    expect(screen.getByText('u/easemize')).toBeTruthy()
    expect(screen.getByText('terra at that price is already a win.')).toBeTruthy()
    expect(screen.getByText('Proposed comment as easemize')).toBeTruthy()

    // No Twitter chrome: no feed Reply buttons, no old muted proposal box.
    expect(screen.queryAllByRole('button', { name: 'Reply' })).toHaveLength(0)
    expect(container.querySelector('.bg-muted\\/50')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onPost).toHaveBeenCalledTimes(1)
  })

  it('renders a posted reply as a single post with the comment highlighted', async () => {
    ;(window as any).api = {
      redditRead: vi.fn(() =>
        Promise.resolve({
          ok: true,
          data: [
            {
              data: {
                children: [
                  {
                    data: {
                      title: 'Muse Spark any good?',
                      subreddit: 'LocalLLaMA',
                      author: 'someone',
                      score: 12,
                      num_comments: 3,
                      url: 'https://reddit.com/r/LocalLLaMA/comments/abc',
                      selftext: 'Looking for real-world takes.',
                      created_utc: Date.now() / 1000 - 7200,
                    },
                  },
                ],
              },
            },
            {
              data: {
                children: [
                  {
                    kind: 't1',
                    data: {
                      id: 'c1',
                      author: 'easemize',
                      body: 'terra at that price is already a win.',
                      score: 5,
                      created_utc: Date.now() / 1000 - 3600,
                      replies: '',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    }

    render(<RedditReplyPreview postId="abc123" replyId="c1" />)

    await waitFor(() => expect(screen.getByText('Muse Spark any good?')).toBeTruthy())
    // The post must not render twice (previous version stacked two cards).
    expect(screen.getAllByText('Muse Spark any good?')).toHaveLength(1)
    expect(screen.getByText('terra at that price is already a win.')).toBeTruthy()
  })

  it('normalizes prefixes on the bare post card too', () => {
    const { container } = render(
      <RedditPostCard title="T" subreddit="r/example" author="u/who" score={1} numComments={0} />,
    )
    expect(screen.getByText('r/example')).toBeTruthy()
    expect(container.textContent).not.toContain('r/r/example')
    expect(container.textContent).not.toContain('u/u/who')
  })
})

describe('rich-content reply routing — reddit payloads never take the twitter path', () => {
  it.each(['reply-preview', 'twitter-reply-preview'])(
    'routes :::%s with postId to the reddit preview',
    async (fence) => {
      ;(window as any).api = {
        // Never resolves: the post body stays loading, but the reddit chrome
        // (header + draft comment) renders immediately — proving the payload
        // did not go through TwitterReplyPreview.
        redditRead: vi.fn(() => new Promise(() => {})),
      }
      const { container } = render(
        <RichContent>{`:::${fence} {"postId":"zzz999","reply":"useful comment here","showPostButton":true}\n:::`}</RichContent>,
      )

      expect(screen.getByText('Proposed comment')).toBeTruthy()
      expect(screen.getByText('u/You')).toBeTruthy()
      expect(screen.getByText('useful comment here')).toBeTruthy()
      expect(screen.getByText('Loading Reddit post and comments...')).toBeTruthy()
      expect(container.textContent).not.toContain('Loading tweet thread...')
    },
  )
})
