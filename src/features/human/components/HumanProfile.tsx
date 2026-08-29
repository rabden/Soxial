import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, MessageSquare, User } from 'lucide-react'
import type { AppError } from 'src/types/app-error'
import { TweetCard, parseTweetData } from 'src/components/ui/tweet-card'
import { OperationalError } from 'src/components/ui/operational-error'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useSessionRecheck } from '../hooks/useSessionRecheck'
import { AuthGate } from './AuthGate'
import { EmptyState } from './EmptyState'
import { ProfileHeader } from './ProfileHeader'
import { springTransition } from '../spring'
import { cn } from 'src/lib/utils'
import { oldestTweetDate } from '../utils'
import { HUMAN_LIST_HARD_CAP, type HumanProfileSubTab, HumanTweet, HumanUser, Paginated } from '../types'

const SUB_TABS: Array<{ id: HumanProfileSubTab; label: string }> = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Replies' },
]

/** Posts pages grow the requested count (bookmarks strategy — `user-posts`
 *  has no cursor); 10 per page up to the connector cap. */
const PAGE_GROWTH = 10

function PostsListView({
  subTab,
  list,
  recheck,
  rechecking,
}: {
  subTab: HumanProfileSubTab
  list: ReturnType<typeof usePaginatedList<HumanTweet>>
  recheck: () => void
  rechecking: boolean
}) {
  const isEmpty = !list.loading && !list.error && list.items.length === 0
  return (
    <>
      {list.loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      )}
      {!list.loading && list.error && list.error.category === 'auth' && (
        <AuthGate title="Log in to x.com to see your posts" onRecheck={recheck} checking={rechecking} />
      )}
      {!list.loading && list.error && list.error.category !== 'auth' && (
        <div className="p-4">
          <OperationalError error={list.error} onRetry={list.reload} />
        </div>
      )}
      {isEmpty && (
        <EmptyState
          icon={subTab === 'replies' ? MessageSquare : User}
          title={subTab === 'replies' ? 'No replies yet' : 'No posts yet'}
          body={subTab === 'replies' ? 'Replies you post on X will show up here.' : 'Posts you create on X will show up here.'}
        />
      )}
      {list.items.map((tweet) => (
        <TweetCard key={tweet.id} variant="feed" {...parseTweetData(tweet)} />
      ))}
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
        <div className="py-6 text-center text-xs text-zinc-600">You&rsquo;re all caught up</div>
      )}
    </>
  )
}

/** Authenticated user's profile: flat header + Posts/Replies nested tabs. Keeps both lists alive. */
export default function HumanProfile({ disabled = false }: { disabled?: boolean }) {
  const [subTab, setSubTab] = useState<HumanProfileSubTab>('posts')
  // Keep-alive: Posts mounts immediately; Replies mounts on first visit and
  // stays mounted. The pagination hooks live here (parent), so list state
  // survives even while a view is unmounted or the header reloads.
  const [visited, setVisited] = useState<Set<HumanProfileSubTab>>(() => new Set(['posts']))

  const selectSubTab = (tab: HumanProfileSubTab) => {
    setSubTab(tab)
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }

  const [profile, setProfile] = useState<HumanUser | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<AppError | null>(null)

  const reloadProfile = useCallback(() => {
    setProfileLoading(true)
    setProfileError(null)
    window.api
      .humanProfile()
      .then((res) => {
        if (res.ok) setProfile(res.data)
        else setProfileError(res.error)
      })
      .catch(() =>
        setProfileError({
          code: 'HUMAN_PROFILE_FAILED',
          category: 'network',
          message: 'The profile could not be loaded. Retry.',
          retryable: true,
          action: 'retry',
        }),
      )
      .finally(() => setProfileLoading(false))
  }, [])

  useEffect(() => {
    reloadProfile()
  }, [reloadProfile])

  // Posts: `user-posts` (native UserTweets) — chronological with the pinned
  // tweet first. No cursor: pages grow the requested count (bookmarks pattern).
  const postsList = usePaginatedList<HumanTweet>({
    resetKey: 'posts',
    enabled: visited.has('posts'),
    fetchPage: (cursor) =>
      window.api.humanProfilePosts({ subTab: 'posts', count: cursor ? Number(cursor) : PAGE_GROWTH }),
    getItemId: (tweet) => tweet.id,
    deriveNextCursor: (page: Paginated<HumanTweet>) => {
      const next = page.items.length + PAGE_GROWTH
      return next <= HUMAN_LIST_HARD_CAP ? String(next) : undefined
    },
  })

  // Replies: search `filter:replies` — date-window pagination via the oldest
  // seen tweet (search has no cursor).
  const repliesList = usePaginatedList<HumanTweet>({
    resetKey: 'replies',
    enabled: visited.has('replies'),
    fetchPage: (until) => window.api.humanProfilePosts({ subTab: 'replies', count: 10, until }),
    getItemId: (tweet) => tweet.id,
    deriveNextCursor: oldestTweetDate,
  })

  const reloadAll = useCallback(() => {
    reloadProfile()
    postsList.reload()
    repliesList.reload()
  }, [reloadProfile, postsList.reload, repliesList.reload])

  const { recheck, rechecking } = useSessionRecheck(reloadAll)

  const authError = profileError?.category === 'auth'

  // Keep-alive: single scroll container, both lists mounted, visibility toggled
  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-[600px] border-x border-white/[0.06] min-h-full">
        {profileLoading && (
          <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading profile">
            <div className="size-[112px] animate-pulse rounded-full bg-white/[0.06]" />
            <div className="h-4 w-48 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
          </div>
        )}

        {!profileLoading && authError && (
          <AuthGate title="Log in to x.com to see your profile" onRecheck={recheck} checking={rechecking} />
        )}

        {!profileLoading && !authError && (
          <>
            {profileError && (
              <div className="p-4">
                <OperationalError error={profileError} onRetry={reloadProfile} />
              </div>
            )}

            {!profileError && profile && <ProfileHeader user={profile} />}

            {/* Posts / Replies nested tabs */}
            <div
              className="sticky top-0 z-20 flex border-b border-white/[0.06] bg-black/80 backdrop-blur-md"
              inert={disabled || undefined}
            >
              {SUB_TABS.map((tab) => {
                const active = subTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectSubTab(tab.id)}
                    className={`relative flex-1 py-3 text-sm font-medium transition-colors hover:text-white ${
                      active ? 'text-white' : 'text-zinc-500'
                    } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {tab.label}
                    {active && (
                      <motion.span
                        layoutId="profileSubToggleIndicator"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1d9bf0]"
                        transition={springTransition}
                      />
                    )}
                  </button>
                )
              })}
            </div>

            <div className={cn(subTab === 'posts' ? 'block' : 'hidden')}>
              {visited.has('posts') && <PostsListView subTab="posts" list={postsList} recheck={recheck} rechecking={rechecking} />}
            </div>
            <div className={cn(subTab === 'replies' ? 'block' : 'hidden')}>
              {visited.has('replies') && <PostsListView subTab="replies" list={repliesList} recheck={recheck} rechecking={rechecking} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
