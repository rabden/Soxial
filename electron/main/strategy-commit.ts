// Plan 12: transactional strategy commit.
//
// Applies an approved draft to the active tables inside ONE SQLite transaction.
// Failure anywhere rolls back everything and leaves the draft reviewable.
// Double approval is an idempotent success; stale versions are rejected with a
// typed error. Identity fields can never pass through here.

import type Database from 'better-sqlite3'
import {
  StrategyDraftDocument,
  StrategyDraftRow,
  algorithmKey,
  getBaseSnapshot,
  getDraftRow,
  getMergedGrowthStrategy,
  hookKey,
  parseDraftDocument,
  pillarKey,
  targetKey,
  voiceRuleKey,
} from './strategy-draft'
import { validateOnboardingReadiness } from './onboarding-readiness'
import type { ConnectedPlatforms, ToolLedgerEntry } from './onboarding-run'
import { logger } from './log'

export type CommitErrorCode =
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_NOT_IN_REVIEW'
  | 'DRAFT_VERSION_CONFLICT'
  | 'COMMIT_BLOCKED_INCOMPLETE'
  | 'COMMIT_FAILED'

export interface CommitFailure {
  ok: false
  code: CommitErrorCode
  message: string
  missing?: string[]
}

export interface CommitSuccess {
  ok: true
  alreadyCommitted?: boolean
}

/** Persisted when the draft enters review, reused for commit revalidation. */
export interface DraftValidationPayload {
  gaps: { artifact: string; reason: string }[]
}

function parseValidationPayload(row: StrategyDraftRow): DraftValidationPayload {
  if (!row.validation_json) return { gaps: [] }
  try {
    const parsed = JSON.parse(row.validation_json) as DraftValidationPayload
    return { gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [] }
  } catch {
    return { gaps: [] }
  }
}

/**
 * Context the caller must supply for commit-time revalidation: the run's
 * persisted tool ledger and summary, so `validateOnboardingReadiness` runs on
 * exactly the merged state the reviewer approved.
 */
export interface CommitReadinessContext {
  connectedPlatforms: ConnectedPlatforms
  ledger: ToolLedgerEntry[]
  finalText: string
}

/**
 * Decide whether a verified pre-commit backup is still needed for this draft:
 * one per draft is enough, so an existing 'pre-commit' backup taken after the
 * draft was created suppresses another.
 */
export function shouldTakePreCommitBackup(
  backups: Array<{ reason: string; createdAt: string }>,
  draftCreatedAt: string,
): boolean {
  return !backups.some(backup => backup.reason === 'pre-commit' && backup.createdAt >= draftCreatedAt)
}

/**
 * Apply an approved draft atomically. Never touches identity fields; never
 * deletes rows that were created after the base snapshot. Readiness is
 * re-validated on the merged state with the shared Plan 9 validator — global
 * table counts prove nothing, only this run's ledger does.
 */
export function commitOnboardingStrategy(
  db: Database.Database,
  runId: string,
  expectedVersion: number,
  context: CommitReadinessContext,
): CommitSuccess | CommitFailure {
  const row = getDraftRow(db, runId)
  if (!row) {
    return { ok: false, code: 'DRAFT_NOT_FOUND', message: 'No strategy draft exists for this run.' }
  }
  // Idempotent double approval.
  if (row.status === 'committed') return { ok: true, alreadyCommitted: true }
  if (row.status !== 'review') {
    return { ok: false, code: 'DRAFT_NOT_IN_REVIEW', message: `Draft is ${row.status}, not awaiting review.` }
  }
  if (row.version !== expectedVersion) {
    return { ok: false, code: 'DRAFT_VERSION_CONFLICT', message: 'The strategy changed since you opened review. Please reload.' }
  }

  let doc: StrategyDraftDocument
  try {
    doc = parseDraftDocument(row)
  } catch (error) {
    logger.error('strategy-commit', `unreadable draft for ${runId}`, error)
    return { ok: false, code: 'COMMIT_FAILED', message: 'The draft could not be read.' }
  }

  const validation = parseValidationPayload(row)
  const check = validateOnboardingReadiness({
    ledger: context.ledger,
    growthStrategy: getMergedGrowthStrategy(db, runId),
    connectedPlatforms: context.connectedPlatforms,
    finalText: context.finalText,
    gaps: validation.gaps.map(gap => gap as any),
  })
  if (!check.ready) {
    return {
      ok: false,
      code: 'COMMIT_BLOCKED_INCOMPLETE',
      message: `The strategy is incomplete: ${check.missing.join(', ')}.`,
      missing: check.missing,
    }
  }

  const snapshot = getBaseSnapshot(row)

  // Deletion safety: a deletion may only remove rows that existed when the
  // snapshot was taken. Anything the user created afterwards survives.
  const snapshotKeys = {
    hooks: new Set(snapshot.hooks.map(hookKey)),
    pillars: new Set(snapshot.content_pillars.map(pillarKey)),
    voice_rules: new Set(snapshot.voice_rules.map(voiceRuleKey)),
    targets: new Set(snapshot.target_accounts.map(targetKey)),
    algorithm_rules: new Set(snapshot.algorithm_rules.map(algorithmKey)),
  }

  try {
    const applyAll = db.transaction(() => {
      // 1-2. Profile strategy fields first (growth_strategy deliberately last).
      const { growth_strategy: _growth, ...profileFields } = doc.profileStrategyFields
      if (Object.keys(profileFields).length > 0) {
        const sets = Object.keys(profileFields).map(key => `${key} = @${key}`).join(', ')
        db.prepare(`UPDATE user_profile SET ${sets} WHERE id = 1`).run(profileFields)
      }

      // 3. Pillars (upsert by name, production SELECT-else-INSERT pattern —
      // active tables carry no unique constraints).
      for (const p of doc.pillars) {
        const existing = db.prepare('SELECT id FROM content_pillars WHERE name = ?').get(p.name) as any
        if (existing) {
          db.prepare(`UPDATE content_pillars SET description=@description, structure=@structure,
            frequency=@frequency, platform_adaptations=@platform_adaptations WHERE id=@id`)
            .run({ structure: null, frequency: null, platform_adaptations: null, ...p, id: existing.id })
        } else {
          db.prepare(`INSERT INTO content_pillars (name, description, structure, frequency, platform_adaptations)
                      VALUES (@name, @description, @structure, @frequency, @platform_adaptations)`)
            .run({ structure: null, frequency: null, platform_adaptations: null, ...p })
        }
      }

      // 4. Hooks (upsert by name).
      for (const h of doc.hooks) {
        const values = { why_it_works: null, template: null, niche_examples: null, performance_notes: null, ...h }
        const existing = db.prepare('SELECT id FROM hooks WHERE name = ?').get(h.name) as any
        if (existing) {
          db.prepare(`UPDATE hooks SET rank=@rank, category=@category, description=@description,
            why_it_works=@why_it_works, template=@template, niche_examples=@niche_examples,
            performance_notes=@performance_notes WHERE id=@id`)
            .run({ ...values, id: existing.id })
        } else {
          db.prepare(`INSERT INTO hooks (rank, category, name, description, why_it_works, template, niche_examples, performance_notes)
                      VALUES (@rank, @category, @name, @description, @why_it_works, @template, @niche_examples, @performance_notes)`)
            .run(values)
        }
      }

      // 5-6. Dedup-inserted collections.
      for (const v of doc.voiceRules) {
        const exists = db.prepare('SELECT id FROM voice_rules WHERE type = ? AND content = ?').get(v.type, v.content)
        if (!exists) db.prepare('INSERT INTO voice_rules (type, content) VALUES (@type, @content)').run(v)
      }
      for (const t of doc.targets) {
        const exists = db.prepare('SELECT id FROM target_accounts WHERE platform = ? AND handle = ?').get(t.platform, t.handle)
        if (!exists) {
          db.prepare(`INSERT INTO target_accounts (platform, handle, tier, why, strategy)
                      VALUES (@platform, @handle, @tier, @why, @strategy)`)
            .run({ tier: null, why: null, strategy: null, ...t })
        }
      }
      for (const r of doc.replies) {
        db.prepare('INSERT INTO replies (platform, category, text) VALUES (@platform, @category, @text)').run(r)
      }
      for (const m of doc.memories) {
        db.prepare(`INSERT INTO memory_entries (type, platform, title, content, data_json)
                    SELECT @type, @platform, @title, @content, @data_json
                    WHERE NOT EXISTS (SELECT 1 FROM memory_entries WHERE type = @type AND title = @title AND content = @content)`)
          .run({ platform: null, data_json: null, ...m })
      }

      // 7. Milestones.
      for (const m of doc.milestones) {
        db.prepare(`INSERT INTO growth_milestones (platform, metric, value, note) VALUES (@platform, @metric, @value, @note)`)
          .run({ note: null, ...m })
      }

      // 8. Recorded deletions — snapshot-backed keys only.
      for (const name of doc.deletions.hooks) {
        if (snapshotKeys.hooks.has(name)) db.prepare('DELETE FROM hooks WHERE name = ?').run(name)
      }
      for (const name of doc.deletions.pillars) {
        if (snapshotKeys.pillars.has(name)) db.prepare('DELETE FROM content_pillars WHERE name = ?').run(name)
      }
      for (const key of doc.deletions.voice_rules) {
        if (!snapshotKeys.voice_rules.has(key)) continue
        const [type, content] = key.split('\u0000')
        db.prepare('DELETE FROM voice_rules WHERE type = ? AND content = ?').run(type, content)
      }
      for (const key of doc.deletions.targets) {
        if (!snapshotKeys.targets.has(key)) continue
        const [platform, handle] = key.split('\u0000')
        db.prepare('DELETE FROM target_accounts WHERE platform = ? AND handle = ?').run(platform, handle)
      }
      for (const key of doc.deletions.algorithm_rules) {
        if (!snapshotKeys.algorithm_rules.has(key)) continue
        const [platform, signal] = key.split('\u0000')
        db.prepare('DELETE FROM algorithm_rules WHERE platform = ? AND signal = ?').run(platform, signal)
      }

      // 9. Growth strategy last.
      const growth = doc.profileStrategyFields.growth_strategy
      if (typeof growth === 'string' && growth.trim()) {
        db.prepare('UPDATE user_profile SET growth_strategy = ? WHERE id = 1').run(growth)
      }

      // 10. Mark committed INSIDE the transaction.
      if (!setDraftStatusInTx(db, runId)) throw new Error('Failed to mark draft committed')
    })

    applyAll()
    logger.info('strategy-commit', `draft for ${runId} committed (version ${row.version})`)
    return { ok: true }
  } catch (error) {
    logger.error('strategy-commit', `commit failed for ${runId}; rolled back`, error)
    return { ok: false, code: 'COMMIT_FAILED', message: 'Applying your strategy failed. The draft was not changed — please retry.' }
  }
}

function setDraftStatusInTx(db: Database.Database, runId: string): boolean {
  // Same transition rules as setDraftStatus but safe inside our transaction
  // (setDraftStatus re-reads the row, which is fine, but we avoid double logic).
  const result = db.prepare(`
    UPDATE onboarding_strategy_drafts SET status = 'committed', updated_at = datetime('now'), committed_at = datetime('now')
    WHERE run_id = ? AND status = 'review'
  `).run(runId)
  return result.changes > 0
}
