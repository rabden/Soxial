/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedPost, cachePost } from '../src/lib/post-cache'

beforeEach(() => {
  localStorage.clear()
})

describe('post-cache envelope versioning', () => {
  it('treats legacy (unversioned) envelopes as stale so consumers background-refresh them', () => {
    // Shape written before the envelope gained a version: { data, ts }.
    // These hold pre-url-entities tweet payloads (4/8 link expansion) and
    // must not be served fresh for a full TTL window.
    localStorage.setItem(
      'pc:tw:1',
      JSON.stringify({ data: [{ id: '1', urls: ['https://example.com/1'] }], ts: Date.now() }),
    )

    const cached = getCachedPost('tw:1')!

    expect(cached).not.toBeNull()
    expect(cached.data[0].id).toBe('1')
    expect(cached.isStale).toBe(true)
  })

  it('serves current-version envelopes fresh within the TTL', () => {
    cachePost('tw:2', [{ id: '2' }])

    expect(getCachedPost('tw:2')).toEqual({ data: [{ id: '2' }], isStale: false })
  })

  it('writes the current envelope version so future migrations have an anchor', () => {
    cachePost('tw:2b', [{ id: '2b' }])

    const envelope = JSON.parse(localStorage.getItem('pc:tw:2b')!)
    expect(typeof envelope.v).toBe('number')
    expect(envelope.v).toBeGreaterThan(1)
  })

  it('marks current-version envelopes stale after the TTL', () => {
    cachePost('tw:3', [{ id: '3' }])
    const envelope = JSON.parse(localStorage.getItem('pc:tw:3')!)
    localStorage.setItem(
      'pc:tw:3',
      JSON.stringify({ ...envelope, ts: Date.now() - 15 * 24 * 60 * 60 * 1000 }),
    )

    expect(getCachedPost('tw:3')!.isStale).toBe(true)
  })

  it('returns null for corrupt entries', () => {
    localStorage.setItem('pc:tw:4', '{not json')
    expect(getCachedPost('tw:4')).toBeNull()
  })
})
