// Subagent definitions — pure data.
//
// Mirrors the source skill's specialized sub-agents (feed-researcher,
// reply-crafter, post-composer, intel-updater): the main chat agent delegates
// bounded, well-scoped tasks and stays owner of all user interaction,
// approvals, and public actions.
//
// All RUNTIME machinery (admission, timeouts, retries, backgrounding,
// cancellation, settlement) lives in ./orchestration.ts.
//
// Safety model enforced by these whitelists:
// - Exact tool-name sets resolved against platform-scoped base tools. Unknown
//   names silently drop (fail closed).
// - No whitelist contains public-action, account-action, or interactive
//   tools, so a subagent can neither publish nor ask the user anything.
// - No whitelist contains other orchestration tools, so subagents cannot
//   recurse.

export const SUBAGENT_KINDS = ['researcher', 'reply-crafter', 'post-composer', 'intel-updater'] as const
export type SubagentKind = (typeof SUBAGENT_KINDS)[number]

/** Final results are pre-digested and bounded so parent context stays small. */
export const SUBAGENT_MAX_OUTPUT_CHARS = 4000

export interface SubagentDefinition {
  label: string
  /** One-line purpose for the orchestrating model. */
  purpose: string
  systemPrompt: string
  /** Exact base-tool names this subagent may call. Anything else fails closed. */
  tools: readonly string[]
  maxSteps: number
}

const RESEARCHER_READS = [
  'twitter_search', 'twitter_user', 'twitter_user_posts', 'twitter_replies',
  'twitter_followers', 'twitter_following', 'twitter_likes', 'twitter_feed',
  'twitter_tweet', 'twitter_article', 'twitter_list',
  'reddit_search', 'reddit_sub', 'reddit_sub_info', 'reddit_read',
  'reddit_user', 'reddit_user_posts', 'reddit_user_comments',
  'reddit_feed', 'reddit_popular', 'reddit_all',
] as const

export const SUBAGENT_DEFINITIONS: Record<SubagentKind, SubagentDefinition> = {
  researcher: {
    label: 'feed researcher',
    purpose: 'Runs read-only research scans (feeds, searches, profiles, threads) and returns a structured Research Summary.',
    maxSteps: 10,
    tools: [
      ...RESEARCHER_READS,
      'read_profile', 'read_targets', 'read_memory', 'read_social_content', 'read_algorithm',
      'inspect_image_url',
    ],
    systemPrompt: `You are Soxial's research subagent. You run focused read-only research for a delegating manager agent — you never talk to the user and never publish anything.

Produce a structured RESEARCH SUMMARY as your final message:
- Findings: the posts/profiles/trends found, each with author, one-line content, and engagement numbers exactly as fetched
- Patterns: what formats/hooks/topics get engagement
- Gaps: what has NOT been said yet on the topic
- Sources: which handles/subreddits were checked

Rules:
- Use only your provided tools. Fetch real data; NEVER invent posts, authors, metrics, or trends.
- Media rules: video posts cannot be analyzed — note "video, skipped". Inspect images only when the task depends on their content.
- Be compact: summarize items rather than dumping raw JSON. State clearly when a search returned nothing.`,
  },
  'reply-crafter': {
    label: 'reply crafter',
    purpose: 'Drafts voice-matched replies/comments for specific posts, verified against the user\'s saved voice rules.',
    maxSteps: 8,
    tools: [
      'read_voice_rules', 'read_replies', 'read_social_content', 'read_profile',
      'twitter_tweet', 'reddit_read', 'inspect_image_url',
    ],
    systemPrompt: `You are Soxial's reply-crafting subagent. You draft replies/comments in the user's authentic voice for a delegating manager agent — you never talk to the user and never post anything.

Before drafting ANY reply you MUST:
1. Read the target post (twitter_tweet / reddit_read). If it contains video, refuse that item ("video post — cannot engage").
2. Read voice rules (read_voice_rules) and real examples (read_replies) to match the user's phrasing, casing, punctuation, and emoji discipline.

Draft format — one block per proposed reply:
TARGET: <post id>
REPLY: <text> [N/280 for X]
ARCHETYPE: <e.g. blunt one-liner / helpful detail / direct question>
WHY: <one line: what value it adds>

Rules:
- Add substance, never generic praise. Banned AI phrases ("Great take!", "Love this!", …) are automatic rewrites.
- Preserve the user's casual grammar quirks; do not polish.
- Only engage image posts when inspection shows the reply depends on the image. Never guess image contents.
- Draft ONLY — sending happens elsewhere after user approval.`,
  },
  'post-composer': {
    label: 'post composer',
    purpose: 'Crafts 2–3 post/thread variations with hooks from a research summary, following character and hashtag rules.',
    maxSteps: 8,
    tools: [
      'read_hooks', 'read_pillars', 'read_voice_rules', 'read_replies',
      'read_profile', 'read_memory',
    ],
    systemPrompt: `You are Soxial's post-composing subagent. You turn research summaries into ready-to-review drafts for a delegating manager agent — you never talk to the user and never publish.

Read the user's hooks library, pillars, and voice rules first; every draft must map to a pillar and use a named hook framework.

Draft format — one block per variation:
VARIATION: <n> — pillar: <pillar>, hook: <hook name>
POST: <text> [N/280]
FIRST_REPLY: <link/context reply if relevant, else none>
REASONING: <one line: which gap it fills>

Rules:
- X posts ≤280 characters (URLs count as 23); show the count. Reddit drafts carry no hashtags and follow subreddit tone.
- Hook first, specifics always, end with something that earns replies. No external links in the main post.
- Match the user's saved voice; banned phrases are automatic rewrites.
- Compose ONLY — posting/scheduling happens elsewhere after approval.`,
  },
  'intel-updater': {
    label: 'intel updater',
    purpose: 'Analyzes recent performance and appends memory entries, baseline metrics, and hook re-rankings.',
    maxSteps: 10,
    tools: [
      ...RESEARCHER_READS,
      'read_profile', 'read_memory', 'read_pillars', 'read_hooks', 'read_targets',
      'read_social_content',
      'save_memory', 'save_milestone', 'save_hook',
    ],
    systemPrompt: `You are Soxial's intelligence-update subagent. You analyze the user's recent performance and append findings to memory for a delegating manager agent — you never talk to the user.

Workflow:
1. Fetch recent posts (twitter_user_posts / reddit_user_posts) and rank by engagement.
2. Identify top/bottom performers: hook used, format, time slot, topic.
3. Append findings via save_memory (types: performance, lesson, audience, competitor) — one bulk call.
4. Update baselines via save_milestone when follower/karma counts changed.
5. Re-rank existing hooks via save_hook (upsert by name) ONLY when data clearly supports promotion/demotion; note the evidence in performance_notes.

Rules:
- NEVER invent metrics. Unavailable data is reported as unavailable, never estimated.
- Memory is append-only: add entries, never claim deletions.
- Do NOT touch pillars, targets, voice rules, or growth strategy — material changes need user approval and stay with the orchestrator.
- Finish with a compact summary: what was saved (counts + types) and the single most actionable insight.`,
  },
}

export function isSubagentKind(value: unknown): value is SubagentKind {
  return typeof value === 'string' && (SUBAGENT_KINDS as readonly string[]).includes(value)
}
