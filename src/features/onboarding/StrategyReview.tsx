// Plan 12: strategy review surface.
//
// Shows the generated draft as editable sections. Nothing here touches the
// active strategy tables: edits and regenerations go to the draft, and only
// "Approve and continue" runs the transactional commit.

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, Pencil, RefreshCw, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { isEnrichmentEvent } from '../../types/onboarding-events'

type Draft = {
  profileStrategyFields: Record<string, string>
  pillars: any[]
  hooks: any[]
  voiceRules: any[]
  targets: any[]
  algorithmRules: any[]
  memories: any[]
  milestones: any[]
  deletions: Record<string, string[]>
}

interface SectionState {
  key: string
  title: string
  summary: () => string
  editing: boolean
}

const PROFILE_FIELD_LABELS: Record<string, string> = {
  growth_strategy: 'Growth strategy',
  target_audience: 'Target audience',
  voice_description: 'Voice',
  tone_balance: 'Tone balance',
  niche: 'Niche',
  specialization: 'Specialization',
  superpower: 'Superpower',
  primary_goal: 'Primary goal',
  avoid_words: 'Words to avoid',
  branding_strategy: 'Branding',
  monetization_goals: 'Monetization',
  growth_target: 'Growth target',
  portfolio_status: 'Portfolio status',
  tools_stack: 'Tools',
}

export function StrategyReview({
  runId,
  initialVersion,
  onCommitted,
  onError,
}: {
  runId: string
  initialVersion?: number
  onCommitted: () => void
  onError?: (message: string) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [version, setVersion] = useState<number>(initialVersion ?? 0)
  const [loading, setLoading] = useState(true)
  const [busySection, setBusySection] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [committing, setCommitting] = useState(false)

  // Plan 13: background refinement runs after commit; surface its progress
  // quietly and give the user a retry when it fails.
  type EnrichmentUiState = 'idle' | 'running' | 'failed' | 'done'
  const [enrichment, setEnrichment] = useState<EnrichmentUiState>('idle')
  const [retryLimitReached, setRetryLimitReached] = useState(false)

  useEffect(() => {
    let disposed = false
    window.api.getEnrichmentStatus(runId).then(status => {
      if (disposed) return
      const jobStatus = status?.job?.status
      if (jobStatus === 'pending' || jobStatus === 'running') setEnrichment('running')
      else if (jobStatus === 'failed') setEnrichment('failed')
      else if (jobStatus === 'succeeded') setEnrichment('done')
    }).catch(() => { /* status is cosmetic here */ })
    const unsubscribe = window.api.onEnrichmentEvent(event => {
      if (!isEnrichmentEvent(event) || event.runId !== runId) return
      if (event.payload.type === 'stage') setEnrichment('running')
      else if (event.payload.type === 'complete') setEnrichment('done')
      else if (event.payload.type === 'failed') setEnrichment('failed')
      // A cancelled job stays quiet — the user asked for it to stop.
    })
    return () => { disposed = true; unsubscribe() }
  }, [runId])

  const retryEnrichment = async () => {
    setEnrichment('running')
    try {
      const result = await window.api.retryEnrichment(runId)
      if (!result?.success) {
        if (result?.code === 'RETRY_LIMIT_REACHED') setRetryLimitReached(true)
        else onError?.(result?.error || 'The refinement retry could not start.')
        setEnrichment('failed')
      }
    } catch {
      setEnrichment('failed')
    }
  }

  const loadDraft = useCallback(async (runIdToLoad: string) => {
    try {
      const result = await window.api.getStrategyDraft(runIdToLoad)
      if (!result?.success || !result.draft) {
        onError?.(result?.error || 'Could not load your strategy draft.')
        return
      }
      setDraft(result.draft)
      if (typeof result.version === 'number') setVersion(result.version)
      setConflict(false)
    } catch {
      onError?.('Could not load your strategy draft.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    setLoading(true)
    loadDraft(runId)
  }, [runId, loadDraft])

  const guardStale = (result: { success?: boolean; code?: string; error?: string }): boolean => {
    if (result?.success) return true
    if (result?.code === 'DRAFT_VERSION_CONFLICT') {
      setConflict(true)
      loadDraft(runId)
    } else {
      onError?.(result?.error || 'The change could not be saved.')
    }
    return false
  }

  const saveSection = async (section: string, payload: any) => {
    setBusySection(section)
    try {
      const result = await window.api.updateDraftSection(runId, version, section, payload)
      if (!guardStale(result)) return false
      if (typeof result.version === 'number') setVersion(result.version)
      await loadDraft(runId)
      return true
    } finally {
      setBusySection(null)
    }
  }

  const regenerateSection = async (section: string) => {
    setBusySection(`regen:${section}`)
    try {
      const result = await window.api.regenerateDraftSection(runId, version, section)
      if (!guardStale(result)) return
      if (typeof result.version === 'number') setVersion(result.version)
      await loadDraft(runId)
    } finally {
      setBusySection(null)
    }
  }

  const commit = async () => {
    setCommitting(true)
    try {
      const result = await window.api.commitStrategy(runId, version)
      if (!guardStale(result)) return
      onCommitted()
    } finally {
      setCommitting(false)
    }
  }

  if (loading || !draft) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your strategy…
      </div>
    )
  }

  const fields = draft.profileStrategyFields ?? {}

  const textSections: { key: string; field: string; label: string }[] = [
    { key: 'positioning', field: 'growth_strategy', label: 'Positioning' },
    { key: 'audience', field: 'target_audience', label: 'Target audience' },
    { key: 'voice', field: 'voice_description', label: 'Voice' },
    { key: 'cadence', field: 'tone_balance', label: 'Weekly cadence' },
  ]

  const listSummary = (items: any[], label: string) =>
    `${items.length} ${label}${items.length === 1 ? '' : 's'}`

  const SectionHeader = ({ title, sectionKey, summary }: { title: string; sectionKey: string; summary?: string }) => (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <h4 className="text-sm font-medium text-zinc-100">{title}</h4>
        {summary && <span className="text-xs text-zinc-500 truncate">{summary}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {busySection === `regen:${sectionKey}` ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
        ) : (
          <button
            onClick={() => regenerateSection(sectionKey)}
            disabled={committing}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            title={`Regenerate ${title.toLowerCase()}`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
        {!editing[sectionKey] && (
          <button
            onClick={() => {
              setDraftEdits(prev => ({ ...prev, [sectionKey]: fields[sectionKey] ?? '' }))
              setEditing(prev => ({ ...prev, [sectionKey]: true }))
            }}
            disabled={committing}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            title={`Edit ${title.toLowerCase()}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6">
      {conflict && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          The strategy changed while you were reviewing. Your view has been refreshed — please re-check before approving.
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">Review your strategy</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Soxial drafted this from your accounts. Edit anything that feels off — nothing goes live until you approve.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            v{version}
          </span>
        </div>

        {/* Primary sections */}
        <div className="space-y-5">
          {textSections.map(({ key, field, label }) => (
            <div key={key} className="space-y-2 border-t border-zinc-800/70 pt-4 first:border-none first:pt-0">
              <SectionHeader title={label} sectionKey={key} />
              {editing[key] ? (
                <div className="space-y-2">
                  <textarea
                    value={draftEdits[key] ?? ''}
                    onChange={e => setDraftEdits(prev => ({ ...prev, [key]: e.target.value }))}
                    rows={field === 'growth_strategy' ? 8 : 3}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(prev => ({ ...prev, [key]: false }))}>
                      <X className="mr-1 h-3 w-3" /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busySection === key}
                      onClick={async () => {
                        const ok = await saveSection(key === 'cadence' ? 'cadence' : key, {
                          profileFields: { [field]: (draftEdits[key] ?? '').trim() },
                        })
                        if (ok) setEditing(prev => ({ ...prev, [key]: false }))
                      }}
                    >
                      {busySection === key ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                  {fields[field]?.trim() || <span className="italic text-zinc-600">Not written yet.</span>}
                </p>
              )}
            </div>
          ))}

          {/* Pillars */}
          <div className="space-y-2 border-t border-zinc-800/70 pt-4">
            <SectionHeader title="Content pillars" sectionKey="pillars" summary={listSummary(draft.pillars, 'pillar')} />
            <ul className="space-y-1.5">
              {draft.pillars.map((p, i) => (
                <li key={i} className="text-sm text-zinc-300">
                  <span className="font-medium text-zinc-200">{p.name}</span>
                  {p.description && <span className="text-zinc-500"> — {p.description}</span>}
                  {p.frequency && <span className="ml-2 text-xs text-zinc-600">{p.frequency}</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* Targets */}
          <div className="space-y-2 border-t border-zinc-800/70 pt-4">
            <SectionHeader title="Platform priorities & targets" sectionKey="targets" summary={listSummary(draft.targets, 'target')} />
            <ul className="space-y-1.5">
              {draft.targets.slice(0, 6).map((t, i) => (
                <li key={i} className="text-sm text-zinc-300">
                  <span className="font-medium text-zinc-200">{t.platform === 'twitter' ? '@' : 'r/'}{t.handle}</span>
                  {t.tier && <span className="ml-2 text-xs text-zinc-600">{t.tier}</span>}
                  {t.why && <span className="text-zinc-500"> — {t.why}</span>}
                </li>
              ))}
              {draft.targets.length > 6 && (
                <li className="text-xs text-zinc-600">+{draft.targets.length - 6} more</li>
              )}
            </ul>
          </div>

          {/* Advanced */}
          <div className="border-t border-zinc-800/70 pt-4">
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-medium text-zinc-300">Advanced details</span>
              <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 text-sm text-zinc-400">
                <p>{listSummary(draft.hooks, 'hook')} · {listSummary(draft.voiceRules, 'voice rule')} · {listSummary(draft.algorithmRules, 'algorithm rule')} · {listSummary(draft.memories, 'memory')} · {listSummary(draft.milestones, 'baseline metric')}</p>
                <div>
                  <p className="mb-1 font-medium text-zinc-500">Hooks</p>
                  <ul className="space-y-0.5">
                    {draft.hooks.map((h, i) => (
                      <li key={i} className="truncate">{h.rank}. {h.name}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-medium text-zinc-500">Voice rules</p>
                  <ul className="space-y-0.5">
                    {draft.voiceRules.map((v, i) => (
                      <li key={i} className="truncate"><span className="uppercase text-[10px] tracking-wide text-zinc-600">{v.type.replace(/_/g, ' ')}</span> — {v.content}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {enrichment === 'running' && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refining your strategy…
        </div>
      )}
      {enrichment === 'failed' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {retryLimitReached
              ? 'Background refinement could not finish — your approved strategy is already in use.'
              : 'Background refinement didn’t finish. Everything you approved is saved.'}
          </span>
          {!retryLimitReached && (
            <Button variant="ghost" size="sm" disabled={committing} onClick={retryEnrichment}>
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={committing} onClick={() => onError?.('saved-later')}>
          Save and finish later
        </Button>
        <Button size="sm" disabled={committing} onClick={commit}>
          {committing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
          Approve and continue
        </Button>
      </div>
    </div>
  )
}
