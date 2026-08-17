"use client";

import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Check, Plus, Trash2, ChevronDown, ChevronUp, KeyRound, Radio } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from 'src/lib/utils'
import { Message, MessageContent, MessageResponse } from './ai-elements/message'

interface ProfileProps {
  profile: any;
  onBack: () => void;
  onSaved?: () => void;
  onTwitterHandleRebuilt?: () => void;
  onTwitterHandleRebuildRunningChange?: (running: boolean) => void;
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function RedditLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.07 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z" />
    </svg>
  )
}

function ipcErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export default function Profile({ profile, onBack, onSaved, onTwitterHandleRebuilt, onTwitterHandleRebuildRunningChange }: ProfileProps) {
  const [activeTab, setActiveTab] = useState<'google' | 'zhipu'>('google')
  const [primaryGoogleKey, setPrimaryGoogleKey] = useState(profile?.gemini_api_key || '')
  const [primaryZhipuKey, setPrimaryZhipuKey] = useState(profile?.zai_api_key || '')
  const [googleExtras, setGoogleExtras] = useState<Array<{ id?: number; value: string }>>([])
  const [zhipuExtras, setZhipuExtras] = useState<Array<{ id?: number; value: string }>>([])
  const [codingPlan, setCodingPlan] = useState(profile?.zai_coding_plan === 1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandStrategy, setExpandStrategy] = useState(false)
  const [changingHandle, setChangingHandle] = useState(false)
  const [handleInput, setHandleInput] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildPhase, setRebuildPhase] = useState('')
  const [rebuildError, setRebuildError] = useState('')
  const [rebuildResult, setRebuildResult] = useState<{ handle: string; archivedCount: number } | null>(null)

  useEffect(() => {
    window.api.getApiKeys('google').then((keys: any[]) => {
      setGoogleExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: k.api_key })))
      if (profile?.gemini_api_key) setPrimaryGoogleKey(profile.gemini_api_key)
    })
    window.api.getApiKeys('zhipu').then((keys: any[]) => {
      setZhipuExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: k.api_key })))
    })
  }, [])

  const handleSaveKeys = async () => {
    if (rebuilding) return
    setSaving(true)
    try {
      await window.api.updateProfile({
        gemini_api_key: primaryGoogleKey.trim(),
        zai_api_key: primaryZhipuKey.trim(),
        zai_coding_plan: codingPlan ? 1 : 0,
      })

      // Persist Google backup keys
      const existingGoogle = ((await window.api.getApiKeys('google')) as any[]).filter(k => k.name !== 'Primary')
      const keptGoogleIds = new Set(googleExtras.filter(e => e.id).map(e => e.id))
      for (const k of existingGoogle) {
        if (!keptGoogleIds.has(k.id)) await window.api.removeApiKey(k.id)
      }
      for (const e of googleExtras) {
        if (!e.id && e.value.trim()) await window.api.addApiKey(e.value.trim(), 'google')
      }

      // Persist Zhipu backup keys
      const existingZhipu = ((await window.api.getApiKeys('zhipu')) as any[]).filter(k => k.name !== 'Primary')
      const keptZhipuIds = new Set(zhipuExtras.filter(e => e.id).map(e => e.id))
      for (const k of existingZhipu) {
        if (!keptZhipuIds.has(k.id)) await window.api.removeApiKey(k.id)
      }
      for (const e of zhipuExtras) {
        if (!e.id && e.value.trim()) await window.api.addApiKey(e.value.trim(), 'zhipu')
      }

      await window.api.detectApiTier(true)
      onSaved?.()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      console.error('Failed to save API keys:', err)
      alert('Failed to save API keys. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const resetHandleChange = () => {
    setChangingHandle(false)
    setHandleInput('')
    setRebuildError('')
    setRebuildPhase('')
    setRebuildResult(null)
  }

  const postCountCopy = (count: number) => `${count} active X draft/scheduled ${count === 1 ? 'post' : 'posts'}`

  const handleStartRebuild = async () => {
    if (!handleInput.trim()) return
    setRebuilding(true)
    onTwitterHandleRebuildRunningChange?.(true)
    setRebuildError('')
    setRebuildPhase('Checking selected X profile')
    let unsubscribe = () => {}
    try {
      const preview = await window.api.previewTwitterHandleRebuild(handleInput)
      unsubscribe = window.api.onTwitterHandleRebuildProgress((event) => {
        if (event.phase === 'cutover') setRebuildPhase('Applying rebuilt playbook')
        else if (event.phase === 'done') setRebuildPhase('Done')
        else if (event.phase === 'model' || event.phase === 'chunk' || event.phase === 'transientRetry' || event.phase === 'modelSwitch') setRebuildPhase('Rebuilding shared playbook')
        else setRebuildPhase('Checking and gathering source material')
      })
      const result = await window.api.startTwitterHandleRebuild(preview.handle, preview.activeTwitterScheduledPostCount)
      setRebuildPhase('Done')
      setRebuildResult({ handle: preview.handle, archivedCount: result.archivedCount })
      onTwitterHandleRebuilt?.()
    } catch (err) {
      setRebuildError(ipcErrorMessage(err, 'Rebuild failed.'))
    } finally {
      unsubscribe()
      setRebuilding(false)
      onTwitterHandleRebuildRunningChange?.(false)
    }
  }

  const springTransition = {
    type: "spring" as const,
    stiffness: 450,
    damping: 38
  }

  const toggleSpring = {
    type: "spring" as const,
    stiffness: 500,
    damping: 30
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05
      }
    }
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    show: { 
      opacity: 1, 
      y: 0, 
      transition: { type: "spring" as const, stiffness: 350, damping: 30 } 
    }
  }

  return (
    <div className="flex-1 overflow-y-auto selection:bg-foreground selection:text-background pb-32 bg-[#050507] scrollbar-none relative">
      {/* Dynamic ambient radial lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-500/[0.02] blur-[150px] pointer-events-none" />

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-[840px] mx-auto px-8 py-16 relative z-10"
      >
        
        {/* Navigation Action */}
        <motion.div variants={itemVariants} className="mb-14">
          <motion.button 
            onClick={onBack} 
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.98 }}
            disabled={rebuilding}
            className="group flex items-center gap-2 text-[10px] tracking-[0.16em] font-bold text-zinc-500 hover:text-white transition-colors uppercase disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowLeft className="size-3.5" />
            Back to Chat
          </motion.button>
        </motion.div>

        {/* Identity Section */}
        <motion.header variants={itemVariants} className="mb-14">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-none mb-4">
            {profile?.name || 'Anonymous User'}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold tracking-wide text-zinc-500">
            {profile?.niche && (
              <span className="text-zinc-300">{profile.niche}</span>
            )}
            {profile?.niche && (profile?.twitter_handle || profile?.reddit_username) && (
              <span className="text-zinc-800">/</span>
            )}
            {profile?.twitter_handle && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <XLogo className="size-3 text-zinc-400" />
                <a
                  href={`https://x.com/${profile.twitter_handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white transition-colors"
                >
                  @{profile.twitter_handle}
                </a>
                {profile.twitter_name && (
                  <span className="text-zinc-500 font-normal">({profile.twitter_name})</span>
                )}
                <button
                  onClick={() => {
                    setChangingHandle(true)
                    setHandleInput(profile.twitter_handle ? `@${profile.twitter_handle}` : '')
                    setRebuildError('')
                    setRebuildResult(null)
                  }}
                  disabled={rebuilding}
                  className="ml-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  Change
                </button>
              </span>
            )}
            {profile?.reddit_username && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <RedditLogo className="size-3 text-zinc-400" />
                <a 
                  href={`https://reddit.com/user/${profile.reddit_username}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white transition-colors"
                >
                  u/{profile.reddit_username}
                </a>
                {profile.reddit_display_name && (
                  <span className="text-zinc-500 font-normal">({profile.reddit_display_name})</span>
                )}
              </span>
            )}
          </div>
        </motion.header>

        {changingHandle && (
          <motion.section variants={itemVariants} className="mb-14 p-1.5 rounded-3xl bg-white/[0.02] border border-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            <div className="p-6 md:p-8 rounded-[calc(1.5rem+4px)] bg-[#0c0c10]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 mb-2">
                    X Voice Source
                  </h2>
                  <p className="text-sm text-zinc-300 font-medium max-w-xl leading-6">
                    Pick any public X profile for voice and strategy inspiration. It does not need to be your account.
                  </p>
                </div>
                {!rebuilding && (
                  <button
                    onClick={resetHandleChange}
                    className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 hover:text-white transition-colors"
                  >
                    Back
                  </button>
                )}
              </div>

              {!rebuildResult && (
                <div className="space-y-5">
                  <label className="sr-only" htmlFor="twitter-handle-rebuild-input">X handle</label>
                  <input
                    id="twitter-handle-rebuild-input"
                    value={handleInput}
                    onChange={(e) => {
                      setHandleInput(e.target.value)
                      setRebuildError('')
                    }}
                    disabled={rebuilding}
                    placeholder="@handle"
                    className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl px-4 py-4 text-sm font-mono text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10 disabled:opacity-50"
                  />

                  <div className="space-y-5 p-5 rounded-2xl bg-white/[0.015] border border-white/[0.04]">
                    <div className="space-y-2 text-xs text-zinc-400 leading-5">
                      <p>The entire shared cross-platform playbook will be rebuilt, including Reddit-related strategy.</p>
                      <p>Any active X drafts and scheduled posts will be archived and hidden from the active schedule.</p>
                      <p>Chats and settings remain.</p>
                      <p>Existing setup stays intact if rebuilding fails.</p>
                      <p>Likes/bookmarks are only used when the selected handle matches the signed-in X account.</p>
                    </div>
                    {rebuilding ? (
                      <div role="status" aria-live="polite" className="flex items-center gap-3 text-xs text-zinc-300 pt-1">
                        <div className="w-3 h-3 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                        <span>{rebuildPhase}</span>
                      </div>
                    ) : rebuildError ? (
                      <div className="space-y-4">
                        <div role="alert" className="p-4 rounded-2xl bg-red-500/10 border border-red-500/15 text-xs text-red-200 leading-5">
                          {rebuildError}
                        </div>
                        <div className="flex gap-3">
                          <button onClick={handleStartRebuild} className="px-5 py-3 rounded-full bg-white text-[#050507] text-xs font-bold hover:bg-zinc-100 transition-colors">
                            Retry rebuild
                          </button>
                          <button onClick={resetHandleChange} className="px-5 py-3 rounded-full bg-white/[0.03] text-zinc-400 text-xs font-bold hover:text-white hover:bg-white/[0.05] transition-colors">
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3 pt-1">
                        <button onClick={handleStartRebuild} disabled={!handleInput.trim()} className="px-5 py-3 rounded-full bg-white text-[#050507] text-xs font-bold hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:pointer-events-none">
                          Start rebuild
                        </button>
                        <button onClick={resetHandleChange} className="px-5 py-3 rounded-full bg-white/[0.03] text-zinc-400 text-xs font-bold hover:text-white hover:bg-white/[0.05] transition-colors">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {rebuildResult && (
                <div role="status" aria-live="polite" className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 text-sm text-emerald-100 leading-6">
                  Rebuilt strategy from @{rebuildResult.handle}{profile?.twitter_name ? ` (${profile.twitter_name})` : ''}. Archived {postCountCopy(rebuildResult.archivedCount)}.
                </div>
              )}
            </div>
          </motion.section>
        )}

        {/* Playbook Section (Borderless Inline Accordion) */}
        {profile?.growth_strategy && (
          <motion.section variants={itemVariants} className="py-10 border-t border-white/[0.03]">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Strategic Playbook
              </h2>
              <motion.button 
                onClick={() => setExpandStrategy(!expandStrategy)}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
              >
                {expandStrategy ? (
                  <>Collapse Playbook <ChevronUp className="size-3.5" /></>
                ) : (
                  <>Reveal Playbook <ChevronDown className="size-3.5" /></>
                )}
              </motion.button>
            </div>

            <div 
              className={cn(
                "grid transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                expandStrategy ? "grid-rows-[1fr] opacity-100 mt-6" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <div className="p-1.5 rounded-2xl bg-white/[0.01] border border-white/[0.02]">
                  <Message from="assistant">
                    <MessageContent className="px-6 py-5">
                      <MessageResponse className="prose prose-invert max-w-none prose-p:leading-[1.75] prose-p:text-zinc-400 prose-p:text-[13.5px] prose-p:font-normal 
                        prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-white/95 
                        prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                        prose-strong:font-bold prose-strong:text-white
                        prose-code:text-zinc-300 prose-code:bg-white/[0.04] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                        prose-ul:text-zinc-400 prose-ul:font-normal
                        prose-ol:text-zinc-400 prose-ol:font-normal"
                      >
                        {profile.growth_strategy}
                      </MessageResponse>
                    </MessageContent>
                  </Message>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* API Settings Section */}
        <motion.section variants={itemVariants} className="py-10 border-t border-white/[0.03]">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 mb-6">
            Access Credentials
          </h2>

          <div className="space-y-6">
            {/* Elegant Translucent Card Panel */}
            <div className="p-1.5 rounded-3xl bg-white/[0.02] border border-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
              <div className="p-6 md:p-10 rounded-[calc(1.5rem+4px)] bg-[#0c0c10]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] space-y-8">

                {/* Sliding Tab Selector */}
                <div className="p-0.5 rounded-xl bg-white/[0.02] border border-white/[0.04] flex max-w-[240px] relative">
                  <button
                    onClick={() => setActiveTab('google')}
                    className={cn(
                      "flex-1 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-colors duration-300 relative z-10",
                      activeTab === 'google' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {activeTab === 'google' && (
                      <motion.span 
                        layoutId="activeTabBackdrop"
                        className="absolute inset-0 rounded-lg bg-white/[0.04] border border-white/[0.03] shadow-sm"
                        transition={springTransition}
                      />
                    )}
                    Google
                  </button>
                  <button
                    onClick={() => setActiveTab('zhipu')}
                    className={cn(
                      "flex-1 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-colors duration-300 relative z-10",
                      activeTab === 'zhipu' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {activeTab === 'zhipu' && (
                      <motion.span 
                        layoutId="activeTabBackdrop"
                        className="absolute inset-0 rounded-lg bg-white/[0.04] border border-white/[0.03] shadow-sm"
                        transition={springTransition}
                      />
                    )}
                    Z.AI
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {activeTab === 'google' ? (
                    <motion.div 
                      key="google"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6"
                    >
                      {/* Primary Key */}
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">
                          Primary API key
                        </label>
                        <div className="relative flex items-center group">
                          <input
                            type="password"
                            value={primaryGoogleKey}
                            onChange={(e) => setPrimaryGoogleKey(e.target.value)}
                            disabled={rebuilding}
                            placeholder="AIza..."
                            className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl pl-11 pr-4 py-4 text-sm font-mono text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10"
                          />
                          <KeyRound className="size-4 text-zinc-600 group-focus-within:text-blue-500/50 absolute left-4 transition-colors" />
                        </div>
                      </div>

                      {/* Google Backup Keys */}
                      <AnimatePresence mode="popLayout">
                        {googleExtras.map((k, i) => (
                          <motion.div 
                            key={k.id ?? `new-g-${i}`} 
                            initial={{ opacity: 0, scale: 0.98, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: -10 }}
                            transition={springTransition}
                            className="flex items-end gap-3"
                          >
                            <div className="flex-1 space-y-2">
                              <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">
                                Backup API key
                              </label>
                              <div className="relative flex items-center group">
                                <input
                                  type="password"
                                  value={k.value}
                                  onChange={(e) => setGoogleExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: e.target.value } : item))}
                                  disabled={rebuilding}
                                  placeholder="AIza..."
                                  className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl pl-11 pr-4 py-4 text-sm font-mono text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10"
                                />
                                <KeyRound className="size-4 text-zinc-600 group-focus-within:text-blue-500/50 absolute left-4 transition-colors" />
                              </div>
                            </div>
                            <motion.button
                              onClick={() => setGoogleExtras(prev => prev.filter((_, idx) => idx !== i))}
                              disabled={rebuilding}
                              whileTap={{ scale: 0.95 }}
                              className="flex items-center justify-center w-12 h-[54px] rounded-xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] hover:border-red-500/20 hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors shrink-0 shadow-sm"
                            >
                              <Trash2 className="size-4" />
                            </motion.button>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <div className="pt-2">
                        <motion.button
                          onClick={() => setGoogleExtras(prev => [...prev, { value: '' }])}
                          disabled={rebuilding}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1"
                        >
                          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-white/[0.02] border border-white/[0.04] group-hover:bg-white/[0.04] transition-colors">
                            <Plus className="size-3.5" />
                          </span>
                          Add backup key
                        </motion.button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="zhipu"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6"
                    >
                      {/* Primary Zhipu Key */}
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">
                          Primary Z.AI API key
                        </label>
                        <div className="relative flex items-center group">
                          <input
                            type="password"
                            value={primaryZhipuKey}
                            onChange={(e) => setPrimaryZhipuKey(e.target.value)}
                            disabled={rebuilding}
                            placeholder="ZAI_api_key..."
                            className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl pl-11 pr-4 py-4 text-sm font-mono text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10"
                          />
                          <KeyRound className="size-4 text-zinc-600 group-focus-within:text-blue-500/50 absolute left-4 transition-colors" />
                        </div>
                      </div>

                      {/* Coding Plan toggle */}
                      <div className="flex items-center justify-between p-5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] shadow-sm transition-colors">
                        <div>
                          <div className="text-xs font-semibold text-white tracking-tight">Coding Plan Mode</div>
                          <div className="text-[10px] text-zinc-500 font-medium mt-0.5">Toggle to use dedicated endpoint: https://api.z.ai/api/coding/paas/v4</div>
                        </div>
                        {/* Apple style physical switch */}
                        <button
                          onClick={() => setCodingPlan(!codingPlan)}
                          disabled={rebuilding}
                          className={cn(
                            "w-11 h-6 rounded-full relative p-0.5 transition-colors duration-300 flex items-center border shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]",
                            codingPlan 
                              ? "bg-blue-600 border-blue-500/10" 
                              : "bg-[#0c0c0f] border-white/[0.04]"
                          )}
                        >
                          <motion.span 
                            layout
                            transition={toggleSpring}
                            className="size-5 rounded-full bg-white shadow-md block" 
                            style={{ marginLeft: codingPlan ? 'auto' : '0px' }}
                          />
                        </button>
                      </div>

                      {/* Zhipu Backup Keys */}
                      <AnimatePresence mode="popLayout">
                        {zhipuExtras.map((k, i) => (
                          <motion.div 
                            key={k.id ?? `new-z-${i}`} 
                            initial={{ opacity: 0, scale: 0.98, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: -10 }}
                            transition={springTransition}
                            className="flex items-end gap-3"
                          >
                            <div className="flex-1 space-y-2">
                              <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">
                                Backup API key
                              </label>
                              <div className="relative flex items-center group">
                                <input
                                  type="password"
                                  value={k.value}
                                  onChange={(e) => setZhipuExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: e.target.value } : item))}
                                  disabled={rebuilding}
                                  placeholder="ZAI_api_key..."
                                  className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl pl-11 pr-4 py-4 text-sm font-mono text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10"
                                />
                                <KeyRound className="size-4 text-zinc-600 group-focus-within:text-blue-500/50 absolute left-4 transition-colors" />
                              </div>
                            </div>
                            <motion.button
                              onClick={() => setZhipuExtras(prev => prev.filter((_, idx) => idx !== i))}
                              disabled={rebuilding}
                              whileTap={{ scale: 0.95 }}
                              className="flex items-center justify-center w-12 h-[54px] rounded-xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] hover:border-red-500/20 hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors shrink-0 shadow-sm"
                            >
                              <Trash2 className="size-4" />
                            </motion.button>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <div className="pt-2">
                        <motion.button
                          onClick={() => setZhipuExtras(prev => [...prev, { value: '' }])}
                          disabled={rebuilding}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1"
                        >
                          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-white/[0.02] border border-white/[0.04] group-hover:bg-white/[0.04] transition-colors">
                            <Plus className="size-3.5" />
                          </span>
                          Add backup key
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2 flex justify-end">
              <motion.button
                onClick={handleSaveKeys}
                whileTap={{ scale: 0.96 }}
                disabled={rebuilding || saving || (!primaryGoogleKey.trim() && !primaryZhipuKey.trim() && !googleExtras.some(e => e.value.trim()) && !zhipuExtras.some(e => e.value.trim()))}
                className="group flex items-center gap-3 pl-5 pr-2 py-2 bg-white hover:bg-zinc-100 text-[#050507] rounded-full text-[13px] font-bold transition-all duration-300 disabled:opacity-30 disabled:pointer-events-none shadow-[0_4px_12px_rgba(0,0,0,0.1)] border border-white/[0.04]"
              >
                {saving ? (
                  <span className="animate-pulse">Saving...</span>
                ) : saved ? (
                  <>Changes Applied</>
                ) : (
                  <>Save credentials</>
                )}

                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900 text-white group-hover:translate-x-0.5 group-hover:-translate-y-[1px] transition-transform duration-300">
                  {saved ? <Check className="size-3.5 stroke-[2.5]" /> : <Save className="size-3.5" />}
                </span>
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* Footer */}
        {profile?.created_at && (
          <motion.div variants={itemVariants} className="mt-20 pt-8 border-t border-white/[0.03] text-[9px] tracking-[0.2em] text-zinc-600 font-bold uppercase text-center">
            Initialized {new Date(profile.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
