import { Newspaper, User, Bookmark, UserPlus, Search, type LucideIcon } from 'lucide-react'
import type { HumanTab } from './types'

/** Single source of truth for Human navigation — consumed by both the Sidebar
 *  (human-mode nav list) and the HumanPage sticky tab bar. */
export const HUMAN_NAV_ITEMS: Array<{ id: HumanTab; label: string; icon: LucideIcon }> = [
  { id: 'feed', label: 'Feed', icon: Newspaper },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'follow', label: 'Follow', icon: UserPlus },
  { id: 'search', label: 'Search', icon: Search },
]
