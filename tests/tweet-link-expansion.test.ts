/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { expandTweetLinks } from '../src/components/ui/post-attachment'

/**
 * Issue #81 data contract for t.co expansion. The patched twitter-cli emits
 * `entities.urls` with the full t.co→expanded map (note tweets carry 8+ links;
 * top-level `urls` only mirror the first 4). These cases pin why post-cache
 * must invalidate pre-entities payloads: no renderer-side logic can recover
 * links 5+ from a legacy payload.
 */

const TCO = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].map((s) => `https://t.co/${s}`)
const EXPANDED = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => `https://example.com/${s}`)
const TEXT_8 = TCO.join(' ')

describe('expandTweetLinks (issue #81 contract)', () => {
  it('expands all 8 links when entities.urls carries the full t.co→expanded map', () => {
    const raw = {
      text: TEXT_8,
      urls: EXPANDED,
      entities: { urls: TCO.map((tco, i) => ({ url: tco, expanded_url: EXPANDED[i] })) },
    }

    const out = expandTweetLinks(TEXT_8, raw)

    expect(out).not.toContain('t.co/')
    for (const url of EXPANDED) expect(out).toContain(url)
  })

  it('legacy payload (4 mirrored urls, no entities) leaves links 5-8 raw — the reported symptom', () => {
    const out = expandTweetLinks(TEXT_8, { text: TEXT_8, urls: EXPANDED.slice(0, 4) })

    for (const url of EXPANDED.slice(0, 4)) expect(out).toContain(url)
    for (const tco of TCO.slice(4)) expect(out).toContain(tco)
  })

  it('leaves media t.co links untouched for the media renderer to strip', () => {
    const raw = {
      text: 'shot https://t.co/pic1 and https://t.co/a1',
      media: [{ type: 'photo', url: 'https://t.co/pic1', mediaUrlHttps: 'https://pbs.twimg.com/media/x.jpg' }],
      entities: { urls: [{ url: 'https://t.co/a1', expanded_url: 'https://example.com/a' }] },
    }

    const out = expandTweetLinks(raw.text, raw)

    expect(out).toContain('https://t.co/pic1')
    expect(out).toContain('https://example.com/a')
  })
})
