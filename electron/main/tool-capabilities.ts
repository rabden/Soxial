// Capability classification for every agent tool.
//
// Onboarding safety is enforced here, not in the system prompt. A model that
// ignores prompt restrictions still cannot reach a public or account-changing
// tool, because those tools are never handed to the onboarding agent.
//
// Unclassified tools are denied by default: a newly added tool must be
// explicitly classified before it can appear in a restricted tool set.

export type ToolCapability =
  | 'read'
  | 'strategy-write'
  | 'local-draft'
  | 'public-action'
  | 'account-action'
  | 'interactive'
  /**
   * Spawns a nested agent run. Chat-only: excluded from every restricted set,
   * because onboarding/enrichment budgets assume single bounded runs and a
   * subagent whitelisting bug must never widen their surface.
   */
  | 'orchestration'

/** Capabilities that never mutate the user's public presence or accounts. */
export const SAFE_CAPABILITIES: ReadonlySet<ToolCapability> = new Set<ToolCapability>([
  'read',
  'strategy-write',
  'local-draft',
  'interactive',
])

/** Capabilities that require explicit user approval and are banned in onboarding. */
export const MUTATING_CAPABILITIES: ReadonlySet<ToolCapability> = new Set<ToolCapability>([
  'public-action',
  'account-action',
])

/**
 * The Plan 13 enrichment boundary: strictly reads and strategy writes. Unlike
 * SAFE_CAPABILITIES this also excludes local-draft and interactive tools, so
 * the background enrichment agent can never generate media or ask questions.
 */
export const ENRICHMENT_CAPABILITIES: ReadonlySet<ToolCapability> = new Set<ToolCapability>([
  'read',
  'strategy-write',
])

export const TOOL_CAPABILITIES: Readonly<Record<string, ToolCapability>> = {
  // ── Profile & strategy ────────────────────────────────────────────────────
  read_profile: 'read',
  update_soxial_profile: 'strategy-write',
  read_hooks: 'read',
  save_hook: 'strategy-write',
  read_voice_rules: 'read',
  save_voice_rule: 'strategy-write',
  read_pillars: 'read',
  save_pillar: 'strategy-write',
  read_algorithm: 'read',
  save_algorithm_rule: 'strategy-write',
  read_targets: 'read',
  save_target: 'strategy-write',
  read_replies: 'read',
  save_reply: 'strategy-write',
  read_social_content: 'read',
  read_memory: 'read',
  save_memory: 'strategy-write',
  save_milestone: 'strategy-write',
  delete_hooks: 'strategy-write',
  delete_pillars: 'strategy-write',
  delete_voice_rules: 'strategy-write',
  delete_targets: 'strategy-write',
  delete_algorithm_rules: 'strategy-write',

  // ── Scheduling & media ────────────────────────────────────────────────────
  // schedule_post queues a real public post, so it is an action, not a draft.
  schedule_post: 'public-action',
  get_scheduled_posts: 'read',
  read_image_guide: 'read',
  inspect_image_url: 'read',
  generate_image: 'local-draft',

  // ── Interactive ───────────────────────────────────────────────────────────
  ask_user: 'interactive',
  ask_user_questions: 'interactive',
  record_onboarding_gap: 'strategy-write',
  record_evidence_assessment: 'strategy-write',

  // ── Orchestration (chat-only; never granted to restricted sets) ──────────
  run_subagent: 'orchestration',

  // ── Reference loading ─────────────────────────────────────────────────────
  read_workflow_guide: 'read',

  // ── X / Twitter ───────────────────────────────────────────────────────────
  twitter_status: 'read',
  twitter_whoami: 'read',
  twitter_search: 'read',
  twitter_user: 'read',
  twitter_user_posts: 'read',
  twitter_replies: 'read',
  twitter_followers: 'read',
  twitter_following: 'read',
  twitter_likes: 'read',
  twitter_feed: 'read',
  twitter_tweet: 'read',
  twitter_article: 'read',
  twitter_list: 'read',
  twitter_post: 'public-action',
  twitter_reply: 'public-action',
  twitter_quote: 'public-action',
  twitter_retweet: 'public-action',
  twitter_delete: 'public-action',
  twitter_like: 'account-action',
  twitter_follow: 'account-action',
  // Mixed read/write surface (list vs save/remove) — classified by its
  // strongest effect so it can never be granted to a restricted agent.
  twitter_bookmark: 'account-action',

  // ── Reddit ────────────────────────────────────────────────────────────────
  reddit_search: 'read',
  reddit_sub: 'read',
  reddit_read: 'read',
  reddit_user_posts: 'read',
  reddit_user_comments: 'read',
  reddit_login: 'read',
  reddit_whoami: 'read',
  reddit_feed: 'read',
  reddit_sub_info: 'read',
  reddit_popular: 'read',
  reddit_all: 'read',
  reddit_saved: 'read',
  reddit_upvoted: 'read',
  reddit_user: 'read',
  reddit_comment: 'public-action',
  reddit_upvote: 'account-action',
  reddit_save: 'account-action',
  reddit_subscribe: 'account-action',
}

export function getToolCapability(name: string): ToolCapability | null {
  return Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, name)
    ? TOOL_CAPABILITIES[name]
    : null
}

export function isMutatingTool(name: string): boolean {
  const capability = getToolCapability(name)
  // Unknown tools are treated as mutating so they cannot leak into onboarding.
  if (!capability) return true
  return MUTATING_CAPABILITIES.has(capability)
}

/**
 * Keep only tools whose capability is in `allowed`. Tools missing from the
 * capability registry are always dropped (default deny).
 */
export function filterToolsByCapability<T extends Record<string, unknown>>(
  tools: T,
  allowed: ReadonlySet<ToolCapability>,
): Partial<T> {
  const filtered: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const capability = getToolCapability(name)
    if (!capability || !allowed.has(capability)) continue
    filtered[name] = tool
  }
  return filtered as Partial<T>
}

/** Tool names that are known but intentionally withheld from a filtered set. */
export function listDeniedTools(
  tools: Record<string, unknown>,
  allowed: ReadonlySet<ToolCapability>,
): string[] {
  return Object.keys(tools).filter(name => {
    const capability = getToolCapability(name)
    return !capability || !allowed.has(capability)
  })
}
