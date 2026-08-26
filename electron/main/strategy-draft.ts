// Draft strategy repository (Plan 11).
//
// Strategy artifacts written during onboarding land here instead of the active
// tables, so an unreviewed AI strategy can never become operating context.
// Active tables are only touched by the Plan 12 commit transaction.
//
// Concurrency mirrors OnboardingCheckpointStore: single logical writer per run,
// every update bumps `version`, and a late writer loses via
// `WHERE version < excluded.version`. Serialized documents pass through
// redactForCheckpoint, so no secret-bearing field can reach disk.

import type Database from 'better-sqlite3'
import { logger } from './log'

export const STRATEGY_DRAFT_DOC_VERSION = 1 as const

export type StrategyDraftStatus = 'draft' | 'review' | 'committed' | 'discarded'

/** Profile columns the draft may hold. Identity/credential fields never appear. */
const STRATEGY_PROFILE_FIELDS = [
  'niche',
  'specialization',
  'superpower',
  'primary_goal',
  'target_audience',
  'voice_description',
  'avoid_words',
  'brand_primary_color',
  'brand_secondary_color',
  'brand_accent_color',
  'style_preset',
  'growth_strategy',
  'branding_strategy',
  'tools_stack',
  'monetization_goals',
  'growth_target',
  'portfolio_status',
  'tone_balance',
] as const

export type StrategyProfileField = (typeof STRATEGY_PROFILE_FIELDS)[number]

export interface DraftPillar {
  name: string
  description: string
  structure?: string | null
  frequency?: string | null
  platform_adaptations?: string | null
}

export interface DraftHook {
  rank: number
  category: 'showcase' | 'community'
  name: string
  description: string
  why_it_works?: string | null
  template?: string | null
  niche_examples?: string | null
  performance_notes?: string | null
}

export interface DraftVoiceRule {
  type: 'banned_phrase' | 'banned_structure' | 'natural_element'
  content: string
}

export interface DraftTarget {
  platform: string
  handle: string
  tier?: string | null
  why?: string | null
  strategy?: string | null
}

export interface DraftAlgorithmRule {
  platform: string
  signal: string
  weight: string
  description: string
}

export interface DraftReply {
  platform: string
  category: string
  text: string
}

export interface DraftMemory {
  type: string
  platform?: string | null
  title: string
  content: string
  data_json?: string | null
}

export interface DraftMilestone {
  platform: string
  metric: string
  value: string
  note?: string | null
}

/**
 * Deletions are recorded per table using each table's natural key, exactly the
 * keys the production delete tools match on. Applied last when merging and
 * re-verified against live rows at commit time (Plan 12).
 */
export interface DraftDeletions {
  hooks: string[]
  pillars: string[]
  voice_rules: string[]
  targets: string[]
  algorithm_rules: string[]
}

export interface StrategyDraftDocument {
  version: typeof STRATEGY_DRAFT_DOC_VERSION
  profileStrategyFields: Partial<Record<StrategyProfileField, string>>
  pillars: DraftPillar[]
  hooks: DraftHook[]
  voiceRules: DraftVoiceRule[]
  targets: DraftTarget[]
  algorithmRules: DraftAlgorithmRule[]
  replies: DraftReply[]
  memories: DraftMemory[]
  milestones: DraftMilestone[]
  deletions: DraftDeletions
  starterDrafts: unknown[]
  proposedNextAction?: { text: string; rationale?: string }
}

export function createEmptyDraftDocument(): StrategyDraftDocument {
  return {
    version: STRATEGY_DRAFT_DOC_VERSION,
    profileStrategyFields: {},
    pillars: [],
    hooks: [],
    voiceRules: [],
    targets: [],
    algorithmRules: [],
    replies: [],
    memories: [],
    milestones: [],
    deletions: { hooks: [], pillars: [], voice_rules: [], targets: [], algorithm_rules: [] },
    starterDrafts: [],
  }
}

/**
 * Defensive second layer against credential-shaped keys injected anywhere in
 * the document. Deliberately does NOT match bare `name` — hooks and pillars
 * legitimately carry one. Profile identity fields are excluded by the strict
 * whitelist in sanitizeProfileStrategyFields instead.
 */
const FORBIDDEN_FIELD_PATTERN = /api[_-]?key|credential|secret|token|password|cookie|authorization|bearer|twitter[_-]?handle|reddit[_-]?username|timezone/i

export function sanitizeProfileStrategyFields(
  input: Record<string, unknown> | undefined | null,
): Partial<Record<StrategyProfileField, string>> {
  const out: Partial<Record<StrategyProfileField, string>> = {}
  if (!input) return out
  for (const field of STRATEGY_PROFILE_FIELDS) {
    const value = input[field]
    if (typeof value === 'string') out[field] = value
  }
  return out
}

/** Defensive second layer — even a bug in sanitize cannot leak these keys. */
function scrubForbidden(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(item => scrubForbidden(item, depth + 1))
  if (typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN_FIELD_PATTERN.test(key) ? '[redacted]' : scrubForbidden(item, depth + 1)
  }
  return out
}

/**
 * Draft storage must preserve full strategy text (multi-KB markdown). Unlike
 * `redactForCheckpoint` (500-char cap for ephemeral checkpoints), drafts keep
 * complete content — only secret-shaped keys are scrubbed. Collections are
 * still size-bounded so a runaway agent cannot grow the document unbounded.
 */
const MAX_DRAFT_COLLECTION_ITEMS = 50
const MAX_DRAFT_DELETION_KEYS = 50
const MAX_DRAFT_STARTER_DRAFTS = 10

function enforceDraftBounds(doc: StrategyDraftDocument): void {
  doc.pillars = doc.pillars.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.hooks = doc.hooks.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.voiceRules = doc.voiceRules.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.targets = doc.targets.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.algorithmRules = doc.algorithmRules.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.replies = doc.replies.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.memories = doc.memories.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.milestones = doc.milestones.slice(0, MAX_DRAFT_COLLECTION_ITEMS)
  doc.starterDrafts = doc.starterDrafts.slice(0, MAX_DRAFT_STARTER_DRAFTS)
  doc.deletions = {
    hooks: doc.deletions.hooks.slice(0, MAX_DRAFT_DELETION_KEYS),
    pillars: doc.deletions.pillars.slice(0, MAX_DRAFT_DELETION_KEYS),
    voice_rules: doc.deletions.voice_rules.slice(0, MAX_DRAFT_DELETION_KEYS),
    targets: doc.deletions.targets.slice(0, MAX_DRAFT_DELETION_KEYS),
    algorithm_rules: doc.deletions.algorithm_rules.slice(0, MAX_DRAFT_DELETION_KEYS),
  }
}

// ─── Natural keys (mirror the production upsert/delete tools) ───────────────
// Typed loosely on purpose: they must accept both draft items and raw SQLite
// rows coming out of getMergedCollections.

export const hookKey = (h: any): string => String(h?.name ?? '')
export const pillarKey = (p: any): string => String(p?.name ?? '')
export const voiceRuleKey = (v: any): string => `${String(v?.type ?? '')}\u0000${String(v?.content ?? '')}`
export const targetKey = (t: any): string => `${String(t?.platform ?? '')}\u0000${String(t?.handle ?? '')}`
export const algorithmKey = (a: any): string => `${String(a?.platform ?? '')}\u0000${String(a?.signal ?? '')}`

// ─── Base snapshot ───────────────────────────────────────────────────────────

export interface DraftBaseSnapshot {
  snapshotVersion: 1
  takenAt: string
  profile: Partial<Record<StrategyProfileField, string>>
  hooks: Record<string, unknown>[]
  content_pillars: Record<string, unknown>[]
  voice_rules: Record<string, unknown>[]
  target_accounts: Record<string, unknown>[]
  algorithm_rules: Record<string, unknown>[]
  replies: Record<string, unknown>[]
  memory_entries: Record<string, unknown>[]
  growth_milestones: Record<string, unknown>[]
}

const SNAPSHOT_TABLES = [
  ['hooks', 'SELECT * FROM hooks ORDER BY rank ASC'],
  ['content_pillars', 'SELECT * FROM content_pillars'],
  ['voice_rules', 'SELECT * FROM voice_rules'],
  ['target_accounts', 'SELECT * FROM target_accounts'],
  ['algorithm_rules', 'SELECT * FROM algorithm_rules'],
  ['replies', 'SELECT * FROM replies'],
  ['memory_entries', 'SELECT * FROM memory_entries'],
  ['growth_milestones', 'SELECT * FROM growth_milestones'],
] as const

export function takeBaseSnapshot(db: Database.Database): DraftBaseSnapshot {
  const profileRow = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as Record<string, unknown> | undefined
  const profile: Partial<Record<StrategyProfileField, string>> = {}
  for (const field of STRATEGY_PROFILE_FIELDS) {
    const value = profileRow?.[field]
    if (typeof value === 'string') profile[field] = value
  }

  const snapshot: DraftBaseSnapshot = {
    snapshotVersion: 1,
    takenAt: new Date().toISOString(),
    profile,
    hooks: [],
    content_pillars: [],
    voice_rules: [],
    target_accounts: [],
    algorithm_rules: [],
    replies: [],
    memory_entries: [],
    growth_milestones: [],
  }
  for (const [table, sql] of SNAPSHOT_TABLES) {
    ;(snapshot as any)[table] = db.prepare(sql).all()
  }
  return snapshot
}

// ─── Repository ──────────────────────────────────────────────────────────────

export interface StrategyDraftRow {
  run_id: string
  version: number
  status: StrategyDraftStatus
  base_snapshot_json: string
  draft_json: string
  validation_json: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  committed_at: string | null
}

export function getDraftRow(db: Database.Database, runId: string): StrategyDraftRow | null {
  const row = db.prepare('SELECT * FROM onboarding_strategy_drafts WHERE run_id = ?').get(runId) as StrategyDraftRow | undefined
  return row ?? null
}

export function getLatestStrategyRunId(db: Database.Database): string | null {
  const row = db.prepare(`
    SELECT run_id
    FROM onboarding_strategy_drafts
    WHERE status = 'committed'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() as { run_id: string } | undefined
  return row?.run_id ?? null
}

export function parseDraftDocument(row: StrategyDraftRow): StrategyDraftDocument {
  const parsed = JSON.parse(row.draft_json) as StrategyDraftDocument
  if (parsed?.version !== STRATEGY_DRAFT_DOC_VERSION) {
    throw new Error(`Unsupported strategy draft document version: ${(parsed as any)?.version}`)
  }
  // Re-sanitize on read: persisted state is untrusted input too.
  return {
    ...createEmptyDraftDocument(),
    ...parsed,
    profileStrategyFields: sanitizeProfileStrategyFields(parsed.profileStrategyFields),
    deletions: { ...createEmptyDraftDocument().deletions, ...(parsed.deletions ?? {}) },
  }
}

export function getBaseSnapshot(row: StrategyDraftRow): DraftBaseSnapshot {
  return JSON.parse(row.base_snapshot_json) as DraftBaseSnapshot
}

/**
 * Snapshot current active strategy state and open a fresh draft for this run.
 * Must be called BEFORE any agent strategy write. No-op when a usable draft
 * already exists (resume case); terminal drafts from prior runs are left alone.
 */
export function ensureDraftForRun(db: Database.Database, runId: string): StrategyDraftRow {
  const existing = getDraftRow(db, runId)
  if (existing && existing.status !== 'discarded') return existing

  const baseSnapshot = takeBaseSnapshot(db)
  db.prepare(`
    INSERT INTO onboarding_strategy_drafts (run_id, version, status, base_snapshot_json, draft_json)
    VALUES (?, 1, 'draft', ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      version = 1,
      status = 'draft',
      base_snapshot_json = excluded.base_snapshot_json,
      draft_json = excluded.draft_json,
      updated_at = datetime('now'),
      reviewed_at = NULL,
      committed_at = NULL
  `).run(runId, JSON.stringify(scrubForbidden(baseSnapshot)), JSON.stringify(scrubForbidden(createEmptyDraftDocument())))

  return getDraftRow(db, runId)!
}

/**
 * Mutate and persist the draft document atomically. Returns false when a newer
 * version already won (stale writer). Terminal drafts are immutable.
 */
export function updateDraft(
  db: Database.Database,
  runId: string,
  expectedVersion: number | null,
  mutate: (doc: StrategyDraftDocument) => void,
): boolean {
  const row = getDraftRow(db, runId)
  if (!row) throw new Error(`No strategy draft exists for run ${runId}`)
  if (row.status === 'committed' || row.status === 'discarded') {
    logger.warn('strategy-draft', `refusing mutation of ${row.status} draft for ${runId}`)
    return false
  }
  if (expectedVersion !== null && row.version !== expectedVersion) return false

  const doc = parseDraftDocument(row)
  mutate(doc)
  enforceDraftBounds(doc)

  const nextVersion = row.version + 1
  const result = db.prepare(`
    UPDATE onboarding_strategy_drafts SET
      version = ?,
      draft_json = ?,
      updated_at = datetime('now')
    WHERE run_id = ? AND version < ?
      AND status NOT IN ('committed', 'discarded')
  `).run(nextVersion, JSON.stringify(scrubForbidden(doc)), runId, nextVersion)

  if (result.changes === 0) {
    logger.warn('strategy-draft', `draft write for ${runId} rejected (version ${row.version} stale)`)
    return false
  }
  return true
}

export function setDraftStatus(db: Database.Database, runId: string, status: StrategyDraftStatus): boolean {
  const row = getDraftRow(db, runId)
  if (!row) return false
  const allowed: Record<StrategyDraftStatus, StrategyDraftStatus[]> = {
    draft: ['review', 'discarded'],
    review: ['committed', 'discarded'],
    committed: [],
    discarded: [],
  }
  if (!allowed[row.status].includes(status)) return false

  const reviewedAt = status === 'review' ? ", reviewed_at = datetime('now')" : ''
  const committedAt = status === 'committed' ? ", committed_at = datetime('now')" : ''
  db.prepare(`UPDATE onboarding_strategy_drafts SET status = ?, updated_at = datetime('now')${reviewedAt}${committedAt} WHERE run_id = ?`)
    .run(status, runId)
  return true
}

/**
 * Persist the validation outcome and move a finished draft into review.
 * Returns the fresh row so the caller knows the version users must approve.
 */
export function openDraftForReview(
  db: Database.Database,
  runId: string,
  validation: unknown,
): StrategyDraftRow | null {
  const row = getDraftRow(db, runId)
  if (!row || row.status !== 'draft') return getDraftRow(db, runId)
  db.prepare(`
    UPDATE onboarding_strategy_drafts SET
      status = 'review',
      validation_json = ?,
      reviewed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE run_id = ? AND status = 'draft'
  `).run(JSON.stringify(scrubForbidden(validation)), runId)
  return getDraftRow(db, runId)
}

// ─── Merged reads ────────────────────────────────────────────────────────────

type AnyRow = Record<string, any>

function upsertOverlay<T>(baseRows: T[], items: T[], keyOf: (item: T) => string): T[] {
  const merged = [...baseRows]
  for (const item of items) {
    const key = keyOf(item)
    const index = merged.findIndex(row => keyOf(row) === key)
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return merged
}

function applyDeletions<T>(rows: T[], deletedKeys: string[], keyOf: (item: T) => string): T[] {
  if (deletedKeys.length === 0) return rows
  const keys = new Set(deletedKeys)
  return rows.filter(row => !keys.has(keyOf(row)))
}

/**
 * Live overlay merge: active rows ⊕ draft upserts − recorded deletions.
 * Deterministic and stable within a run, so readiness validation stays pure.
 * Appended collections (replies/memories/milestones) are draft-only until commit.
 */
export function getMergedCollections(db: Database.Database, runId: string) {
  const row = getDraftRow(db, runId)
  const doc = row ? parseDraftDocument(row) : createEmptyDraftDocument()

  let hooks = applyDeletions(
    upsertOverlay(db.prepare('SELECT * FROM hooks ORDER BY rank ASC').all() as AnyRow[], doc.hooks as AnyRow[], r => hookKey(r)),
    doc.deletions.hooks,
    r => hookKey(r),
  )
  const pillars = applyDeletions(
    upsertOverlay(db.prepare('SELECT * FROM content_pillars').all() as AnyRow[], doc.pillars as AnyRow[], r => pillarKey(r)),
    doc.deletions.pillars,
    r => pillarKey(r),
  )
  const voiceRules = applyDeletions(
    upsertOverlay(db.prepare('SELECT * FROM voice_rules').all() as AnyRow[], doc.voiceRules as AnyRow[], r => voiceRuleKey(r)),
    doc.deletions.voice_rules,
    r => voiceRuleKey(r),
  )
  const targets = applyDeletions(
    upsertOverlay(db.prepare('SELECT * FROM target_accounts').all() as AnyRow[], doc.targets as AnyRow[], r => targetKey(r)),
    doc.deletions.targets,
    r => targetKey(r),
  )
  const algorithmRules = applyDeletions(
    upsertOverlay(db.prepare('SELECT * FROM algorithm_rules').all() as AnyRow[], doc.algorithmRules as AnyRow[], r => algorithmKey(r)),
    doc.deletions.algorithm_rules,
    r => algorithmKey(r),
  )

  // Filters applied after merge so reads behave like the active-table tools.
  hooks = [...hooks].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  return {
    hooks,
    pillars,
    voice_rules: voiceRules,
    target_accounts: targets,
    algorithm_rules: algorithmRules,
    replies: [
      ...(db.prepare('SELECT * FROM replies').all() as AnyRow[]),
      ...doc.replies as AnyRow[],
    ],
    memories: [
      ...(db.prepare('SELECT * FROM memory_entries ORDER BY created_at DESC').all() as AnyRow[]),
      ...doc.memories as AnyRow[],
    ],
    milestones: [
      ...(db.prepare('SELECT * FROM growth_milestones').all() as AnyRow[]),
      ...doc.milestones as AnyRow[],
    ],
    proposedNextAction: doc.proposedNextAction,
    starterDrafts: doc.starterDrafts,
  }
}

/** Growth strategy as readiness should see it: draft overlay over the profile. */
export function getMergedGrowthStrategy(db: Database.Database, runId: string): string | null {
  const row = getDraftRow(db, runId)
  const draftValue = row && row.status !== 'discarded'
    ? parseDraftDocument(row).profileStrategyFields.growth_strategy
    : undefined
  if (typeof draftValue === 'string' && draftValue.trim()) return draftValue
  const profileRow = db.prepare('SELECT growth_strategy FROM user_profile WHERE id = 1').get() as { growth_strategy?: string | null } | undefined
  return profileRow?.growth_strategy ?? null
}

// ─── Review-section scoping (Plan 12 regeneration) ───────────────────────────

export type ReviewSection = 'positioning' | 'audience' | 'voice' | 'pillars' | 'targets' | 'cadence'

type DraftCollectionKey = 'pillars' | 'hooks' | 'voiceRules' | 'targets' | 'algorithmRules' | 'replies' | 'memories' | 'milestones' | 'starterDrafts'
type DraftDeletionKey = keyof DraftDeletions

interface ReviewSectionScope {
  /** Profile strategy fields the section may rewrite. */
  profileFields: readonly StrategyProfileField[]
  /** Draft collections the section may rewrite. */
  collections: readonly DraftCollectionKey[]
  /** Recorded-deletion tables the section may rewrite. */
  deletionTables: readonly DraftDeletionKey[]
}

/**
 * Mirrors the review UI: each section owns exactly one primary surface. A
 * regeneration pass that touches anything else has its mutations discarded.
 */
export const REVIEW_SECTION_SCOPE: Readonly<Record<ReviewSection, ReviewSectionScope>> = {
  positioning: { profileFields: ['growth_strategy'], collections: [], deletionTables: [] },
  audience: { profileFields: ['target_audience'], collections: ['memories'], deletionTables: [] },
  voice: { profileFields: ['voice_description'], collections: ['voiceRules'], deletionTables: [] },
  pillars: { profileFields: [], collections: ['pillars'], deletionTables: ['pillars'] },
  targets: { profileFields: [], collections: ['targets'], deletionTables: ['targets'] },
  cadence: { profileFields: ['tone_balance'], collections: [], deletionTables: [] },
}

const ALL_COLLECTION_KEYS: readonly DraftCollectionKey[] = [
  'pillars', 'hooks', 'voiceRules', 'targets', 'algorithmRules', 'replies', 'memories', 'milestones', 'starterDrafts',
]

/**
 * Enforce section scoping after a regeneration pass: restore, in `doc`, every
 * part of `baseline` that the requested section does not own. Tool scoping and
 * prompt wording are defence in depth — this is the hard boundary that makes
 * "any mutation outside the requested section is discarded" literal.
 */
export function restoreOutOfScopeMutations(
  doc: StrategyDraftDocument,
  baseline: StrategyDraftDocument,
  section: ReviewSection,
): void {
  const scope = REVIEW_SECTION_SCOPE[section]
  // Unknown sections fail closed: everything outside a known scope is restored.
  const ownsField = (field: string) => scope?.profileFields.includes(field as StrategyProfileField) ?? false

  for (const key of Object.keys(doc.profileStrategyFields) as StrategyProfileField[]) {
    if (ownsField(key)) continue
    if (Object.prototype.hasOwnProperty.call(baseline.profileStrategyFields, key)) {
      doc.profileStrategyFields[key] = baseline.profileStrategyFields[key]
    } else {
      delete doc.profileStrategyFields[key]
    }
  }
  for (const [key, value] of Object.entries(baseline.profileStrategyFields) as [StrategyProfileField, string][]) {
    if (!ownsField(key) && !Object.prototype.hasOwnProperty.call(doc.profileStrategyFields, key)) {
      doc.profileStrategyFields[key] = value
    }
  }

  for (const key of ALL_COLLECTION_KEYS) {
    if (scope?.collections.includes(key)) continue
    ;(doc as any)[key] = (baseline as any)[key]
  }

  for (const table of Object.keys(doc.deletions) as DraftDeletionKey[]) {
    if (scope?.deletionTables.includes(table)) continue
    doc.deletions[table] = [...baseline.deletions[table]]
  }

  doc.proposedNextAction = baseline.proposedNextAction
}
