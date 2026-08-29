import { useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, UserPlus, Users } from 'lucide-react'
import { OperationalError } from 'src/components/ui/operational-error'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useSessionRecheck } from '../hooks/useSessionRecheck'
import { AuthGate } from './AuthGate'
import { EmptyState } from './EmptyState'
import { UserFollowRow } from './UserFollowRow'
import { springTransition } from '../spring'
import { cn } from 'src/lib/utils'
import { HUMAN_LIST_HARD_CAP, type HumanFollowSubTab, HumanUser, Paginated } from '../types'

const SUB_TABS: Array<{ id: HumanFollowSubTab; label: string }> = [
  { id: 'following', label: 'Following' },
  { id: 'followers', label: 'Followers' },
]

const PAGE_GROWTH = 10

function FollowListView({
  subTab,
  list,
  disabled,
}: {
  subTab: HumanFollowSubTab
  disabled?: boolean
  list: ReturnType<typeof usePaginatedList<HumanUser>>
}) {
  const { recheck, rechecking } = useSessionRecheck(list.reload)
  const authError = !list.loading && list.error?.category === 'auth'
  const surfaceError = !list.loading && list.error && list.error.category !== 'auth'
  const isEmpty = !list.loading && !list.error && list.items.length === 0

  return (
    <>
      {list.loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      )}
      {authError && <AuthGate title="Log in to x.com to see your network" onRecheck={recheck} checking={rechecking} />}
      {surfaceError && (
        <div className="p-4">
          <OperationalError error={list.error!} onRetry={list.reload} />
        </div>
      )}
      {isEmpty && (
        <EmptyState
          icon={subTab === 'followers' ? Users : UserPlus}
          title={subTab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
          body={subTab === 'followers' ? 'When people follow you, they will show up here.' : 'Follow accounts to fill this list.'}
        />
      )}
      {list.items.map((user) => (
        <UserFollowRow key={user.screenName} user={user} initialFollowing={subTab === 'following'} disabled={disabled} />
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
        <div className="py-6 text-center text-xs text-zinc-600">That&rsquo;s everyone</div>
      )}
    </>
  )
}

export default function HumanFollow({ disabled = false }: { disabled?: boolean }) {
  const [subTab, setSubTab] = useState<HumanFollowSubTab>('following')
  // Keep-alive: each list mounts on first visit, then stays mounted.
  const [visited, setVisited] = useState<Set<HumanFollowSubTab>>(() => new Set(['following']))

  const selectSubTab = (tab: HumanFollowSubTab) => {
    setSubTab(tab)
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }

  const followingList = usePaginatedList<HumanUser>({
    resetKey: 'following',
    enabled: visited.has('following'),
    fetchPage: (cursor) => window.api.humanFollowList({ subTab: 'following', count: cursor ? Number(cursor) : PAGE_GROWTH }),
    getItemId: (user) => user.screenName,
    deriveNextCursor: (page: Paginated<HumanUser>) => {
      const next = page.items.length + PAGE_GROWTH
      return next <= HUMAN_LIST_HARD_CAP ? String(next) : undefined
    },
  })

  const followersList = usePaginatedList<HumanUser>({
    resetKey: 'followers',
    enabled: visited.has('followers'),
    fetchPage: (cursor) => window.api.humanFollowList({ subTab: 'followers', count: cursor ? Number(cursor) : PAGE_GROWTH }),
    getItemId: (user) => user.screenName,
    deriveNextCursor: (page: Paginated<HumanUser>) => {
      const next = page.items.length + PAGE_GROWTH
      return next <= HUMAN_LIST_HARD_CAP ? String(next) : undefined
    },
  })

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-[600px] border-x border-white/[0.06] min-h-full">
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
                    layoutId="followSubToggleIndicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1d9bf0]"
                    transition={springTransition}
                  />
                )}
              </button>
            )
          })}
        </div>

        <div className={cn(subTab === 'following' ? 'block' : 'hidden')}>
          {visited.has('following') && <FollowListView subTab="following" disabled={disabled} list={followingList} />}
        </div>
        <div className={cn(subTab === 'followers' ? 'block' : 'hidden')}>
          {visited.has('followers') && <FollowListView subTab="followers" disabled={disabled} list={followersList} />}
        </div>
      </div>
    </div>
  )
}
