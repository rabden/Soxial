// Subagent orchestration for the chat agent.
//
// Mirrors the source skill's specialized sub-agents (feed-researcher,
// reply-crafter, post-composer, intel-updater): the main chat agent delegates
// bounded, well-scoped tasks and stays owner of all user interaction,
// approvals, and public actions.
//
// Safety model:
// - Whitelists are EXACT tool-name sets resolved against the platform-scoped
//   base tools. Unknown names silently drop (fail closed).
// - No whitelist contains public-action, account-action, or interactive
//   tools, so a subagent can neither publish nor ask the user anything.
// - No whitelist contains other orchestration tools, so subagents cannot
//   recurse.
// - Nested runAgent calls receive no sessionId, so chat step persistence is
//   never clobbered, and share the parent's AbortController so stopping the
//   conversation stops delegated work.

import { z } from 'zod'
import { runAgent } from './agent'
import { createTools } from './tools'
import { logger } from './log'

export const SUBAGENT_KINDS = ['researcher', 'reply-crafter', 'post-composer', 'intel-updater'] as const
export type SubagentKind = (typeof SUBAGENT_KINDS)[number]

/** Final results are pre-digested and bounded so parent context stays small. */
export const SUBAGENT_MAX_OUTPUT_CHARS = 4000

interface SubagentDefinition {
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

function buildTaskMessage(definition: SubagentDefinition, task: string, context?: string): string {
  return [
    `TASK: ${task.trim()}`,
    context?.trim() ? `\nCONTEXT FROM ORCHESTRATOR:\n${context.trim()}` : '',
    '\nComplete this task with your tools, then produce your final structured output.',
  ].filter(Boolean).join('\n')
}

export interface SubagentResult {
  ok: boolean
  kind: SubagentKind
  /** Pre-digested final output, bounded to SUBAGENT_MAX_OUTPUT_CHARS. */
  summary: string
  error?: string
}

function boundOutput(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > SUBAGENT_MAX_OUTPUT_CHARS
    ? `${trimmed.slice(0, SUBAGENT_MAX_OUTPUT_CHARS)}…[truncated]`
    : trimmed
}

export interface CreateSubagentToolOptions {
  platforms?: { twitter?: boolean; reddit?: boolean }
  /** Parent run's controller: stopping the chat stops delegated work. */
  abortController?: AbortController
}

/**
 * Execute one subagent run. Exported separately from the tool wrapper so tests
 * can exercise resolution/bounding logic without a model.
 */
export async function executeSubagent(
  input: { kind: SubagentKind; task: string; context?: string },
  options: CreateSubagentToolOptions = {},
): Promise<SubagentResult> {
  if (!isSubagentKind(input.kind)) {
    return { ok: false, kind: 'researcher', summary: '', error: `Unknown subagent kind: ${String(input.kind)}` }
  }
  if (!input.task || !input.task.trim()) {
    return { ok: false, kind: input.kind, summary: '', error: 'Subagent task must not be empty.' }
  }

  const definition = SUBAGENT_DEFINITIONS[input.kind]
  const base = createTools({ platforms: options.platforms }) as Record<string, any>

  // Fail closed: names outside the registry's whitelist (or unavailable for
  // the connected platforms) simply do not resolve into the override map.
  const tools: Record<string, any> = {}
  for (const name of definition.tools) {
    if (base[name]) tools[name] = base[name]
  }

  logger.info('subagents', `running ${input.kind} (${Object.keys(tools).length} tools, maxSteps ${definition.maxSteps}): ${input.task.slice(0, 80)}`)

  const outcome = await new Promise<{ text: string; error?: string }>(resolve => {
    runAgent({
      messages: [{ role: 'user', content: buildTaskMessage(definition, input.task, input.context) }] as any,
      onDone: text => resolve({ text }),
      onError: error => resolve({ text: '', error }),
      options: { maxSteps: definition.maxSteps },
      toolsOverride: tools,
      systemPromptOverride: definition.systemPrompt,
      abortController: options.abortController,
    })
  })

  if (outcome.error) {
    logger.warn('subagents', `${input.kind} failed: ${outcome.error}`)
    return { ok: false, kind: input.kind, summary: '', error: outcome.error }
  }
  if (options.abortController?.signal.aborted) {
    return { ok: false, kind: input.kind, summary: boundOutput(outcome.text), error: 'cancelled' }
  }
  if (!outcome.text || !outcome.text.trim()) {
    return { ok: false, kind: input.kind, summary: '', error: 'Subagent finished without producing output.' }
  }

  return { ok: true, kind: input.kind, summary: boundOutput(outcome.text) }
}

/** Zod schema shared by the run_subagent tool wrapper. */
export const subagentInputSchema = z.object({
  kind: z.enum(SUBAGENT_KINDS).describe('Which specialist to run.'),
  task: z.string().min(1).describe('Precise, self-contained instruction for the subagent. It cannot see this conversation — include post IDs, topic keywords, subreddit/handle names, and exactly what output you need.'),
  context: z.string().optional().describe('Optional supporting material (e.g. a research summary for the composer, prior findings for the intel updater).'),
})
