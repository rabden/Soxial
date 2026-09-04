// Stationarity guard, ported from the grok-build turn loop.
//
// grok-build counts identical tool-call runs inside one turn: past a soft
// threshold it injects a nudge system-reminder; past a hard threshold it ends
// the turn as `TurnOutcome::StationarityEnded` instead of burning the step
// budget on a doom loop. Read-only tool kinds get tighter thresholds because
// repeating them is never progress.
//
// The tracker is pure state + pure decisions so it is unit-testable without a
// model. The agent loop feeds it every tool-call part and asks for the verdict.

export const STATIONARITY_DEFAULTS = {
  /** Identical calls allowed before a nudge is injected. */
  nudgeThreshold: 6,
  /** Identical calls allowed before the run is stopped outright. */
  stopThreshold: 10,
  /** Tighter budgets for read-only repetition (grok-build's Read/Plan tier). */
  readOnlyNudgeThreshold: 4,
  readOnlyStopThreshold: 6,
} as const

export type StationarityVerdict =
  | { action: 'allow' }
  | { action: 'nudge'; repeats: number }
  | { action: 'stop'; repeats: number }

/** Tools where identical repetition can never make progress (paginated-style reads aside). */
const READ_ONLY_TOOLS = new Set([
  'read_profile', 'read_hooks', 'read_voice_rules', 'read_pillars', 'read_algorithm',
  'read_targets', 'read_replies', 'read_social_content', 'read_memory',
  'get_scheduled_posts', 'read_image_guide', 'inspect_image_url', 'read_workflow_guide',
  'twitter_status', 'twitter_whoami', 'twitter_search', 'twitter_user',
  'twitter_user_posts', 'twitter_replies', 'twitter_followers', 'twitter_following',
  'twitter_likes', 'twitter_feed', 'twitter_tweet', 'twitter_article', 'twitter_list',
  'reddit_search', 'reddit_sub', 'reddit_read', 'reddit_user_posts',
  'reddit_user_comments', 'reddit_login', 'reddit_whoami', 'reddit_feed',
  'reddit_sub_info', 'reddit_popular', 'reddit_all', 'reddit_saved', 'reddit_upvoted',
  'reddit_user', 'get_subagent_output',
])

export interface StationarityOptions {
  nudgeThreshold?: number
  stopThreshold?: number
  readOnlyNudgeThreshold?: number
  readOnlyStopThreshold?: number
}

/**
 * Stable signature for a tool call. Key order is normalized so
 * `{a,b}` and `{b,a}` count as the same call.
 */
export function toolCallSignature(toolName: string, args: unknown): string {
  return `${toolName}::${stableStringify(args)}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export class StationarityTracker {
  private lastSignature: string | null = null
  private repeats = 0
  private readonly opts: Required<StationarityOptions>

  constructor(options: StationarityOptions = {}) {
    this.opts = {
      nudgeThreshold: options.nudgeThreshold ?? STATIONARITY_DEFAULTS.nudgeThreshold,
      stopThreshold: options.stopThreshold ?? STATIONARITY_DEFAULTS.stopThreshold,
      readOnlyNudgeThreshold: options.readOnlyNudgeThreshold ?? STATIONARITY_DEFAULTS.readOnlyNudgeThreshold,
      readOnlyStopThreshold: options.readOnlyStopThreshold ?? STATIONARITY_DEFAULTS.readOnlyStopThreshold,
    }
  }

  /**
   * Record one executed tool call and get the verdict for it.
   * Distinct calls reset the run — only CONSECUTIVE identical calls count.
   */
  record(toolName: string, args: unknown): StationarityVerdict {
    const signature = toolCallSignature(toolName, args)
    if (signature === this.lastSignature) {
      this.repeats += 1
    } else {
      this.lastSignature = signature
      this.repeats = 1
    }

    const readOnly = READ_ONLY_TOOLS.has(toolName)
    const nudgeAt = readOnly ? this.opts.readOnlyNudgeThreshold : this.opts.nudgeThreshold
    const stopAt = readOnly ? this.opts.readOnlyStopThreshold : this.opts.stopThreshold

    if (this.repeats >= stopAt) return { action: 'stop', repeats: this.repeats }
    if (this.repeats >= nudgeAt) return { action: 'nudge', repeats: this.repeats }
    return { action: 'allow' }
  }
}
