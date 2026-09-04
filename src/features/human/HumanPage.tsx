import { useState, useEffect } from 'react'
import { cn } from 'src/lib/utils'
import type { HumanTab } from './types'
import HumanFeed from './components/HumanFeed'
import HumanProfile from './components/HumanProfile'
import HumanBookmarks from './components/HumanBookmarks'
import HumanFollow from './components/HumanFollow'
import HumanSearch from './components/HumanSearch'

interface HumanPageProps {
  activeTab?: HumanTab
  /** Retained for API compatibility; navigation is now owned by the Sidebar. */
  onTabChange?: (tab: HumanTab) => void
  /** Rebuild lock: content is inert while a handle rebuild runs (matches Sidebar). */
  disabled?: boolean
}

export default function HumanPage({
  activeTab: controlledTab,
  // onTabChange is retained for compatibility but unused — navigation lives in Sidebar
  onTabChange: _onTabChange,
  disabled = false,
}: HumanPageProps) {
  void _onTabChange
  const currentTab = controlledTab ?? 'feed'

  // Keep-alive: lazy-mount tabs and preserve DOM (hidden/block) to avoid re-fetch
  const [visitedTabs, setVisitedTabs] = useState<Set<HumanTab>>(() => new Set([currentTab]))

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(currentTab)) return prev
      const next = new Set(prev)
      next.add(currentTab)
      return next
    })
  }, [currentTab])

  return (
    <div className="flex flex-col h-full w-full bg-black text-white select-none overflow-hidden">
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div className={cn('h-full w-full', currentTab === 'feed' ? 'block' : 'hidden')}>
          {visitedTabs.has('feed') && <HumanFeed disabled={disabled} />}
        </div>
        <div className={cn('h-full w-full', currentTab === 'profile' ? 'block' : 'hidden')}>
          {visitedTabs.has('profile') && <HumanProfile disabled={disabled} />}
        </div>
        <div className={cn('h-full w-full', currentTab === 'bookmarks' ? 'block' : 'hidden')}>
          {visitedTabs.has('bookmarks') && <HumanBookmarks />}
        </div>
        <div className={cn('h-full w-full', currentTab === 'follow' ? 'block' : 'hidden')}>
          {visitedTabs.has('follow') && <HumanFollow disabled={disabled} />}
        </div>
        <div className={cn('h-full w-full', currentTab === 'search' ? 'block' : 'hidden')}>
          {visitedTabs.has('search') && <HumanSearch disabled={disabled} />}
        </div>
      </div>
    </div>
  )
}
