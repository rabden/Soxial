// Args chip: the small pill subtitle shown while a call runs.
import {
  countNoun,
  formatClock,
  handleOf,
  isRecord,
  quoteQuery,
  shortId,
  subOf,
  truncate,
} from "./envelope";
import {
  DELETE_ARG_KEYS,
  HANDLE_TOOLS,
  LOCAL_READ_NOUNS,
  PROFILE_TOOLS,
  SAVE_NOUNS,
} from "./families";

export function joinParts(parts: (string | undefined)[], cap = 48): string | undefined {
  const parts_ = parts.filter((p): p is string => Boolean(p?.trim()));
  if (parts_.length === 0) return undefined;
  return truncate(parts_.join(" · "), cap);
}

export function toolArgsChip(name: string, args: any): string | undefined {
  const a = isRecord(args) ? args : {};

  switch (name) {
    case "twitter_search":
      return joinParts([quoteQuery(a.query), a.type, a.since || a.until]);
    case "reddit_search":
      return joinParts([subOf(a.subreddit), quoteQuery(a.query), a.sort]);
    case "twitter_tweet":
    case "twitter_article":
    case "twitter_list":
    case "twitter_like":
    case "twitter_retweet":
    case "twitter_delete":
    case "reddit_read":
    case "reddit_upvote":
    case "reddit_save":
      return shortId(a.tweet_id ?? a.post_id ?? a.list_id);
    case "twitter_post":
    case "twitter_quote":
      return typeof (a.text ?? a.content) === "string" ? truncate((a.text ?? a.content).trim(), 40) : undefined;
    case "twitter_reply":
      return typeof (a.text ?? a.reply) === "string" ? truncate((a.text ?? a.reply).trim(), 40) : undefined;
    case "twitter_bookmark":
      return a.action === "list" ? undefined : shortId(a.tweet_id);
    case "reddit_comment":
      return typeof (a.text ?? a.reply) === "string" ? truncate((a.text ?? a.reply).trim(), 40) : undefined;
    case "reddit_subscribe":
      return subOf(a.subreddit);
    case "generate_image":
      return typeof a.filename === "string" ? truncate(a.filename, 32) : undefined;
    case "schedule_post":
      return joinParts([typeof a.platform === "string" ? a.platform : undefined, formatClock(a.scheduled_time)]);
    case "ask_user":
      return typeof a.text === "string" ? truncate(a.text.replace(/\s+/g, " ").trim(), 44) : undefined;
    case "ask_user_questions":
      return Array.isArray(a.questions) ? countNoun(a.questions.length, "question", "questions") : undefined;
    case "record_onboarding_gap":
      return typeof a.artifact === "string" ? a.artifact.replace(/_/g, " ") : undefined;
    case "read_workflow_guide":
      return typeof a.guide === "string" ? truncate(a.guide.replace(/-/g, " "), 32) : undefined;
    case "run_subagent":
      return joinParts(
        [
          typeof a.kind === "string" ? a.kind.replace(/-/g, " ") : undefined,
          typeof a.task === "string" ? truncate(a.task.replace(/\s+/g, " ").trim(), 28) : undefined,
        ],
        48,
      );
    case "get_subagent_output":
    case "cancel_subagent":
      return shortId(a.runId);
    case "update_soxial_profile":
      return isRecord(a.data) ? countNoun(Object.keys(a.data).length, "field", "fields") : undefined;
    default:
      break;
  }

  if (HANDLE_TOOLS.has(name) || PROFILE_TOOLS.has(name)) return handleOf(a.handle ?? a.username);

  if (name === "reddit_sub" || name === "reddit_sub_info") return subOf(a.subreddit);

  if (SAVE_NOUNS[name]) {
    return Array.isArray(a.items) ? countNoun(a.items.length, "item", "items") : undefined;
  }
  const deleteKey = DELETE_ARG_KEYS[name];
  if (deleteKey) {
    return Array.isArray(a[deleteKey]) ? countNoun(a[deleteKey].length, "entry", "entries") : undefined;
  }

  // Local table reads: summarize active filters (platform/category/type/tier).
  if (LOCAL_READ_NOUNS[name] || name === "read_profile") {
    const filters = [
      typeof a.platform === "string" && a.platform !== "all" ? a.platform : undefined,
      subOf(a.subreddit),
      handleOf(a.author_handle),
      typeof a.category === "string" && a.category !== "all" ? a.category : undefined,
      typeof a.tier === "string" && a.tier !== "all" ? a.tier : undefined,
    ].filter(Boolean) as string[];
    return joinParts(filters);
  }

  if (name === "inspect_image_url") {
    try {
      return typeof a.url === "string" ? new URL(a.url).hostname : undefined;
    } catch {
      return undefined;
    }
  }

  // Generic fallback: first meaningful scalar field.
  for (const key of ["query", "text", "prompt", "url", "name"]) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) return truncate(v.trim(), 48);
  }
  return undefined;
}
