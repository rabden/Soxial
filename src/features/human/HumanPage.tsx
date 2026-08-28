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

  return (
    <div className="flex flex-col h-full w-full bg-black text-white select-none overflow-hidden">
      {currentTab === 'feed' ? (
        <HumanFeed disabled={disabled} />
      ) : currentTab === 'profile' ? (
        <HumanProfile disabled={disabled} />
      ) : currentTab === 'bookmarks' ? (
        <HumanBookmarks />
      ) : currentTab === 'follow' ? (
        <HumanFollow disabled={disabled} />
      ) : (
        <HumanSearch disabled={disabled} />
      )}
    </div>
  )
}
