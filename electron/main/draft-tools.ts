// Draft-scoped tool adapter (Plan 11).
//
// Wraps the capability-filtered onboarding tools so every strategy read
// returns base ⊕ draft merged state and every strategy write lands in the
// run's draft document instead of the active tables. Result shapes match the
// production tools exactly, so artifactFromTool / readiness validation and the
// repair pass work unchanged.
//
// The adapter is pure plumbing: schemas, descriptions, and capability metadata
// are inherited from the wrapped tools.

import type Database from 'better-sqlite3'
import {
  algorithmKey,
  getMergedCollections,
  hookKey,
  pillarKey,
  sanitizeProfileStrategyFields,
  targetKey,
  updateDraft,
  voiceRuleKey,
} from './strategy-draft'

type AnyTool = { description: string; parameters: any; execute: (args: any) => Promise<any> }
type ToolMap = Record<string, AnyTool>

/** Single late-writer result shared by every draft write tool. */
const DRAFT_WRITE_CONFLICT = { success: false, error: 'Draft write conflict — please retry.' } as const

const DRAFT_READ_TOOLS = new Set([
  'read_hooks',
  'read_voice_rules',
  'read_replies',
  'read_algorithm',
  'read_memory',
  'read_pillars',
  'read_targets',
])

const DRAFT_WRITE_TOOLS = new Set([
  'save_reply',
  'save_memory',
  'save_milestone',
  'save_pillar',
  'save_target',
  'save_voice_rule',
  'save_hook',
  'save_algorithm_rule',
  'delete_voice_rules',
  'delete_hooks',
  'delete_pillars',
  'delete_targets',
  'delete_algorithm_rules',
])

function mergedRead(db: Database.Database, runId: string) {
  return getMergedCollections(db, runId)
}

/**
 * Build a draft-scoped copy of the given tool map for one onboarding run.
 * Tools outside the strategy surface pass through untouched.
 */
export function createDraftScopedTools(base: ToolMap, db: Database.Database, runId: string): ToolMap {
  const out: ToolMap = {}

  for (const [name, tool] of Object.entries(base)) {
    if (!DRAFT_READ_TOOLS.has(name) && !DRAFT_WRITE_TOOLS.has(name)) {
      out[name] = tool
      continue
    }

    if (DRAFT_READ_TOOLS.has(name)) {
      out[name] = {
        ...tool,
        execute: async (args: any) => {
          const merged = mergedRead(db, runId)
          switch (name) {
            case 'read_hooks': {
              let rows = merged.hooks
              if (args?.category && args.category !== 'all') rows = rows.filter(h => h.category === args.category)
              if (args?.limit) rows = rows.slice(0, args.limit)
              return rows
            }
            case 'read_voice_rules': {
              const rows = merged.voice_rules
              if (!args?.type || args.type === 'all') return rows
              return rows.filter(r => r.type === args.type)
            }
            case 'read_replies': {
              let rows = merged.replies
              if (args?.platform) rows = rows.filter(r => r.platform === args.platform)
              if (args?.category) rows = rows.filter(r => r.category === args.category)
              return rows
            }
            case 'read_algorithm': {
              const rows = merged.algorithm_rules
              if (!args?.platform || args.platform === 'all') return rows
              return rows.filter(r => r.platform === args.platform)
            }
            case 'read_memory': {
              let rows = merged.memories
              if (args?.type && args.type !== 'all') rows = rows.filter(m => m.type === args.type)
              if (args?.platform) rows = rows.filter(m => m.platform === args.platform)
              if (args?.limit) rows = rows.slice(0, args.limit)
              return rows
            }
            case 'read_pillars':
              return merged.pillars
            case 'read_targets': {
              let rows = merged.target_accounts
              if (args?.platform) rows = rows.filter(t => t.platform === args.platform)
              if (args?.tier) rows = rows.filter(t => t.tier === args.tier)
              return rows
            }
          }
        },
      }
      continue
    }

    // Write tools: mutate the draft, mirror the production result shapes.
    out[name] = {
      ...tool,
      execute: async (args: any) => {
        switch (name) {
          case 'save_pillar': {
            const items = args.items as any[]
            let saved = 0, updated = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const p of items) {
                const existing = doc.pillars.find(x => pillarKey(x) === pillarKey(p))
                if (existing) Object.assign(existing, p)
                else doc.pillars.push({ structure: null, frequency: null, platform_adaptations: null, ...p })
                saved++
              }
            })
            return ok
              ? { success: true, saved, updated, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_hook': {
            const items = args.items as any[]
            let saved = 0, updated = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const h of items) {
                const existing = doc.hooks.find(x => hookKey(x) === hookKey(h))
                if (existing) Object.assign(existing, h)
                else doc.hooks.push({
                  why_it_works: null, template: null, niche_examples: null, performance_notes: null, ...h,
                })
                saved++
              }
            })
            return ok
              ? { success: true, saved, updated, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_voice_rule': {
            const items = args.items as any[]
            let saved = 0, skipped = 0
            // Dedup against MERGED state so a rule that already exists in the
            // user's active table is not re-saved into the draft.
            const existingKeys = new Set(mergedRead(db, runId).voice_rules.map(r => voiceRuleKey(r)))
            const ok = updateDraft(db, runId, null, doc => {
              for (const v of items) {
                const key = voiceRuleKey(v)
                if (existingKeys.has(key)) { skipped++; continue }
                existingKeys.add(key)
                doc.voiceRules.push(v)
                saved++
              }
            })
            return ok
              ? { success: true, saved, skipped, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_target': {
            const items = args.items as any[]
            let saved = 0, skipped = 0
            const existingKeys = new Set(mergedRead(db, runId).target_accounts.map(t => targetKey(t)))
            const ok = updateDraft(db, runId, null, doc => {
              for (const t of items) {
                const key = targetKey(t)
                if (existingKeys.has(key)) { skipped++; continue }
                existingKeys.add(key)
                doc.targets.push(t)
                saved++
              }
            })
            return ok
              ? { success: true, saved, skipped, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_algorithm_rule': {
            const items = args.items as any[]
            let saved = 0, updated = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const a of items) {
                const existing = doc.algorithmRules.find(x => algorithmKey(x) === algorithmKey(a))
                if (existing) Object.assign(existing, a)
                else doc.algorithmRules.push(a)
                saved++
              }
            })
            return ok
              ? { success: true, saved, updated, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_reply': {
            const items = args.items as any[]
            const ok = updateDraft(db, runId, null, doc => { doc.replies.push(...items) })
            return ok
              ? { success: true, count: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_memory': {
            const items = args.items as any[]
            let saved = 0
            // Same dedup key as the production tool, evaluated over merged state.
            const existing = new Set(mergedRead(db, runId).memories.map(m =>
              `${m.type}\u0000${m.title ?? ''}\u0000${m.content ?? ''}`))
            const ok = updateDraft(db, runId, null, doc => {
              for (const m of items) {
                const key = `${m.type}\u0000${m.title ?? ''}\u0000${m.content ?? ''}`
                if (existing.has(key)) continue
                existing.add(key)
                doc.memories.push({ platform: null, data_json: null, ...m })
                saved++
              }
            })
            return ok
              ? { success: true, saved, skipped: items.length - saved, total: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'save_milestone': {
            const items = args.items as any[]
            const ok = updateDraft(db, runId, null, doc => {
              doc.milestones.push(...items.map((m: any) => ({ note: null, ...m })))
            })
            return ok
              ? { success: true, count: items.length }
              : DRAFT_WRITE_CONFLICT
          }

          case 'delete_hooks':
          case 'delete_pillars': {
            const keys = args.by_name ?? []
            const table = name === 'delete_hooks' ? 'hooks' : 'pillars'
            let deleted = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const key of keys) {
                if (!doc.deletions[table].includes(key)) doc.deletions[table].push(key)
                deleted++
              }
            })
            return ok
              ? { success: true, deleted }
              : DRAFT_WRITE_CONFLICT
          }

          case 'delete_voice_rules': {
            const contents = args.by_content ?? []
            let deleted = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const content of contents) {
                // Record deletions for both possible rule types, matching the
                // production tool's "delete WHERE content = ?" semantics.
                for (const type of ['banned_phrase', 'banned_structure', 'natural_element'] as const) {
                  const key = voiceRuleKey({ type, content })
                  if (!doc.deletions.voice_rules.includes(key)) doc.deletions.voice_rules.push(key)
                }
                deleted++
              }
            })
            return ok
              ? { success: true, deleted }
              : DRAFT_WRITE_CONFLICT
          }

          case 'delete_targets': {
            const handles = args.by_handle ?? []
            let deleted = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const { platform, handle } of handles) {
                const key = targetKey({ platform, handle })
                if (!doc.deletions.targets.includes(key)) doc.deletions.targets.push(key)
                deleted++
              }
            })
            return ok
              ? { success: true, deleted }
              : DRAFT_WRITE_CONFLICT
          }

          case 'delete_algorithm_rules': {
            const signals = args.by_signal ?? []
            let deleted = 0
            const ok = updateDraft(db, runId, null, doc => {
              for (const { platform, signal } of signals) {
                const key = algorithmKey({ platform, signal })
                if (!doc.deletions.algorithm_rules.includes(key)) doc.deletions.algorithm_rules.push(key)
                deleted++
              }
            })
            return ok
              ? { success: true, deleted }
              : DRAFT_WRITE_CONFLICT
          }
        }
      },
    }
  }

  // update_soxial_profile writes strategy fields into the draft; identity
  // fields are stripped by the same whitelist as the production tool.
  if (base.update_soxial_profile) {
    out.update_soxial_profile = {
      ...base.update_soxial_profile,
      execute: async ({ data }: { data?: Record<string, unknown> }) => {
        const allowed = sanitizeProfileStrategyFields(data)
        const ok = updateDraft(db, runId, null, doc => {
          Object.assign(doc.profileStrategyFields, allowed)
        })
        return ok
          ? { success: true, message: 'Profile updated' }
          : DRAFT_WRITE_CONFLICT
      },
    }
  }

  return out
}
