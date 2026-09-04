// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('src/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/lib/utils')>()
  return { ...actual, openExternalUrl: vi.fn() }
})

import { openExternalUrl } from 'src/lib/utils'
import { TweetCard } from '../src/components/ui/tweet-card'

const replyMock = vi.fn()
const profileMock = vi.fn()
const pickImagesMock = vi.fn()
const dataUrlMock = vi.fn()
const draftMock = vi.fn()

beforeEach(() => {
  cleanup()
  // VideoMedia (rendered behind the modal for media-bearing tweets) needs these.
  class StubIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  ;(globalThis as any).IntersectionObserver = StubIntersectionObserver
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  replyMock.mockReset()
  profileMock.mockReset()
  pickImagesMock.mockReset()
  dataUrlMock.mockReset()
  draftMock.mockReset()
  ;(globalThis as any).window.api = {
    humanReply: replyMock,
    humanProfile: profileMock,
    pickReplyImages: pickImagesMock,
    mediaDataUrl: dataUrlMock,
    humanReplyDraft: draftMock,
  }
})

afterEach(cleanup)

function renderCard() {
  return render(
    <TweetCard
      variant="feed"
      id="123456"
      authorName="Danny Postma"
      authorHandle="dannypostma"
      authorImage="https://pbs.twimg.com/profile_images/1/abc_400x400.jpg"
      content="made a little design workbench"
      replies={2}
      timestamp="2026-08-28T10:00:00Z"
    />,
  )
}

describe('ReplyModal — Human comment dialog seam', () => {
  it('opens from the Reply button with the quoted tweet context', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    // Original tweet context (card behind + modal copy) + reply-to line
    expect(screen.getAllByText('Danny Postma').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('made a little design workbench').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Replying to')).toBeTruthy()
    expect(screen.getAllByText('@dannypostma').length).toBeGreaterThanOrEqual(2)
    // Composer placeholder
    expect(screen.getByPlaceholderText('Post your reply')).toBeTruthy()
    // Submit disabled while empty
    expect((screen.getByTestId('reply-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits the composed reply through the human reply bridge', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    replyMock.mockResolvedValue({ ok: true, data: { tweetId: '999', replyTo: '123456', url: 'https://x.com/i/status/999' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const textarea = (await screen.findByTestId('reply-textarea')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'nah man it sucks' } })

    const submit = screen.getByTestId('reply-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(replyMock).toHaveBeenCalledTimes(1))
    expect(replyMock).toHaveBeenCalledWith({ tweetId: '123456', text: 'nah man it sucks', imagePaths: [] })
    // Success beat + parent count bump (2 replies → 3)
    expect(await screen.findByText('Reply posted')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy())
  })

  it('attaches picked images and posts with their paths', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    pickImagesMock.mockResolvedValue({ ok: true, paths: ['/tmp/pic.png'] })
    dataUrlMock.mockResolvedValue({ success: true, dataUrl: 'data:image/png;base64,QUJD' })
    replyMock.mockResolvedValue({ ok: true, data: { tweetId: '999', replyTo: '123456' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const textarea = await screen.findByTestId('reply-textarea')

    // Native picker resolves paths in main; preview loads as a data URL.
    fireEvent.click(screen.getByRole('button', { name: 'Add images' }))
    await waitFor(() => expect(screen.getByAltText('attachment /tmp/pic.png')).toBeTruthy())

    fireEvent.change(textarea, { target: { value: 'with a photo' } })
    fireEvent.click(screen.getByTestId('reply-submit'))

    await waitFor(() => expect(replyMock).toHaveBeenCalledTimes(1))
    expect(replyMock).toHaveBeenCalledWith({
      tweetId: '123456',
      text: 'with a photo',
      imagePaths: ['/tmp/pic.png'],
    })
  })

  it('surfaces connector errors inline instead of closing', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    replyMock.mockResolvedValue({
      ok: false,
      error: { category: 'internal', code: 'TWITTER_API', message: 'You attempted to reply to a deleted Tweet', retryable: false },
    })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const textarea = await screen.findByTestId('reply-textarea')
    fireEvent.change(textarea, { target: { value: 'hi' } })
    fireEvent.click(screen.getByTestId('reply-submit'))

    expect(await screen.findByText('You attempted to reply to a deleted Tweet')).toBeTruthy()
    // Modal stays open for retry
    expect(screen.getByTestId('reply-textarea')).toBeTruthy()
  })

  it('clicks inside the dialog or on the card never open the browser', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const dialog = await screen.findByRole('dialog')

    // Anywhere inside the dialog — including the dimmed backdrop.
    fireEvent.click(dialog)
    fireEvent.click(screen.getByTestId('reply-textarea'))
    // Anywhere on the card behind it.
    fireEvent.click(screen.getAllByText('made a little design workbench')[0])

    // (Backdrop dismissal itself is radix's tested behaviour — not asserted
    // here; jsdom lacks the pointer events it prefers.)
    expect(openExternalUrl).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on the X button without submitting', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('drafts with AI in one shot: fills the composer, shows archetype hint, enables submit', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    draftMock.mockResolvedValue({
      ok: true,
      data: { text: 'ngl this workbench is neat', archetype: 'blunt one-liner', why: 'adds a concrete use case' },
    })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByTestId('reply-textarea')

    fireEvent.click(screen.getByTestId('ai-draft-button'))

    await waitFor(() => {
      expect((screen.getByTestId('reply-textarea') as HTMLTextAreaElement).value).toBe('ngl this workbench is neat')
    })
    expect(await screen.findByTestId('ai-draft-hint')).toBeTruthy()
    expect(screen.getByText(/blunt one-liner/)).toBeTruthy()
    // The request carried the composer's effective limit and target context.
    expect(draftMock).toHaveBeenCalledWith(expect.objectContaining({
      tweetId: '123456',
      authorHandle: 'dannypostma',
      content: 'made a little design workbench',
      charLimit: 280,
    }))
    // Drafted text is immediately submittable (still requires the user's click).
    expect((screen.getByTestId('reply-submit') as HTMLButtonElement).disabled).toBe(false)
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('regenerate passes the previous draft so the angle varies', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    draftMock.mockResolvedValue({ ok: true, data: { text: 'draft one', archetype: 'question' } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByTestId('ai-draft-button')
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    await waitFor(() => expect((screen.getByTestId('reply-textarea') as HTMLTextAreaElement).value).toBe('draft one'))

    fireEvent.click(screen.getByTestId('ai-draft-button'))
    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2))
    expect(draftMock.mock.calls[1][0].previousDrafts).toEqual(['draft one'])
  })

  it('shows the refusal inline as a hint without touching the composer', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    draftMock.mockResolvedValue({
      ok: true,
      data: { refused: { reason: 'Video posts cannot be AI-drafted (media safety). Write your own reply instead.' } },
    })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByTestId('ai-draft-button')
    fireEvent.click(screen.getByTestId('ai-draft-button'))

    expect(await screen.findByTestId('ai-draft-hint')).toBeTruthy()
    expect(screen.getByText(/Video posts cannot be AI-drafted/)).toBeTruthy()
    expect((screen.getByTestId('reply-textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('disables the AI button outright for native video tweets', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    render(
      <TweetCard
        variant="feed"
        id="777"
        authorName="V"
        authorHandle="v"
        content="watch this clip"
        attachments={[{ type: 'video', url: 'https://video.twimg.com/clip.mp4' }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const button = (await screen.findByTestId('ai-draft-button')) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/media safety/i)
    expect(draftMock).not.toHaveBeenCalled()
  })

  it('surfaces a soft failure hint when the draft bridge fails', async () => {
    profileMock.mockResolvedValue({ ok: true, data: { screenName: 'me', name: 'Me' } })
    draftMock.mockResolvedValue({ ok: false, error: { category: 'internal', code: 'X', message: 'boom', retryable: true } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByTestId('ai-draft-button')
    fireEvent.click(screen.getByTestId('ai-draft-button'))

    expect(await screen.findByTestId('ai-draft-hint')).toBeTruthy()
    expect(screen.getByText(/Draft failed — try again/)).toBeTruthy()
    expect((screen.getByTestId('reply-textarea') as HTMLTextAreaElement).value).toBe('')
  })
})
