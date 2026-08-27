import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { TweetCard, parseTweetData } from 'src/components/ui/tweet-card'
import { OperationalError } from 'src/components/ui/operational-error'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { AuthGate } from './AuthGate'
import { EmptyState } from './EmptyState'
import { oldestTweetDate } from '../utils'
import type { HumanSearchRequest, HumanTweet } from '../types'

const springTransition = {
  type: 'spring' as const,
  stiffness: 450,
  damping: 38,
}

const PRODUCTS: Array<NonNullable<HumanSearchRequest['product']>> = ['Top', 'Latest', 'Photos', 'Videos']

const DEBOUNCE_MS = 300

interface SearchFilters {
  from: string
  to: string
  lang: string
  since: string
  until: string
  minLikes: string
}

const EMPTY_FILTERS: SearchFilters = { from: '', to: '', lang: '', since: '', until: '', minLikes: '' }

/**
 * Search X: debounced query input, Top/Latest/Photos/Videos result tabs and
 * a pass-through filter panel. Results paginate by date-window advancement;
 * every new committed query/filter resets the list so stale matches never
 * mix with new ones.
 */
export default function HumanSearch({ disabled = false }: { disabled?: boolean }) {
  const [inputValue, setInputValue] = useState('')
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<NonNullable<HumanSearchRequest['product']>>('Top')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [rechecking, setRechecking] = useState(false)

  // Debounce keystrokes so typing never burns rate limits.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(inputValue.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputValue])

  const activeFilters = useMemo(
    () => ({
      from: filters.from.trim() || undefined,
      to: filters.to.trim() || undefined,
      lang: filters.lang.trim() || undefined,
      since: filters.since.trim() || undefined,
      until: filters.until.trim() || undefined,
      minLikes: filters.minLikes.trim() ? Number(filters.minLikes) : undefined,
    }),
    [filters],
  )
  const filterKey = JSON.stringify(activeFilters)

  const results = usePaginatedList<HumanTweet>({
    // Committed query + product + filters form the search generation.
    resetKey: `${query}|${product}|${filterKey}`,
    fetchPage: (until) =>
      query
        ? window.api.humanSearch({
            query,
            product,
            count: 10,
            ...activeFilters,
            // The pagination window (older-than cursor) supersedes any fixed
            // Until filter once scrolling starts — results always age downward.
            until: until ?? activeFilters.until,
          })
        : Promise.resolve({ ok: true as const, data: { items: [], hasMore: false } }),
    getItemId: (tweet) => tweet.id,
    deriveNextCursor: oldestTweetDate,
  })

  const recheck = async () => {
    setRechecking(true)
    try {
      const session = await window.api.humanVerifySession()
      if (session.ok && session.data.authenticated) results.reload()
    } finally {
      setRechecking(false)
    }
  }

  const authError = !results.loading && results.error?.category === 'auth'
  const surfaceError = !results.loading && results.error && results.error.category !== 'auth'
  const hasQuery = query.length > 0
  const isEmpty = hasQuery && !results.loading && !results.error && results.items.length === 0

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-[600px] border-x border-white/[0.06]">
        {/* Query input + filter toggle */}
        <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-black/80 px-4 py-2 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 focus-within:ring-1 focus-within:ring-[#1d9bf0]">
              <SearchIcon className="size-4 shrink-0 text-zinc-500" />
              <input
                type="text"
                value={inputValue}
                disabled={disabled}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Search X"
                aria-label="Search X"
                className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((open) => !open)}
              disabled={disabled}
              aria-expanded={showFilters}
              aria-label="Toggle filters"
              className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                showFilters || filterKey !== JSON.stringify({
                  from: undefined, to: undefined, lang: undefined, since: undefined, until: undefined, minLikes: undefined,
                })
                  ? 'bg-[#1d9bf0]/15 text-[#1d9bf0]'
                  : 'bg-white/[0.06] text-zinc-400 hover:text-white'
              } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </div>

          {showFilters && (
            <div className="mt-2 grid grid-cols-2 gap-2 pb-1 sm:grid-cols-3" inert={disabled || undefined}>
              {(
                [
                  ['from', 'From (@handle)'],
                  ['to', 'To (@handle)'],
                  ['lang', 'Language (en)'],
                  ['since', 'Since (YYYY-MM-DD)'],
                  ['until', 'Until (YYYY-MM-DD)'],
                  ['minLikes', 'Min likes'],
                ] as Array<[keyof SearchFilters, string]>
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  {label}
                  <input
                    type="text"
                    value={filters[key]}
                    disabled={disabled}
                    onChange={(e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-white placeholder:text-zinc-600 focus:border-[#1d9bf0] focus:outline-none"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Product tabs */}
          <div className="mt-2 flex" inert={disabled || undefined}>
            {PRODUCTS.map((tab) => {
              const active = product === tab
              return (
                <button
                  key={tab}
                  type="button"
                  disabled={disabled}
                  onClick={() => setProduct(tab)}
                  className={`relative flex-1 py-2 text-sm font-medium transition-colors hover:text-white ${
                    active ? 'text-white' : 'text-zinc-500'
                  } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  {tab}
                  {active && (
                    <motion.span
                      layoutId="searchProductIndicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#1d9bf0]"
                      transition={springTransition}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {!hasQuery && (
          <EmptyState
            icon={SearchIcon}
            title="Search X"
            body="Find posts by keyword — results filter by type and refine with advanced filters."
          />
        )}

        {hasQuery && results.loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Searching…
          </div>
        )}

        {authError && <AuthGate title="Log in to x.com to search" onRecheck={recheck} checking={rechecking} />}

        {surfaceError && (
          <div className="p-4">
            <OperationalError error={results.error!} onRetry={results.reload} />
          </div>
        )}

        {isEmpty && (
          <EmptyState icon={SearchIcon} title="No results" body="Try different keywords or loosen the filters." />
        )}

        {results.items.map((tweet) => (
          <TweetCard key={tweet.id} variant="feed" {...parseTweetData(tweet)} />
        ))}

        {results.moreError && (
          <div className="p-4">
            <OperationalError error={results.moreError} onRetry={results.loadMore} />
          </div>
        )}

        {results.loadingMore && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}

        {results.hasMore && results.items.length > 0 && !results.moreError && (
          <div ref={results.sentinelRef} className="h-px w-full" aria-hidden="true" />
        )}

        {!results.hasMore && results.items.length > 0 && (
          <div className="py-6 text-center text-xs text-zinc-600">No more results</div>
        )}
      </div>
    </div>
  )
}
