"use client";

import { useState, useEffect } from 'react'
import { Plus, CalendarClock, Settings, PanelLeftClose, Trash2, ArrowLeft, UserRound, Target, Cpu, Database } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { AppLogo } from 'src/components/ui/app-logo'

interface ChatSession {
  id: number
  title: string
  msg_count: number
  updated_at: string
}

export type View = 'chat' | 'scheduled' | 'profile'
export type SettingsSection = 'account' | 'strategy' | 'providers' | 'backup'

const SETTINGS_ITEMS: { id: SettingsSection; label: string; icon: any }[] = [
  { id: 'account', label: 'Profile', icon: UserRound },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'providers', label: 'AI providers', icon: Cpu },
  { id: 'backup', label: 'Backup', icon: Database },
]

interface SidebarProps {
  sessions: ChatSession[]
  currentSessionId: number | null
  currentView: View
  streaming: boolean
  profile: any
  scheduledCount: number
  disabled?: boolean
  settingsSection?: SettingsSection
  sessionStates?: Record<number, { status: "idle" | "running" | "completed-unread" | "question-unread" | "error-unread" }>
  onNewChat: () => void
  onSelectSession: (id: number) => void
  onDeleteSession: (id: number) => void
  onNavigate: (view: View) => void
  onToggleSidebar: () => void
  onSelectSettings?: (section: SettingsSection) => void
}

const springTransition = {
  type: "spring" as const,
  stiffness: 450,
  damping: 38
}

function parseDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'))
}

function groupByDate(sessions: ChatSession[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 6 * 86400000)

  const groups: { label: string; items: ChatSession[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]

  for (const s of sessions) {
    const d = parseDate(s.updated_at)
    if (d >= today) groups[0].items.push(s)
    else if (d >= yesterday) groups[1].items.push(s)
    else if (d >= weekAgo) groups[2].items.push(s)
    else groups[3].items.push(s)
  }

  return groups.filter(g => g.items.length > 0)
}

export default function Sidebar({
  sessions, currentSessionId, currentView, streaming, profile, scheduledCount, disabled, settingsSection, sessionStates,
  onNewChat, onSelectSession, onDeleteSession, onNavigate, onToggleSidebar, onSelectSettings
}: SidebarProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: number } | null>(null)
  const groups = groupByDate(sessions)
  const settingsMode = currentView === 'profile'

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const timer = setTimeout(() => {
      document.addEventListener('click', close)
      document.addEventListener('contextmenu', close)
    }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const handleContextMenu = (e: React.MouseEvent, sessionId: number) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  return (
    <>
      <div aria-disabled={disabled} inert={disabled || undefined} className={`w-64 flex-shrink-0 flex flex-col bg-[#08080a] border-r border-white/[0.04] relative select-none transition-opacity ${disabled ? 'opacity-50 pointer-events-none cursor-not-allowed' : ''}`}>
        {disabled && (
          <div className="absolute inset-x-3 top-3 z-30 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] font-medium text-blue-200 text-center">
            Navigation locked
          </div>
        )}

        <div className="relative z-10 flex flex-col h-full">
          {/* Header */}
          <div className={`flex items-center justify-between pl-5 pr-3 pb-3 ${window.api.platform === 'darwin' ? 'pt-10' : 'pt-5'}`}>
            <AppLogo showLabel iconClassName="size-7" labelClassName="text-[13px] tracking-wide font-semibold text-white/90" />
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
          </div>

          {settingsMode ? (
            <>
              {/* Settings menu */}
              <div className="px-5 pb-3">
                <div className="text-[10px] text-zinc-600 font-semibold uppercase tracking-[0.14em]">Settings</div>
              </div>
              <div className="px-3 space-y-0.5">
                {SETTINGS_ITEMS.map(item => {
                  const active = (settingsSection || 'account') === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectSettings?.(item.id)}
                      className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                        active ? 'text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="settingsNavBackdrop"
                          className="absolute inset-0 rounded-xl bg-white/[0.05]"
                          transition={springTransition}
                        />
                      )}
                      <item.icon className={`size-4 relative z-10 transition-colors ${active ? 'text-zinc-100' : 'text-zinc-500'}`} />
                      <span className="flex-1 text-left relative z-10">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              {/* New session — standard primary CTA fill */}
              <div className="px-3 pb-3">
                <motion.button
                  onClick={onNewChat}
                  whileTap={{ scale: 0.97 }}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--btn-primary-bg))] text-[13px] font-semibold text-[hsl(var(--btn-primary-foreground))] transition-colors hover:bg-white"
                >
                  <Plus className="size-3.5 stroke-[2.5]" />
                  New session
                </motion.button>
              </div>

              {/* Navigation */}
              <div className="px-3 pb-2 space-y-1">
                <button
                  onClick={() => onNavigate('scheduled')}
                  className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors group ${
                    currentView === 'scheduled' ? 'text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {currentView === 'scheduled' && (
                    <motion.span
                      layoutId="activeViewBackdrop"
                      className="absolute inset-0 rounded-xl bg-white/[0.05]"
                      transition={springTransition}
                    />
                  )}
                  <CalendarClock className={`size-4 relative z-10 transition-colors ${currentView === 'scheduled' ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                  <span className="flex-1 text-left relative z-10">Scheduled posts</span>
                  {scheduledCount > 0 && (
                    <span className="relative z-10 text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center rounded-md bg-white/[0.06] text-zinc-400">
                      {scheduledCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Sessions List */}
              <div className="flex-1 overflow-y-auto px-3 pb-2 scrollbar-none">
                {groups.map(group => (
                  <div key={group.label} className="mb-4">
                    <div className="text-[10px] text-zinc-600 font-semibold uppercase tracking-[0.14em] px-3 pt-2 pb-1.5">{group.label}</div>
                    <div className="space-y-0.5">
                      {group.items.map(s => {
                        const active = s.id === currentSessionId && currentView === 'chat'
                        const state = sessionStates?.[s.id]
                        const status = state?.status || 'idle'

                        return (
                          <div
                            key={s.id}
                            onContextMenu={(e) => handleContextMenu(e, s.id)}
                            onClick={() => onSelectSession(s.id)}
                            className={`relative flex items-center pl-3 pr-2 py-2 rounded-lg cursor-pointer text-[13px] font-medium transition-colors ${
                              active
                                ? 'bg-white/[0.05] text-white'
                                : 'text-zinc-400 hover:bg-white/[0.03] hover:text-white'
                            }`}
                          >
                            <span className="flex-1 truncate mr-2">{s.title}</span>

                            {/* Status indicators */}
                            <div className="flex items-center shrink-0 min-w-4 h-4 justify-end">
                              <AnimatePresence mode="popLayout">
                                {status === 'running' && (
                                  <motion.span
                                    key="running"
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.4, opacity: 0 }}
                                    className="flex items-center"
                                  >
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                    </span>
                                  </motion.span>
                                )}
                                {status === 'completed-unread' && (
                                  <motion.span
                                    key="completed"
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.4, opacity: 0 }}
                                    className="size-1.5 rounded-full bg-emerald-500"
                                  />
                                )}
                                {status === 'question-unread' && (
                                  <motion.span
                                    key="question"
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.4, opacity: 0 }}
                                    className="size-1.5 rounded-full bg-amber-400"
                                  />
                                )}
                                {status === 'error-unread' && (
                                  <motion.span
                                    key="error"
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.4, opacity: 0 }}
                                    className="size-1.5 rounded-full bg-red-400"
                                  />
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <div className="px-4 py-8 text-xs text-zinc-600 font-medium text-center">
                    No conversations yet
                  </div>
                )}
              </div>
            </>
          )}

          {/* Footer — profile entry in chat mode, back to chat in settings mode */}
          <div className="p-3 border-t border-white/[0.04]">
            {settingsMode ? (
              <motion.button
                onClick={() => onNavigate('chat')}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-3 p-2 rounded-xl transition-colors hover:bg-white/[0.03] text-zinc-400 hover:text-white"
                transition={springTransition}
              >
                <div className="size-7 rounded-full flex items-center justify-center shrink-0 bg-white/[0.06] border border-white/[0.08]">
                  <ArrowLeft className="size-3.5" />
                </div>
                <span className="text-[13px] font-medium">Back to chat</span>
              </motion.button>
            ) : (
              <motion.button
                onClick={() => onNavigate('profile')}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-3 p-2 rounded-xl transition-colors hover:bg-white/[0.03]"
                transition={springTransition}
              >
                <div className="size-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                  {profile?.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-medium text-white/90 truncate">{profile?.name || 'User'}</div>
                  <div className="text-[11px] text-zinc-600 truncate mt-0.5">
                    {profile?.twitter_handle && `@${profile.twitter_handle}`}
                    {profile?.twitter_handle && profile?.reddit_username && ' · '}
                    {profile?.reddit_username && `u/${profile.reddit_username}`}
                  </div>
                </div>
                <Settings className="size-4 text-zinc-600 shrink-0" />
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-50 min-w-[160px] rounded-xl border border-white/[0.08] bg-[#131316] shadow-xl p-1"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { onDeleteSession(ctxMenu.sessionId); setCtxMenu(null) }}
              className="w-full px-3 py-2 text-left text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5 rounded-lg"
            >
              <Trash2 className="size-3.5" />
              Delete session
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
