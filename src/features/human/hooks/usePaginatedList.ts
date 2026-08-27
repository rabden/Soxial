import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppError } from 'src/types/app-error'
import { createAppError } from 'src/types/app-error'
import type { HumanResult, Paginated } from '../types'

export interface UsePaginatedListOptions<T> {
  /** Changing this resets the list and reloads page 1 (e.g. feed type, sub-tab, query). */
  resetKey: string | number
  fetchPage: (cursor: string | undefined) => Promise<HumanResult<Paginated<T>>>
  /** Stable identity for de-duplicating items across pages. */
  getItemId: (item: T) => string
}

export interface PaginatedListState<T> {
  items: T[]
  /** Initial page in flight (list empty). */
  loading: boolean
  /** Next page in flight (list populated). */
  loadingMore: boolean
  /** Page-1 failure (list is empty). */
  error: AppError | null
  /** Load-more failure (items preserved). */
  moreError: AppError | null
  hasMore: boolean
  reload: () => void
  loadMore: () => void
  /** Ref-callback for the sentinel element observed for infinite scroll. */
  sentinelRef: (node: HTMLElement | null) => void
}

function dedupeById<T>(items: T[], getItemId: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const id = getItemId(item)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

/**
 * Cursor-driven infinite-scroll list with epoch-guarded resets: a response from
 * a superseded generation (reset/reload/key change) is discarded, so stale
 * pages never mix with fresh ones. Only one request per generation is in
 * flight; the sentinel triggers `loadMore` when it nears the viewport.
 */
export function usePaginatedList<T>({
  resetKey,
  fetchPage,
  getItemId,
}: UsePaginatedListOptions<T>): PaginatedListState<T> {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [moreError, setMoreError] = useState<AppError | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const epochRef = useRef(0)
  const activeEpochRef = useRef<number | null>(null)
  const cursorRef = useRef<string | undefined>(undefined)
  const itemsRef = useRef<T[]>([])
  const hasMoreRef = useRef(false)

  const optionsRef = useRef({ fetchPage, getItemId })
  optionsRef.current = { fetchPage, getItemId }

  const syncRefs = () => {
    hasMoreRef.current = hasMore
    itemsRef.current = items
  }
  syncRefs()

  const load = useCallback((mode: 'initial' | 'more') => {
    const epoch = epochRef.current
    if (activeEpochRef.current === epoch) return // this generation already in flight
    if (mode === 'more' && (!hasMoreRef.current || itemsRef.current.length === 0)) return

    activeEpochRef.current = epoch
    if (mode === 'initial') {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }
    setMoreError(null)

    const cursor = mode === 'more' ? cursorRef.current : undefined
    optionsRef.current
      .fetchPage(cursor)
      .then((res) => {
        if (epoch !== epochRef.current) return // superseded — discard
        activeEpochRef.current = null
        if (res.ok) {
          const page = res.data
          setItems((prev) => {
            const base = mode === 'initial' ? [] : prev
            return dedupeById([...base, ...page.items], optionsRef.current.getItemId)
          })
          cursorRef.current = page.nextCursor
          setHasMore(page.hasMore)
        } else if (mode === 'initial') {
          setItems([])
          setHasMore(false)
          setError(res.error)
        } else {
          setMoreError(res.error)
        }
        setLoading(false)
        setLoadingMore(false)
      })
      .catch((thrown: unknown) => {
        if (epoch !== epochRef.current) return
        activeEpochRef.current = null
        const err = createAppError(
          {
            code: 'HUMAN_FETCH_FAILED',
            category: 'network',
            retryable: true,
            action: 'retry',
            message: thrown instanceof Error ? thrown.message : undefined,
          },
          'The request could not be completed. Retry.',
        )
        if (mode === 'initial') {
          setItems([])
          setHasMore(false)
          setError(err)
          setLoading(false)
        } else {
          setMoreError(err)
          setLoadingMore(false)
        }
      })
  }, [])

  const resetAndLoad = useCallback(() => {
    epochRef.current += 1
    cursorRef.current = undefined
    activeEpochRef.current = null
    setItems([])
    setHasMore(false)
    setError(null)
    setMoreError(null)
    load('initial')
  }, [load])

  // Load page 1 whenever the reset key changes; invalidate stragglers on cleanup.
  useEffect(() => {
    resetAndLoad()
    return () => {
      epochRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const reload = useCallback(() => resetAndLoad(), [resetAndLoad])
  const loadMore = useCallback(() => load('more'), [load])

  // Sentinel observation — re-observed whenever the node mounts via ref callback.
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelNodeRef = useRef<HTMLElement | null>(null)
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current()
      },
      { rootMargin: '600px' },
    )
    observerRef.current = observer
    if (sentinelNodeRef.current) observer.observe(sentinelNodeRef.current)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [])

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    if (sentinelNodeRef.current && observerRef.current) {
      observerRef.current.unobserve(sentinelNodeRef.current)
    }
    sentinelNodeRef.current = node
    if (node && observerRef.current) observerRef.current.observe(node)
  }, [])

  return {
    items,
    loading,
    loadingMore,
    error,
    moreError,
    hasMore,
    reload,
    loadMore,
    sentinelRef,
  }
}
