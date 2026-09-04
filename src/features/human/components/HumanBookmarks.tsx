import { Loader2, Bookmark as BookmarkIcon } from 'lucide-react'
import { TweetCard, parseTweetData } from 'src/components/ui/tweet-card'
import { OperationalError } from 'src/components/ui/operational-error'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useSessionRecheck } from '../hooks/useSessionRecheck'
import { AuthGate } from './AuthGate'
import { EmptyState } from './EmptyState'
import { HUMAN_LIST_HARD_CAP, type HumanTweet, Paginated } from '../types'

const PAGE_GROWTH = 10

/**
 * Bookmarked tweets, newest-first. No cursor exists for bookmarks: each page
 * grows the requested count by 10 (the response includes everything already
 * seen; the list de-duplicates), stopping at the connector's 200 cap.
 */
export default function HumanBookmarks() {
  const list = usePaginatedList<HumanTweet>({
    resetKey: 'bookmarks',
    fetchPage: (cursor) =>
      window.api.humanBookmarks({ count: cursor ? Number(cursor) : PAGE_GROWTH }),
    getItemId: (tweet) => tweet.id,
    deriveNextCursor: (page: Paginated<HumanTweet>) => {
      const next = page.items.length + PAGE_GROWTH
      return next <= HUMAN_LIST_HARD_CAP ? String(next) : undefined
    },
  })

  const { recheck, rechecking } = useSessionRecheck(list.reload)

  const authError = !list.loading && list.error?.category === 'auth'
  const surfaceError = !list.loading && list.error && list.error.category !== 'auth'
  const isEmpty = !list.loading && !list.error && list.items.length === 0

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-[600px] border-x border-white/[0.06]">
        <h2 className="border-b border-white/[0.06] px-4 py-3 text-base font-bold text-white">Bookmarks</h2>

        {list.loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}

        {authError && (
          <AuthGate
            title="Log in to x.com to see your bookmarks"
            onRecheck={recheck}
            checking={rechecking}
          />
        )}

        {surfaceError && (
          <div className="p-4">
            <OperationalError error={list.error!} onRetry={list.reload} />
          </div>
        )}

        {isEmpty && (
          <EmptyState
            icon={BookmarkIcon}
            title="No bookmarks"
            body="Save posts from your feed to find them again here."
          />
        )}

        {list.items.map((tweet) => {
          const data = parseTweetData(tweet)
          return <TweetCard key={tweet.id} variant="feed" {...data} isBookmarked />
        })}

        {list.moreError && (
          <div className="p-4">
            <OperationalError error={list.moreError} onRetry={list.loadMore} />
          </div>
        )}

        {list.loadingMore && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}

        {list.hasMore && list.items.length > 0 && !list.moreError && (
          <div ref={list.sentinelRef} className="h-px w-full" aria-hidden="true" />
        )}

        {!list.hasMore && list.items.length > 0 && (
          <div className="py-6 text-center text-xs text-zinc-600">You&rsquo;ve reached the end of your bookmarks</div>
        )}
      </div>
    </div>
  )
}
