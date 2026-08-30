/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

/**
 * Blank-screen regression (2026-08-30): a chat tweet-preview card flipped to
 * `loading` mid-life and hit TweetCard's early returns BEFORE its optimistic-
 * state hooks — "Rendered fewer hooks than expected" tore the whole tree down.
 * The early returns must sit below every hook, and any residual render fault
 * in a card degrades to a fallback instead of a blank app.
 */
import { TweetCard } from '../src/components/ui/tweet-card'
import { RenderErrorBoundary } from '../src/components/ui/render-error-boundary'

beforeEach(() => {
  cleanup()
})
afterEach(() => {
  cleanup()
})

describe('TweetCard hooks-order regression (blank screen fix)', () => {
  it('survives the preview fetch flipping to loading mid-life', async () => {
    // Preview path: tweetId without content — the mount effect fetches and
    // setLoading(true) re-renders into what used to be the early-return
    // before the remaining hooks.
    ;(window as any).api = {
      twitterTweet: vi.fn(() => new Promise(() => {})), // never resolves: stays loading
    }

    function Host() {
      const [mount, setMount] = React.useState(false)
      React.useEffect(() => {
        // One static re-render after mount, then the fetch effect flips
        // loading on the NEXT pass — mirroring the chat preview sequence.
        const t = setTimeout(() => setMount(true), 0)
        return () => clearTimeout(t)
      }, [])
      return <TweetCard tweetId="2089263766428950683" preview={mount} />
    }

    render(<Host />)

    // The loading fallback renders, and the app did not crash.
    await waitFor(() => expect(screen.getByText('Loading tweet thread...')).toBeTruthy())
  })

  it('keeps every hook registered across loading and resolved states', async () => {
    let resolveFetch: (v: any) => void = () => {}
    ;(window as any).api = {
      twitterTweet: vi.fn(() => new Promise((res) => { resolveFetch = res })),
    }

    const { rerender } = render(<TweetCard tweetId="123" />)
    await waitFor(() => expect(screen.getByText('Loading tweet thread...')).toBeTruthy())

    resolveFetch({
      ok: true,
      data: [{ id: '123', text: 'resolved body', author: { screenName: 'a', name: 'A' } }],
    })
    await waitFor(() => expect(screen.getByText('resolved body')).toBeTruthy())
    // A prop update after full resolution must not desync hooks either.
    rerender(<TweetCard tweetId="123" preview />)
    expect(screen.getByText('resolved body')).toBeTruthy()
  })
})

describe('RenderErrorBoundary', () => {
  function Boom(): never {
    throw new Error('card exploded')
  }

  it('degrades a throwing card to an inline fallback', () => {
    render(
      <RenderErrorBoundary label="the tweet card">
        <Boom />
      </RenderErrorBoundary>,
    )
    expect(screen.getByTestId('render-error-fallback').textContent).toContain('Could not render the tweet card')
    expect(screen.getByTestId('render-error-fallback').textContent).toContain('card exploded')
  })

  it('renders healthy content untouched', () => {
    render(
      <RenderErrorBoundary label="the tweet card">
        <div>all good</div>
      </RenderErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.queryByTestId('render-error-fallback')).toBeNull()
  })
})
