// ponytail: SWR cache for ID-based post lookups. 2-week TTL, localStorage-backed.
// Fresh → instant display, zero API calls. Stale → instant display + background refresh.

// Envelope v2: v1 (unversioned) entries hold pre-"url-entities" tweet payloads
// whose top-level `urls` mirror only the first 4 links, so links 5+ can never
// expand. Unknown or older envelopes are served stale so consumers
// background-refresh them once; the rewrite carries the current version.
const ENVELOPE_VERSION = 2

const TTL = 14 * 24 * 60 * 60 * 1000

export function getCachedPost(key: string): { data: any, isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(`pc:${key}`)
    if (!raw) return null
    const { v, data, ts } = JSON.parse(raw)
    if (data === undefined) return null
    const ttlStale = typeof ts === 'number' ? Date.now() - ts > TTL : true
    return { data, isStale: v !== ENVELOPE_VERSION || ttlStale }
  } catch { return null }
}

export function cachePost(key: string, data: any) {
  try {
    localStorage.setItem(`pc:${key}`, JSON.stringify({ v: ENVELOPE_VERSION, data, ts: Date.now() }))
  } catch { /* localStorage full — skip */ }
}
