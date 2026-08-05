"use client";

// Sidebar: session list + navigation

import { useState, useEffect } from 'react'
import { Plus, CalendarClock, Settings, PanelLeftClose, Trash2, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { AppLogo } from 'src/components/ui/app-logo'

interface ChatSession {
  id: number
  title: string
  msg_count: number
  updated_at: string
}

export type View = 'chat' | 'scheduled' | 'profile'

interface SidebarProps {
  sessions: ChatSession[]
  currentSessionId: number | null
  currentView: View
  streaming: boolean
  profile: any
  scheduledCount: number
  disabled?: boolean
  sessionStates?: Record<number, { status: "idle" | "running" | "completed-unread" | "question-unread" | "error-unread" }>
  onNewChat: () => void
  onSelectSession: (id: number) => void
  onDeleteSession: (id: number) => void
  onNavigate: (view: View) => void
  onToggleSidebar: () => void
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
  sessions, currentSessionId, currentView, streaming, profile, scheduledCount, disabled, sessionStates,
  onNewChat, onSelectSession, onDeleteSession, onNavigate, onToggleSidebar
}: SidebarProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: number } | null>(null)
  const [hoveredSessionId, setHoveredSessionId] = useState<number | null>(null)
  const groups = groupByDate(sessions)

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

  const springTransition = {
    type: "spring" as const,
    stiffness: 450,
    damping: 38
  }

  return (
    <>
      <div aria-disabled={disabled} inert={disabled || undefined} className={`w-64 flex-shrink-0 flex flex-col bg-[#09090b]/90 backdrop-blur-xl border-r border-white/[0.04] relative select-none transition-opacity ${disabled ? 'opacity-50 pointer-events-none cursor-not-allowed' : ''}`}>
        {disabled && (
          <div className="absolute inset-x-3 top-3 z-30 rounded-xl border border-blue-500/15 bg-blue-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200 text-center">
            Navigation locked
          </div>
        )}
        {/* Subtle glass top highlight */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full">
          {/* Header */}
          <div className={`flex items-center justify-between pl-5 pr-3 pb-3 ${window.api.platform === 'darwin' ? 'pt-10' : 'pt-5'}`}>
            <AppLogo showLabel iconClassName="size-7" labelClassName="text-[13px] tracking-wide font-semibold text-white/90" />
            <motion.button 
              onClick={onToggleSidebar}
              whileTap={{ scale: 0.96 }}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent hover:border-white/[0.02] transition-colors"
            >
              <PanelLeftClose className="size-3.5" />
            </motion.button>
          </div>

          {/* New Chat Action Button */}
          <div className="px-3 pb-3">
            <motion.button 
              onClick={onNewChat}
              whileTap={{ scale: 0.96 }}
              className="relative group w-full flex items-center justify-between pl-4 pr-2 py-2 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-medium text-[13px] border border-blue-500/30 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] overflow-hidden"
              transition={springTransition}
            >
              <div className="absolute inset-0 bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="flex items-center gap-2 relative z-10">
                <Plus className="size-3.5 stroke-[2.5]" /> 
                New session
              </span>
              <span className="flex items-center justify-center size-6 rounded-lg bg-white/10 border border-white/10 shadow-sm relative z-10">
                <Plus className="size-3 stroke-[2.5]" />
              </span>
            </motion.button>
          </div>

          {/* Navigation Items (Scheduled View) */}
          <div className="px-3 pb-3 space-y-1">
            <button 
              onClick={() => onNavigate('scheduled')}
              className="relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium text-zinc-400 hover:text-white transition-colors group"
            >
              {currentView === 'scheduled' && (
                <motion.span 
                  layoutId="activeViewBackdrop"
                  className="absolute inset-0 rounded-xl bg-white/[0.04] border border-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                  transition={springTransition}
                />
              )}
              <CalendarClock className={`size-4 relative z-10 ${currentView === 'scheduled' ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-300 transition-colors'}`} />
              <span className="flex-1 text-left relative z-10">Scheduled posts</span>
              {scheduledCount > 0 && (
                <span className="relative z-10 text-[10px] rounded-md px-1.5 py-0.5 min-w-[18px] text-center font-bold bg-blue-500/10 border border-blue-500/20 text-blue-400 shadow-sm">
                  {scheduledCount}
                </span>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="px-5 pb-2">
            <div className="h-px bg-white/[0.02] w-full" />
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto px-3 pb-2 scrollbar-none">
            {groups.map(group => (
              <div key={group.label} className="mb-4">
                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.14em] px-3.5 pt-2 pb-1.5">{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map(s => {
                    const active = s.id === currentSessionId && currentView === 'chat'
                    const state = sessionStates?.[s.id]
                    const status = state?.status || 'idle'
                    const isHovered = hoveredSessionId === s.id
                    
                    return (
                      <motion.div
                        key={s.id}
                        onMouseEnter={() => setHoveredSessionId(s.id)}
                        onMouseLeave={() => setHoveredSessionId(null)}
                        onContextMenu={(e) => handleContextMenu(e, s.id)}
                        onClick={() => onSelectSession(s.id)}
                        whileTap={{ scale: 0.98 }}
                        className={`relative flex items-center pl-3.5 pr-2 py-2 rounded-xl cursor-pointer text-[13px] font-medium transition-colors group ${
                          active ? 'text-white' : 'text-zinc-400 hover:text-white'
                        }`}
                        transition={springTransition}
                      >
                        {active && (
                          <motion.span 
                            layoutId="activeViewBackdrop"
                            className="absolute inset-0 rounded-xl bg-white/[0.04] border border-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                            transition={springTransition}
                          />
                        )}

                        {/* Left edge premium focus line */}
                        {active && (
                          <motion.div 
                            layoutId="activeIndicatorBar"
                            className="absolute left-1.5 top-2.5 bottom-2.5 w-[3px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            transition={springTransition}
                          />
                        )}

                        <span className="flex-1 truncate mr-2 relative z-10">{s.title}</span>

                        {/* Custom indicators */}
                        <div className="relative z-10 flex items-center shrink-0 min-w-4 h-4 justify-end">
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
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
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
                                className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" 
                              />
                            )}
                            {status === 'question-unread' && (
                              <motion.span 
                                key="question"
                                initial={{ scale: 0.4, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.4, opacity: 0 }}
                                className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]" 
                              />
                            )}
                            {status === 'error-unread' && (
                              <motion.span 
                                key="error"
                                initial={{ scale: 0.4, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.4, opacity: 0 }}
                                className="size-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" 
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="px-4 py-8 text-xs text-zinc-600 font-medium text-center border border-dashed border-white/[0.02] rounded-2xl mx-1 bg-white/[0.01]">
                No conversations yet
              </div>
            )}
          </div>

          {/* Profile footer — Floating glass card with double bezel decoration */}
          <div className="p-3 border-t border-white/[0.02] bg-[#070709]/50">
            <div className="double-bezel-subtle">
              <div className="double-bezel-subtle-inner !bg-white/[0.01]">
                <motion.button 
                  onClick={() => onNavigate('profile')}
                  whileTap={{ scale: 0.97 }}
                  className={`relative w-full flex items-center gap-3 p-3 rounded-[calc(1rem-1px)] border border-transparent transition-all group overflow-hidden ${
                    currentView === 'profile' 
                      ? 'bg-white/[0.03] border-white/[0.03]' 
                      : 'hover:bg-white/[0.02] hover:border-white/[0.01]'
                  }`}
                  transition={springTransition}
                >
                  <div className="size-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gradient-to-tr from-blue-600/10 to-indigo-600/10 text-blue-400 border border-blue-500/20 inset-glow shadow-sm">
                    {profile?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-[13px] font-semibold text-white/90 truncate">{profile?.name || 'User'}</div>
                    <div className="text-[11px] text-zinc-500 truncate font-medium mt-0.5">
                      {profile?.twitter_handle && `@${profile.twitter_handle}`}
                      {profile?.twitter_handle && profile?.reddit_username && ' · '}
                      {profile?.reddit_username && `u/${profile.reddit_username}`}
                    </div>
                  </div>
                  <Settings className="size-4 text-zinc-500 shrink-0 group-hover:rotate-45 group-hover:text-zinc-300 transition-transform duration-300" />
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed z-50 min-w-[150px] rounded-xl border border-white/[0.08] bg-[#161619]/95 backdrop-blur-xl shadow-2xl p-1 inset-glow"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { onDeleteSession(ctxMenu.sessionId); setCtxMenu(null) }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-red-400 transition-colors flex items-center gap-2.5 rounded-lg font-semibold"
            >
              <Trash2 className="size-3.5" />
              Delete session
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
