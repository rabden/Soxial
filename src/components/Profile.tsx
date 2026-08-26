"use client";

import { useState, useEffect } from 'react'
import { ArrowLeft, Check, Plus, Trash2, KeyRound, Database, Download, Upload, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from 'src/lib/utils'
import { Button } from './ui/button'
import { StrategyReview } from 'src/features/onboarding/StrategyReview'
import type { SettingsSection } from './Sidebar'
import type { BackupListItem } from 'src/types/backup'

interface ProfileProps {
  profile: any;
  section: SettingsSection;
  onBack: () => void;
  onSaved?: () => void;
  onTwitterHandleRebuilt?: () => void;
  onTwitterHandleRebuildRunningChange?: (running: boolean) => void;
}

const SECTION_LABELS: Record<SettingsSection, string> = {
  account: 'Profile',
  strategy: 'Strategy',
  providers: 'AI providers',
  backup: 'Backup',
}

const DETAIL_FIELDS: { label: string; key: string }[] = [
  { label: 'Timezone', key: 'timezone' },
  { label: 'Primary goal', key: 'primary_goal' },
  { label: 'Niche', key: 'niche' },
  { label: 'Specialization', key: 'specialization' },
  { label: 'Superpower', key: 'superpower' },
  { label: 'Target audience', key: 'target_audience' },
  { label: 'Voice', key: 'voice_description' },
  { label: 'Tone balance', key: 'tone_balance' },
  { label: 'Words to avoid', key: 'avoid_words' },
  { label: 'Branding', key: 'branding_strategy' },
  { label: 'Tools', key: 'tools_stack' },
  { label: 'Monetization', key: 'monetization_goals' },
  { label: 'Growth target', key: 'growth_target' },
  { label: 'Portfolio', key: 'portfolio_status' },
]

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

// Same input shell as the onboarding steps: h-11 card surface, hairline
// border, corner-radius morph on focus.
function TextField({ label, value, onChange, placeholder, type = 'text', icon: Icon, disabled }: {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  icon?: any
  disabled?: boolean
}) {
  return (
    <div className={cn(label ? 'space-y-2' : '')}>
      {label && <label className="ml-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</label>}
      <div className="group relative flex h-11 items-center rounded-xl border border-input/60 bg-card px-4 shadow-sm transition-[background-color,border-color,box-shadow,border-radius] hover:border-input focus-within:rounded-[1.25rem] focus-within:border-input">
        <input
          type={type}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            'h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50',
            Icon ? 'pl-8' : ''
          )}
        />
        {Icon && <Icon className="pointer-events-none absolute left-3 size-4 text-zinc-600 transition-colors group-focus-within:text-zinc-400" />}
      </div>
    </div>
  )
}

export default function Profile({ profile, section, onBack, onSaved, onTwitterHandleRebuilt, onTwitterHandleRebuildRunningChange }: ProfileProps) {
  const [activeTab, setActiveTab] = useState<'google' | 'zhipu'>('google')
  const [primaryGoogleKey, setPrimaryGoogleKey] = useState(profile?.gemini_api_key || '')
  const [primaryZhipuKey, setPrimaryZhipuKey] = useState(profile?.zai_api_key || '')
  const [googleExtras, setGoogleExtras] = useState<Array<{ id?: number; value: string; masked?: string }>>([])
  const [zhipuExtras, setZhipuExtras] = useState<Array<{ id?: number; value: string; masked?: string }>>([])
  const [codingPlan, setCodingPlan] = useState(profile?.zai_coding_plan === 1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [strategyReviewRunId, setStrategyReviewRunId] = useState<string | null>(null)
  const [strategyBusy, setStrategyBusy] = useState(false)
  const [strategyError, setStrategyError] = useState('')
  const [changingHandle, setChangingHandle] = useState(false)
  const [handleInput, setHandleInput] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildPhase, setRebuildPhase] = useState('')
  const [rebuildError, setRebuildError] = useState('')
  const [rebuildResult, setRebuildResult] = useState<{ handle: string; archivedCount: number } | null>(null)
  const [backups, setBackups] = useState<BackupListItem[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [includeMedia, setIncludeMedia] = useState(false)

  useEffect(() => {
    window.api.getApiKeys('google').then((keys: any[]) => {
      setGoogleExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: '', masked: k.masked })))
      if (profile?.gemini_api_key) setPrimaryGoogleKey(profile.gemini_api_key)
    })
    window.api.getApiKeys('zhipu').then((keys: any[]) => {
      setZhipuExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: '', masked: k.masked })))
    })
  }, [])

  useEffect(() => {
    void refreshBackups()
  }, [])

  const refreshBackups = async () => {
    try {
      setBackups(await window.api.listBackups())
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Could not load backups.')
    }
  }

  const handleCreateBackup = async () => {
    setBackupBusy(true)
    setBackupMessage('')
    try {
      await window.api.createBackup()
      await refreshBackups()
      setBackupMessage('Verified backup created.')
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Backup creation failed.')
    } finally {
      setBackupBusy(false)
    }
  }

  const handleRestoreBackup = async (backup: BackupListItem) => {
    if (!backup.verified || !window.confirm(`Restore the backup from ${formatBackupDate(backup.createdAt)}? The current database will be backed up first.`)) return
    setBackupBusy(true)
    setBackupMessage('')
    try {
      await window.api.restoreBackup(backup.fileName)
      window.location.reload()
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Restore failed. Your current data was preserved.')
      setBackupBusy(false)
    }
  }

  const handleExport = async () => {
    setBackupBusy(true)
    setBackupMessage('')
    try {
      const result = await window.api.exportData(includeMedia)
      if (!('destination' in result)) {
        setBackupBusy(false)
        return
      }
      setBackupMessage(`Exported ${formatBytes(result.sizeBytes)} without credentials.`)
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setBackupBusy(false)
    }
  }

  const formatBackupDate = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
  }

  const formatBytes = (value: number) => {
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

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

  const startChangingHandle = () => {
    setChangingHandle(true)
    setHandleInput(profile?.twitter_handle ? `@${profile.twitter_handle}` : '')
    setRebuildError('')
    setRebuildResult(null)
  }

  const openStrategyReview = async () => {
    if (strategyBusy) return
    setStrategyBusy(true)
    setStrategyError('')
    try {
      const result = await window.api.getStrategyRunId()
      if (result?.runId) {
        setStrategyReviewRunId(result.runId)
      } else {
        setStrategyError('No committed strategy yet. Finish onboarding to build one.')
      }
    } catch {
      setStrategyError('Could not load your strategy.')
    } finally {
      setStrategyBusy(false)
    }
  }

  const closeStrategyReview = () => {
    setStrategyReviewRunId(null)
    setStrategyError('')
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
      {/* Ambient radial lighting, matching onboarding */}
      <div className="absolute inset-x-0 top-0 h-[560px] pointer-events-none overflow-hidden">
        <div className="absolute left-1/2 top-[-320px] -translate-x-1/2 w-[800px] h-[800px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%)' }} />
        <div className="absolute right-[8%] top-[120px] w-[520px] h-[520px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.035) 0%, transparent 70%)' }} />
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-[840px] mx-auto px-8 py-16 relative z-10"
      >
        
        {/* Navigation Action */}
        <motion.div variants={itemVariants} className="mb-14 flex items-center justify-between">
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
          <span className="text-[10px] tracking-[0.16em] font-bold text-zinc-600 uppercase">
            {SECTION_LABELS[section]}
          </span>
        </motion.div>

        {/* Identity Section */}
        {section === 'account' && (
        <>
        <motion.header variants={itemVariants} className="mb-14">
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight leading-none mb-4">
            {profile?.name || 'Anonymous User'}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-zinc-400">
            {profile?.niche && (
              <span className="text-zinc-300">{profile.niche}</span>
            )}
            {profile?.niche && (profile?.twitter_handle || profile?.reddit_username) && (
              <span className="text-zinc-700">•</span>
            )}
            {profile?.twitter_handle && (
              <span className="inline-flex items-center gap-2">
                <XLogo className="size-3.5 text-zinc-400" />
                <a
                  href={`https://x.com/${profile.twitter_handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white transition-colors"
                >
                  @{profile.twitter_handle}
                </a>
                {profile.twitter_name && (
                  <span className="text-xs text-zinc-600">({profile.twitter_name})</span>
                )}
              </span>
            )}
            {profile?.reddit_username && (
              <span className="inline-flex items-center gap-2">
                <RedditLogo className="size-3.5 text-zinc-400" />
                <a
                  href={`https://reddit.com/user/${profile.reddit_username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white transition-colors"
                >
                  u/{profile.reddit_username}
                </a>
                {profile.reddit_display_name && (
                  <span className="text-xs text-zinc-600">({profile.reddit_display_name})</span>
                )}
              </span>
            )}
          </div>
        </motion.header>

        {/* Gathered profile details */}
        {(() => {
          const details = DETAIL_FIELDS
            .map(({ label, key }) => ({ label, value: typeof profile?.[key] === 'string' ? profile[key].trim() : profile?.[key] }))
            .filter(d => d.value)
          if (details.length === 0) return null
          return (
            <motion.div variants={itemVariants} className="mb-14 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6">
              {details.map(({ label, value }) => (
                <div key={label} className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</div>
                  <div className="text-sm leading-6 text-zinc-300">{value}</div>
                </div>
              ))}
            </motion.div>
          )
        })()}
        </>
        )}

        {section === 'strategy' && (
        <motion.section variants={itemVariants} className="space-y-10">
          {/* Strategy overview */}
          <div className="space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Strategy overview</h2>
            <p className="text-sm leading-6 text-zinc-400 max-w-xl">
              The playbook Soxial built from your accounts. Open it to read, edit, or regenerate any part — changes apply once you approve.
            </p>
            <Button variant="default" size="sm" shape="round" scaleOnPress depthShadow onClick={openStrategyReview} disabled={strategyBusy || rebuilding}>
              {strategyBusy ? 'Opening…' : 'Review & edit strategy'}
            </Button>
            {strategyError && (
              <div role="alert" className="max-w-xl rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs leading-5 text-red-200">
                {strategyError}
              </div>
            )}
          </div>

          {/* X voice source */}
          <div className="space-y-4 pt-10 border-t border-white/5">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">X voice source</h2>
            {!changingHandle ? (
              <>
                <p className="text-sm leading-6 text-zinc-400 max-w-xl">
                  Pick any public X profile for voice and strategy inspiration. It does not need to be your account. Rebuilding archives active X drafts and scheduled posts.
                </p>
                <Button variant="outline" size="sm" shape="round" scaleOnPress depthShadow onClick={startChangingHandle} disabled={rebuilding}>
                  Change voice source
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 md:p-8 space-y-6 max-w-2xl">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm text-zinc-300 font-medium leading-6">
                    Pick any public X profile for voice and strategy inspiration. It does not need to be your account.
                  </p>
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
                    <TextField
                      value={handleInput}
                      onChange={(v: string) => {
                        setHandleInput(v)
                        setRebuildError('')
                      }}
                      disabled={rebuilding}
                      placeholder="@handle"
                    />

                    <div className="space-y-5 rounded-xl border border-white/[0.05] bg-white/[0.01] p-5">
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
                          <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs leading-5 text-red-200">
                            {rebuildError}
                          </div>
                          <div className="flex gap-3">
                            <Button variant="default" size="sm" shape="round" scaleOnPress depthShadow onClick={handleStartRebuild}>
                              Retry rebuild
                            </Button>
                            <Button variant="ghost" size="sm" shape="round" scaleOnPress depthShadow onClick={resetHandleChange} className="text-zinc-500 hover:text-white">
                              Back
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-3 pt-1">
                          <Button variant="default" size="sm" shape="round" scaleOnPress depthShadow onClick={handleStartRebuild} disabled={!handleInput.trim()}>
                            Start rebuild
                          </Button>
                          <Button variant="ghost" size="sm" shape="round" scaleOnPress depthShadow onClick={resetHandleChange} className="text-zinc-500 hover:text-white">
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {rebuildResult && (
                  <div role="status" aria-live="polite" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm leading-6 text-emerald-200">
                    Rebuilt strategy from @{rebuildResult.handle}{profile?.twitter_name ? ` (${profile.twitter_name})` : ''}. Archived {postCountCopy(rebuildResult.archivedCount)}.
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.section>
        )}

        {/* API Settings Section */}
        {section === 'providers' && (
        <motion.section variants={itemVariants} className="py-10 border-t border-white/5">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 mb-6">
            Access Credentials
          </h2>

          <div className="space-y-8">
            {/* Sliding Tab Selector */}
            <div className="mx-auto flex w-full max-w-[260px] rounded-xl border border-input/60 bg-card p-1 relative">
              <button
                onClick={() => setActiveTab('google')}
                className={cn(
                  "relative z-10 flex-1 rounded-lg py-2 text-xs font-semibold tracking-wide transition-colors duration-300",
                  activeTab === 'google' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {activeTab === 'google' && (
                  <motion.span
                    layoutId="activeTabBackdropProfile"
                    className="absolute inset-0 rounded-lg border border-white/[0.06] bg-white/[0.06] shadow-sm"
                    transition={springTransition}
                  />
                )}
                Google
              </button>
              <button
                onClick={() => setActiveTab('zhipu')}
                className={cn(
                  "relative z-10 flex-1 rounded-lg py-2 text-xs font-semibold tracking-wide transition-colors duration-300",
                  activeTab === 'zhipu' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {activeTab === 'zhipu' && (
                  <motion.span
                    layoutId="activeTabBackdropProfile"
                    className="absolute inset-0 rounded-lg border border-white/[0.06] bg-white/[0.06] shadow-sm"
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
                      <TextField label="Primary API key" value={primaryGoogleKey} onChange={setPrimaryGoogleKey} placeholder="AIza..." type="password" icon={KeyRound} disabled={rebuilding} />

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
                            <div className="flex-1">
                              <TextField label="Backup API key" value={k.value} onChange={(v: string) => setGoogleExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: v } : item))} placeholder="AIza..." type="password" icon={KeyRound} disabled={rebuilding} />
                            </div>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              shape="square"
                              scaleOnPress
                              depthShadow
                              onClick={() => setGoogleExtras(prev => prev.filter((_, idx) => idx !== i))}
                              disabled={rebuilding}
                              aria-label="Remove key"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <div className="pt-2">
                        <motion.button
                          onClick={() => setGoogleExtras(prev => [...prev, { value: '' }])}
                          disabled={rebuilding}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1 mt-1"
                        >
                          <Plus className="size-3.5" />
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
                      <TextField label="Primary Z.AI API key" value={primaryZhipuKey} onChange={setPrimaryZhipuKey} placeholder="ZAI_api_key..." type="password" icon={KeyRound} disabled={rebuilding} />

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
                            <div className="flex-1">
                              <TextField label="Backup API key" value={k.value} onChange={(v: string) => setZhipuExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: v } : item))} placeholder="ZAI_api_key..." type="password" icon={KeyRound} disabled={rebuilding} />
                            </div>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              shape="square"
                              scaleOnPress
                              depthShadow
                              onClick={() => setZhipuExtras(prev => prev.filter((_, idx) => idx !== i))}
                              disabled={rebuilding}
                              aria-label="Remove key"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <div className="pt-2">
                        <motion.button
                          onClick={() => setZhipuExtras(prev => [...prev, { value: '' }])}
                          disabled={rebuilding}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1 mt-1"
                        >
                          <Plus className="size-3.5" />
                          Add backup key
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

            {/* Save Button */}
          <div className="flex justify-end pt-1">
            <Button
              onClick={handleSaveKeys}
              variant="default"
              size="default"
              shape="round"
              scaleOnPress
              depthShadow
              disabled={rebuilding || saving || (!primaryGoogleKey.trim() && !primaryZhipuKey.trim() && !googleExtras.some(e => e.value.trim()) && !zhipuExtras.some(e => e.value.trim()))}
            >
              {saving ? (
                <span className="animate-pulse">Saving...</span>
              ) : saved ? (
                <>
                  <Check className="size-4" />
                  Changes Applied
                </>
              ) : (
                <>Save credentials</>
              )}
            </Button>
            </div>
          </div>
        </motion.section>
        )}

        {/* Backup and Export Section */}
        {section === 'backup' && (
        <motion.section variants={itemVariants} className="py-10 border-t border-white/5">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 mb-2">
                Data Protection
              </h2>
              <p className="text-xs text-zinc-500 leading-5 max-w-xl">
                Verified SQLite snapshots protect your local workspace. Portable exports never include API keys, tokens, cookies, or credential vault data.
              </p>
            </div>
            <Database className="size-4 text-zinc-600 shrink-0" />
          </div>

          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-6 md:p-8 space-y-6">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleCreateBackup}
                  variant="default"
                  size="sm"
                  shape="round"
                  scaleOnPress
                  depthShadow
                  disabled={backupBusy || rebuilding}
                >
                  <Database className="size-3.5" />
                  {backupBusy ? 'Working…' : 'Backup now'}
                </Button>
                <Button
                  onClick={handleExport}
                  variant="outline"
                  size="sm"
                  shape="round"
                  scaleOnPress
                  depthShadow
                  disabled={backupBusy || rebuilding}
                >
                  <Download className="size-3.5" />
                  Export data
                </Button>
                <Button
                  onClick={() => void refreshBackups()}
                  variant="ghost"
                  size="icon"
                  shape="square"
                  scaleOnPress
                  disabled={backupBusy}
                  aria-label="Refresh backups"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>

              <label className="flex items-center gap-3 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMedia}
                  onChange={(event) => setIncludeMedia(event.target.checked)}
                  disabled={backupBusy}
                  className="accent-blue-500"
                />
                Include safe local media in ZIP exports
              </label>

              {backupMessage && (
                <div role="status" aria-live="polite" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-xs leading-5 text-emerald-200">
                  {backupMessage}
                </div>
              )}

              <div className="space-y-2">
                {backups.length === 0 ? (
                  <p className="text-xs text-zinc-600 py-3">No backups yet. Automatic backups run when the app is idle.</p>
                ) : backups.map((backup) => (
                  <div key={backup.fileName} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                        <ShieldCheck className={cn('size-3.5', backup.verified ? 'text-emerald-400' : 'text-red-400')} />
                        {formatBackupDate(backup.createdAt)}
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-500">{backup.reason}</span>
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-1">
                        {formatBytes(backup.sizeBytes)} · schema {backup.schemaVersion} · {backup.verified ? 'verified' : backup.verificationError || 'invalid'}
                      </div>
                    </div>
                    {backup.verified && (
                      <button
                        onClick={() => void handleRestoreBackup(backup)}
                        disabled={backupBusy || rebuilding}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-bold text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors disabled:opacity-30"
                      >
                        <Upload className="size-3" />
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
          </div>
        </motion.section>
        )}

        {/* Footer */}
        {section === 'account' && profile?.created_at && (
          <motion.div variants={itemVariants} className="mt-14 pt-8 border-t border-white/[0.03] text-[9px] tracking-[0.2em] text-zinc-600 font-bold uppercase text-center">
            Initialized {new Date(profile.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </motion.div>
        )}
      </motion.div>

      {/* Strategy review overlay — same surface as post-onboarding review */}
      <AnimatePresence>
        {strategyReviewRunId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 overflow-y-auto bg-[#050507]/85"
            role="dialog"
            aria-modal="true"
            aria-label="Strategy overview"
          >
            <div className="mx-auto flex min-h-full w-[min(680px,calc(100vw-3rem))] flex-col justify-center px-2 py-10">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-tight text-white">Strategy overview</h2>
                  <button
                    onClick={closeStrategyReview}
                    aria-label="Close strategy overview"
                    className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {strategyError && (
                  <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs leading-5 text-red-200">
                    {strategyError}
                  </div>
                )}
                <StrategyReview
                  runId={strategyReviewRunId}
                  onCommitted={() => {
                    closeStrategyReview()
                    onSaved?.()
                  }}
                  onError={(message) => {
                    if (message === 'saved-later') {
                      closeStrategyReview()
                      return
                    }
                    setStrategyError(message)
                  }}
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
