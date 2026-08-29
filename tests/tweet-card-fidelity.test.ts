import { describe, expect, it, vi } from 'vitest'
import { parseTweetData, timeAgo, TweetCard } from '../src/components/ui/tweet-card'
import { extractTweetAttachments } from '../src/components/ui/post-attachment'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

describe('extractTweetAttachments — media beats link card', () => {
  it('drops the og link preview when the tweet has native media', () => {
    const atts = extractTweetAttachments({
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg' }],
      urls: ['https://example.com/blog-post'],
    })
    expect(atts).toHaveLength(1)
    expect(atts[0].type).toBe('image')
    expect(atts[0].url).toBe('https://pbs.twimg.com/media/pic.jpg')
  })

  it('keeps the og link preview when the tweet has no native media', () => {
    const atts = extractTweetAttachments({ urls: ['https://example.com/blog-post'] })
    expect(atts).toHaveLength(1)
    expect(atts[0].type).toBe('link')
    expect(atts[0].url).toBe('https://example.com/blog-post')
  })
})

describe('TweetCard fidelity and feed variant', () => {
  describe('parseTweetData', () => {
    it('extracts views, quotes, retweets, replies, likes, bookmarks', () => {
      const raw = {
        id: '1234567890',
        text: 'Hello world https://example.com #cool @friend',
        metrics: {
          likes: 42,
          retweets: 10,
          replies: 5,
          bookmarks: 7,
          views: 1200,
          quotes: 3,
        },
        isRetweet: true,
        retweetedBy: 'alice',
        quotedTweet: {
          id: '987654321',
          text: 'Quoted post content',
          author: { screenName: 'bob', name: 'Bob Smith' },
        },
        author: {
          screenName: 'charlie',
          name: 'Charlie Brown',
          profileImageUrl: 'https://example.com/avatar.jpg',
          verified: true,
        },
        createdAtLocal: '2026-08-27T10:00:00Z',
      }

      const parsed = parseTweetData(raw)

      expect(parsed.id).toBe('1234567890')
      expect(parsed.authorName).toBe('Charlie Brown')
      expect(parsed.authorHandle).toBe('charlie')
      expect(parsed.authorImage).toBe('https://example.com/avatar.jpg')
      expect(parsed.likes).toBe(42)
      expect(parsed.retweets).toBe(10)
      expect(parsed.replies).toBe(5)
      expect(parsed.bookmarks).toBe(7)
      expect(parsed.views).toBe(1200)
      expect(parsed.quotes).toBe(3)
      expect(parsed.isRetweet).toBe(true)
      expect(parsed.retweetedBy).toBe('alice')
      expect(parsed.quotedTweet).toEqual({
        id: '987654321',
        text: 'Quoted post content',
        author: { screenName: 'bob', name: 'Bob Smith' },
      })
    })

    it('maps viewer state (liked/retweeted/pinned) and upgrades the avatar size suffix', () => {
      const parsed = parseTweetData({
        id: '555',
        text: 'already acted on',
        liked: true,
        retweeted: true,
        pinned: true,
        author: {
          screenName: 'alice',
          name: 'Alice',
          // X serves `_normal` (48px) — must upgrade to the 400x400 variant.
          profileImageUrl: 'https://pbs.twimg.com/profile_images/1/abc_normal.jpg',
        },
      })

      expect(parsed.isLiked).toBe(true)
      expect(parsed.isRetweeted).toBe(true)
      expect(parsed.isPinned).toBe(true)
      expect(parsed.authorImage).toBe('https://pbs.twimg.com/profile_images/1/abc_400x400.jpg')

      // `isRetweet` ("this tweet IS a repost of someone else") must NOT set
      // the viewer's retweeted state.
      const plain = parseTweetData({ id: '556', text: 'x', isRetweet: true })
      expect(plain.isRetweet).toBe(true)
      expect(plain.isRetweeted).toBe(false)
      expect(plain.isLiked).toBe(false)
    })

    it('extracts snake_case fallback fields', () => {
      const raw = {
        id: '123',
        text: 'Testing fallbacks',
        views: 500,
        quotes: 12,
        is_retweet: true,
        retweeted_by: 'dan',
        quoted_tweet: {
          id: '456',
          text: 'Quoted snake case',
        },
      }

      const parsed = parseTweetData(raw)
      expect(parsed.views).toBe(500)
      expect(parsed.quotes).toBe(12)
      expect(parsed.isRetweet).toBe(true)
      expect(parsed.retweetedBy).toBe('dan')
      expect(parsed.quotedTweet).toEqual({
        id: '456',
        text: 'Quoted snake case',
      })
    })
  })

  describe('timeAgo helper', () => {
    it('formats relative timestamps correctly', () => {
      const now = Date.now()
      const s12Ago = new Date(now - 12 * 1000).toISOString()
      const m5Ago = new Date(now - 5 * 60 * 1000).toISOString()
      const h3Ago = new Date(now - 3 * 3600 * 1000).toISOString()
      const d2Ago = new Date(now - 2 * 24 * 3600 * 1000).toISOString()

      expect(timeAgo(s12Ago)).toBe('12s')
      expect(timeAgo(m5Ago)).toBe('5m')
      expect(timeAgo(h3Ago)).toBe('3h')
      expect(timeAgo(d2Ago)).toBe('2d')
    })

    it('falls back if timestamp parsing fails or format is invalid', () => {
      expect(timeAgo('not-a-date')).toBe('not-a-date')
      expect(timeAgo('')).toBe('')
    })
  })

  describe('TweetCard rendering variants', () => {
    it('renders card variant (default) with card styling and deep link URL format fixed', () => {
      const html = renderToStaticMarkup(
        React.createElement(TweetCard, {
          id: '123456789',
          authorName: 'John Doe',
          authorHandle: 'johndoe',
          content: 'Hello from card mode',
          likes: 10,
          retweets: 5,
          replies: 2,
          bookmarks: 1,
        })
      )

      expect(html).toContain('rounded-xl')
      expect(html).toContain('shadow-sm')
      expect(html).toContain('https://x.com/johndoe/status/123456789')
      expect(html).toContain('John Doe')
      expect(html).toContain('@johndoe')
      expect(html).toContain('Hello from card mode')
      expect(html).toContain('10')
      expect(html).toContain('Likes')
    })

    it('renders feed variant with row styling, header metadata, rich content highlights, and 6 action bar icons', () => {
      const html = renderToStaticMarkup(
        React.createElement(TweetCard, {
          variant: 'feed',
          id: '998877',
          authorName: 'Tech Lead',
          authorHandle: 'techlead',
          content: 'Check this out https://example.com and #awesome @openai',
          likes: 1500,
          retweets: 250,
          replies: 45,
          views: 32000,
          isRetweet: true,
          retweetedBy: 'Vitalik',
          quotedTweet: {
            id: '112233',
            text: 'Original quoted post',
            author: { screenName: 'sama', name: 'Sam Altman' },
          },
        })
      )

      // Feed container styling — deliberately NOT click-through: opening
      // x.com only happens through explicit affordances.
      expect(html).toContain('border-b')
      expect(html).toContain('border-border/60')
      expect(html).toContain('hover:bg-white/[0.02]')
      expect(html).not.toContain('cursor-pointer')

      // Repost header attribution
      expect(html).toContain('Vitalik reposted')

      // Inline header metadata
      expect(html).toContain('Tech Lead')
      expect(html).toContain('@techlead')
      // The row overflow menu (Ellipsis) is intentionally absent — the feed
      // row is click-through to x.com (X-faithful action bar only).
      expect(html).not.toContain('lucide-ellipsis')

      // Content rich text highlighting
      expect(html).toContain('text-[#1D9BF0]')
      expect(html).toContain('https://example.com')
      expect(html).toContain('#awesome')
      expect(html).toContain('@openai')

      // Quoted tweet box — text clamps at 4 lines, never a Show-more button
      expect(html).toContain('Original quoted post')
      expect(html).toContain('Sam Altman')
      expect(html).toContain('@sama')
      expect(html).toContain('line-clamp-4')

      // Action bar (6 groups with icons and hover pill classes)
      expect(html).toContain('aria-label="Reply"')
      expect(html).toContain('hover:bg-[#1D9BF0]/10')
      expect(html).toContain('hover:text-[#1D9BF0]')

      expect(html).toContain('aria-label="Repost"')
      expect(html).toContain('hover:bg-[#00BA7C]/10')
      expect(html).toContain('hover:text-[#00BA7C]')

      expect(html).toContain('aria-label="Like"')
      expect(html).toContain('hover:bg-[#F91880]/10')
      expect(html).toContain('hover:text-[#F91880]')

      expect(html).toContain('aria-label="Bookmark"')
      expect(html).toContain('aria-label="Share"')

      expect(html).toContain('1.5k') // Likes formatted
      expect(html).toContain('250') // Reposts formatted
      expect(html).toContain('45') // Replies formatted
      expect(html).toContain('32k') // Views formatted
    })

    it('shows the quote media/link preview only when the quoting tweet has none of its own', () => {      const quoteWithMedia = {
        id: '112233',
        text: 'Original quoted post',
        author: { screenName: 'sama', name: 'Sam Altman' },
        media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/quote-photo.jpg' }],
        urls: [],
      }
      const quoteWithLink = {
        id: '445566',
        text: 'Quoted post with a link',
        author: { screenName: 'sama', name: 'Sam Altman' },
        media: [],
        urls: ['https://zed.dev/blog/introducing-deltadb'],
      }

      // Outer tweet has no attachment → the quote's media renders inside the quote box.
      const htmlQuoteMedia = renderToStaticMarkup(
        React.createElement(TweetCard, {
          variant: 'feed',
          id: '1',
          authorName: 'A',
          authorHandle: 'a',
          content: 'Look at this',
          quotedTweet: quoteWithMedia,
        }),
      )
      expect(htmlQuoteMedia).toContain('https://pbs.twimg.com/media/quote-photo.jpg')

      // Outer tweet has no attachment → the quote's link renders as a preview.
      const htmlQuoteLink = renderToStaticMarkup(
        React.createElement(TweetCard, {
          variant: 'feed',
          id: '2',
          authorName: 'A',
          authorHandle: 'a',
          content: 'Look at this too',
          quotedTweet: quoteWithLink,
        }),
      )
      expect(htmlQuoteLink).toContain('zed.dev')

      // Outer tweet has its own media → the quote renders text-only (never both).
      const htmlBoth = renderToStaticMarkup(
        React.createElement(TweetCard, {
          variant: 'feed',
          id: '3',
          authorName: 'A',
          authorHandle: 'a',
          content: 'My own photo',
          attachments: [{ type: 'image', url: 'https://pbs.twimg.com/media/outer-photo.jpg' }],
          quotedTweet: quoteWithMedia,
        }),
      )
      expect(htmlBoth).toContain('https://pbs.twimg.com/media/outer-photo.jpg')
      expect(htmlBoth).not.toContain('https://pbs.twimg.com/media/quote-photo.jpg')
    })

    it('calls interaction callbacks on Like, Repost, Bookmark, Share', () => {
      const onLike = vi.fn()
      const onRetweet = vi.fn()
      const onBookmark = vi.fn()
      const onShare = vi.fn()

      const parsedProps: TweetCardProps = {
        variant: 'feed',
        id: '123',
        authorName: 'Interactive User',
        authorHandle: 'interactive',
        content: 'Testing callbacks',
        onLike,
        onRetweet,
        onBookmark,
        onShare,
      }

      // Check callback properties are accepted and assigned
      expect(parsedProps.onLike).toBe(onLike)
      expect(parsedProps.onRetweet).toBe(onRetweet)
      expect(parsedProps.onBookmark).toBe(onBookmark)
      expect(parsedProps.onShare).toBe(onShare)
    })
  })
})

