import { useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, Newspaper } from 'lucide-react'
import type { AppError } from 'src/types/app-error'
import { TweetCard, parseTweetData } from 'src/components/ui/tweet-card'
import { OperationalError } from 'src/components/ui/operational-error'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useSessionRecheck } from '../hooks/useSessionRecheck'
import { AuthGate } from './AuthGate'
import { EmptyState } from './EmptyState'
import { springTransition } from '../spring'
import type { HumanFeedType, HumanTweet } from '../types'

const FEED_TABS: Array<{ id: HumanFeedType; label: string }> = [
  { id: 'for-you', label: 'For you' },
  { id: 'following', label: 'Following' },
]

function FeedSkeleton() {
  return (
    <div className="space-y-6 p-4" aria-busy="true" aria-label="Loading feed">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-3">
          <div className="size-10 shrink-0 rounded-full bg-white/[0.06]" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-40 rounded bg-white/[0.06]" />
            <div className="h-3 w-full rounded bg-white/[0.04]" />
            <div className="h-3 w-2/3 rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Home timeline: For you / Following sub-toggle over a lazy-loading list of
 * feed-variant tweet rows, paginated by the connector's native cursor.
 */
export default function HumanFeed({ disabled = false }: { disabled?: boolean }) {
  const [feedType, setFeedType] = useState<HumanFeedType>('for-you')

  const feed = usePaginatedList<HumanTweet>({
    resetKey: feedType,
    fetchPage: (cursor) => window.api.humanFeed({ type: feedType, cursor }),
    getItemId: (tweet) => tweet.id,
  })

  const { recheck, rechecking } = useSessionRecheck(feed.reload)

  const authError = !feed.loading && feed.error?.category === 'auth'
  const surfaceError = !feed.loading && feed.error && feed.error.category !== 'auth'
  const isEmpty = !feed.loading && !feed.error && feed.items.length === 0

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      {/* For you / Following sub-toggle */}
      <div
        className="sticky top-0 z-20 flex border-b border-white/[0.06] bg-black/80 backdrop-blur-md"
        inert={disabled || undefined}
      >
        {FEED_TABS.map((tab) => {
          const active = feedType === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              onClick={() => setFeedType(tab.id)}
              className={`relative flex-1 py-3 text-sm font-medium transition-colors hover:text-white ${
                active ? 'text-white' : 'text-zinc-500'
              } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
            >
              {tab.label}
              {active && (
                <motion.span
                  layoutId="feedSubToggleIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1d9bf0]"
                  transition={springTransition}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="mx-auto max-w-[600px] border-x border-white/[0.06]">
        {feed.loading && <FeedSkeleton />}

        {authError && (
          <AuthGate title="Log in to x.com to see your feed" onRecheck={recheck} checking={rechecking} />
        )}

        {surfaceError && (
          <div className="p-4">
            <OperationalError error={feed.error!} onRetry={feed.reload} />
          </div>
        )}

        {isEmpty && (
          <EmptyState
            icon={Newspaper}
            title="No posts yet"
            body="Your timeline is quiet. Follow a few accounts and check back."
          />
        )}

        {feed.items.map((tweet) => (
          <TweetCard key={tweet.id} variant="feed" {...parseTweetData(tweet)} />
        ))}

        {feed.moreError && (
          <div className="p-4">
            <OperationalError error={feed.moreError} onRetry={feed.loadMore} />
          </div>
        )}

        {feed.loadingMore && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}

        {feed.hasMore && feed.items.length > 0 && !feed.moreError && (
          <div ref={feed.sentinelRef} className="h-px w-full" aria-hidden="true" />
        )}

        {!feed.hasMore && feed.items.length > 0 && (
          <div className="py-6 text-center text-xs text-zinc-600">You&rsquo;re all caught up</div>
        )}
      </div>
    </div>
  )
}
