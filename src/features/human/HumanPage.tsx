import { useState } from 'react'
import { motion } from 'motion/react'
import { Search } from 'lucide-react'
import type { HumanTab } from './types'
import { HUMAN_NAV_ITEMS } from './navigation'
import HumanFeed from './components/HumanFeed'
import HumanProfile from './components/HumanProfile'
import HumanBookmarks from './components/HumanBookmarks'
import HumanFollow from './components/HumanFollow'

const springTransition = {
  type: 'spring' as const,
  stiffness: 450,
  damping: 38,
}

interface HumanPageProps {
  activeTab?: HumanTab
  onTabChange?: (tab: HumanTab) => void
  /** Rebuild lock: tabs are inert while a handle rebuild runs (matches Sidebar). */
  disabled?: boolean
}

export default function HumanPage({
  activeTab: controlledTab,
  onTabChange,
  disabled = false,
}: HumanPageProps) {
  const [localTab, setLocalTab] = useState<HumanTab>('feed')
  const currentTab = controlledTab ?? localTab

  const handleTabSelect = (tab: HumanTab) => {
    if (onTabChange) {
      onTabChange(tab)
    } else {
      setLocalTab(tab)
    }
  }

  const isDarwin = typeof window !== 'undefined' && window.api?.platform === 'darwin'

  return (
    <div className="flex flex-col h-full w-full bg-black text-white select-none overflow-hidden">
      {/* Top sticky tab bar */}
      <div
        className={`sticky top-0 z-30 flex items-center justify-center border-b border-white/[0.08] bg-black/80 backdrop-blur-md px-4 ${
          isDarwin ? 'pt-10 pb-0' : 'pt-2 pb-0'
        }`}
      >
        <nav className="flex items-center space-x-1 sm:space-x-4" aria-disabled={disabled} inert={disabled || undefined}>
          {HUMAN_NAV_ITEMS.map((tab) => {
            const active = currentTab === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => handleTabSelect(tab.id)}
                disabled={disabled}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors hover:text-white ${
                  active ? 'text-white' : 'text-zinc-500'
                } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <Icon className="size-4" />
                <span>{tab.label}</span>
                {active && (
                  <motion.span
                    layoutId="humanTabIndicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1d9bf0]"
                    transition={springTransition}
                  />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab Content Area */}
      {currentTab === 'feed' ? (
        <HumanFeed disabled={disabled} />
      ) : currentTab === 'profile' ? (
        <HumanProfile disabled={disabled} />
      ) : currentTab === 'bookmarks' ? (
        <HumanBookmarks />
      ) : currentTab === 'follow' ? (
        <HumanFollow disabled={disabled} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 scrollbar-none max-w-4xl mx-auto w-full">
          {currentTab === 'search' && (
            <div className="flex flex-col items-center justify-center min-h-[300px] text-center text-zinc-500 space-y-2">
              <Search className="size-10 text-zinc-700 stroke-1" />
              <h3 className="text-base font-semibold text-zinc-300">Search</h3>
              <p className="text-xs text-zinc-600 max-w-sm">
                Search for users, keywords, or topics across networks.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
