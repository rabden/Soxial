// Settled-header summary line: activity rollup for the collapsed trace.
import {
  countNoun,
  envelopeOf,
  fmtCompact,
  formatClock,
  handleOf,
  isFailedResult,
  isRecord,
  itemsOf,
  quoteQuery,
  shortId,
  subOf,
} from "./envelope";
import {
  ACTION_VERBS,
  DELETE_ARG_KEYS,
  HANDLE_TOOLS,
  LISTING_NOUNS,
  LOCAL_READ_NOUNS,
  NOISE_TOOLS,
  PROFILE_TOOLS,
  SAVE_NOUNS,
  actionPhrase,
} from "./families";
import { getToolLabel } from "../tool-labels";

interface Activity {
  key: string;
  text: string;
  bucket: "posts" | "replies" | "profiles" | "reads" | "writes" | "engagements" | "questions" | "images";
  /** Items affected (for rollup sums); falls back to 1 call. */
  weight?: number;
}

function searchActivity(name: string, args: any): Activity {
  const a = isRecord(args) ? args : {};
  if (name === "twitter_search") {
    const q = quoteQuery(a.query);
    return { key: `twitter_search|${q ?? ""}`, text: q ? `Searched X for ${q}` : "Searched X", bucket: "posts" };
  }
  const sub = subOf(a.subreddit);
  const q = quoteQuery(a.query);
  const text = sub ? `Searched ${sub}` : q ? `Searched Reddit for ${q}` : "Searched Reddit";
  return { key: `reddit_search|${sub ?? q ?? ""}`, text, bucket: "posts" };
}

function fetchWeight(name: string, result: any): number | undefined {
  const env = envelopeOf(result);
  if (env.ok === false) return 1;
  const items = itemsOf(env.data);
  return items.length > 0 ? items.length : 1;
}

function activityFor(name: string, args: any, result: any, callOrdinal = 0): Activity | undefined {
  const a = isRecord(args) ? args : {};
  const env = envelopeOf(result);

  if (name === "twitter_search" || name === "reddit_search") {
    return { ...searchActivity(name, args), weight: fetchWeight(name, result) };
  }

  if (HANDLE_TOOLS.has(name) || PROFILE_TOOLS.has(name)) {
    const handle = handleOf(a.handle ?? a.username);
    const what =
      name === "twitter_user_posts" ? "posts"
      : name === "reddit_user_posts" ? "posts"
      : name === "twitter_replies" ? "replies"
      : name === "reddit_user_comments" ? "comments"
      : name === "twitter_followers" ? "followers"
      : name === "twitter_following" ? "following"
      : name === "twitter_likes" ? "likes"
      : "profile";
    const text = handle ? `Read ${handle}'s ${what}` : `Read ${what}`;
    const bucket =
      what === "profile" || what === "followers" || what === "following"
        ? "profiles"
        : what === "replies" || what === "comments"
          ? "replies"
          : "posts";
    return { key: `${name}|${handle ?? ""}`, text, bucket, weight: fetchWeight(name, result) };
  }

  switch (name) {
    case "twitter_feed":
      return { key: name, text: "Scanned X home feed", bucket: "posts", weight: fetchWeight(name, result) };
    case "reddit_feed":
      return { key: name, text: "Scanned Reddit feed", bucket: "posts", weight: fetchWeight(name, result) };
    case "reddit_popular":
      return { key: name, text: "Scanned Reddit popular", bucket: "posts", weight: fetchWeight(name, result) };
    case "reddit_all":
      return { key: name, text: "Scanned r/all", bucket: "posts", weight: fetchWeight(name, result) };
    case "reddit_saved":
      return { key: name, text: "Reviewed saved posts", bucket: "posts", weight: fetchWeight(name, result) };
    case "reddit_upvoted":
      return { key: name, text: "Reviewed upvoted posts", bucket: "posts", weight: fetchWeight(name, result) };
    case "twitter_bookmark":
      return a.action === "list"
        ? { key: name, text: "Reviewed bookmarks", bucket: "posts", weight: fetchWeight(name, result) }
        : { key: `${name}|${shortId(a.tweet_id)}`, text: actionPhrase(name, args, env), bucket: "engagements" };
    case "twitter_list":
      return { key: `${name}|${shortId(a.list_id)}`, text: "Read an X list", bucket: "posts", weight: fetchWeight(name, result) };
    case "twitter_likes":
      return { key: `${name}|${handleOf(a.handle) ?? ""}`, text: "Reviewed liked posts", bucket: "posts", weight: fetchWeight(name, result) };
    case "twitter_tweet":
    case "reddit_read":
      return { key: `${name}|${shortId(a.tweet_id ?? a.post_id)}`, text: "Read a post + replies", bucket: "posts", weight: 1 };
    case "twitter_article":
      return { key: `${name}|${shortId(a.tweet_id)}`, text: "Read an X article", bucket: "posts", weight: 1 };
    case "reddit_sub_info":
      return { key: `${name}|${subOf(a.subreddit) ?? ""}`, text: `Read ${subOf(a.subreddit) ?? "subreddit"} info`, bucket: "profiles" };
    case "generate_image":
      return { key: `${name}|${a.filename ?? ""}`, text: `Generated ${typeof a.filename === "string" ? a.filename : "image"}`, bucket: "images" };
    case "inspect_image_url":
      return { key: `${name}|${a.url ?? ""}`, text: "Inspected an image", bucket: "images" };
    case "schedule_post":
      return { key: name, text: `Scheduled post · ${formatClock(a.scheduled_time) ?? "queued"}`, bucket: "writes" };
    case "ask_user":
      return { key: name, text: "Asked you a question", bucket: "questions", weight: 1 };
    case "ask_user_questions":
      return {
        key: name,
        text: `Asked you ${Array.isArray(a.questions) ? a.questions.length : "some"} questions`,
        bucket: "questions",
        weight: Array.isArray(a.questions) ? a.questions.length : 1,
      };
    case "record_onboarding_gap":
      return { key: name, text: "Recorded a data gap", bucket: "questions" };
    case "record_evidence_assessment":
      return { key: name, text: "Assessed evidence confidence", bucket: "questions" };
    case "read_workflow_guide":
      return {
        key: `${name}|${typeof a.guide === "string" ? a.guide : ""}`,
        text: `Loaded ${typeof a.guide === "string" ? a.guide.replace(/-/g, " ") : "playbook"} playbook`,
        bucket: "reads",
      };
    case "run_subagent": {
      const kind = typeof a.kind === "string" ? a.kind : "";
      // Ordinal in the key: repeated delegations of the same kind must stay
      // distinct so the rollup counts each run.
      return {
        key: `${name}|${kind}-${callOrdinal}`,
        text: kind === "intel-updater" ? "Ran intelligence update" : `Delegated to ${kind.replace(/-/g, " ") || "specialist"}`,
        bucket: "reads",
      };
    }
    default:
      break;
  }

  if (LISTING_NOUNS[name]) {
    return { key: name, text: "Scanned posts", bucket: "posts", weight: fetchWeight(name, result) };
  }

  if (LOCAL_READ_NOUNS[name]) {
    const noun = LOCAL_READ_NOUNS[name];
    return { key: name, text: `Read ${noun}`, bucket: "reads" };
  }
  if (name === "read_profile") return { key: name, text: "Read app profile", bucket: "reads" };

  if (SAVE_NOUNS[name] || DELETE_ARG_KEYS[name]) {
    const r = isRecord(result) ? result : {};
    const isDelete = Boolean(DELETE_ARG_KEYS[name]);
    const noun = SAVE_NOUNS[name] ?? "entries";
    let text: string;
    let affected = 1;
    if (typeof r.deleted === "number") {
      text =
        noun === "entries"
          ? `Deleted ${countNoun(r.deleted, "entry", "entries")}`
          : `Deleted ${r.deleted} ${noun}`;
      affected = r.deleted;
    } else if (typeof r.saved === "number" || typeof r.count === "number") {
      const n = (typeof r.saved === "number" ? r.saved : r.count) ?? 0;
      text = `Saved ${n} ${noun}`;
      affected = n;
    } else if (typeof r.updated === "number" && r.updated > 0) {
      text = `Updated ${r.updated} ${noun}`;
      affected = r.updated;
    } else {
      // No counters yet (call still running or unexpected shape).
      text = isDelete ? "Deleted entries" : `Wrote ${noun}`;
    }
    return { key: `${name}|${text}`, text, bucket: "writes", weight: Math.max(affected, 1) };
  }
  if (name === "update_soxial_profile") {
    return { key: name, text: "Updated app profile", bucket: "writes", weight: 1 };
  }

  if (ACTION_VERBS[name]) {
    const text = actionPhrase(name, args, env);
    // Ordinal, not content-slice: engagements carry no weight and the rollup
    // counts distinct keys, so identical-text posts must stay key-distinct.
    if (name === "twitter_post" || name === "twitter_quote") return { key: `${name}|post-${callOrdinal}`, text, bucket: "engagements" };
    return { key: `${name}|${shortId(a.tweet_id ?? a.post_id) ?? text}`, text, bucket: "engagements" };
  }

  return { key: name, text: getToolLabel(name), bucket: "reads" };
}

export interface TraceSummary {
  /** Ordered phrases joined with "·" for the settled header. Empty when nothing worth saying. */
  phrases: string[];
  failedCount: number;
}

const MAX_LISTED_ACTIVITIES = 4;
const MAX_HEADER_CHARS = 120;

/**
 * Builds the collapsed-trace summary: explicit activity phrases for small
 * traces, category rollup ("Scanned 42 posts · Read 6 profiles") when many
 * distinct tools ran. Reasoning becomes the leading "Thought N times".
 */
export function summarizeTrace(nodes: Array<{ type?: string; toolName?: string; status?: string; args?: any; result?: any }>): TraceSummary {
  const phrases: string[] = [];
  const tools = nodes.filter((n) => n.type === "tool" && typeof n.toolName === "string");

  let reasoningCount = 0;
  for (const node of nodes) if (node.type === "reasoning") reasoningCount++;
  if (reasoningCount > 0) {
    phrases.push(reasoningCount === 1 ? "Thought once" : `Thought ${reasoningCount} times`);
  }

  let failedCount = 0;
  const activities: Activity[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const name = tool.toolName!;
    if (isFailedResult(tool.result)) failedCount++;
    if (NOISE_TOOLS.has(name)) continue;
    const activity = activityFor(name, tool.args, tool.result, i);
    if (!activity || seen.has(activity.key)) continue;
    seen.add(activity.key);
    activities.push(activity);
  }

  if (activities.length > 0 && activities.length <= MAX_LISTED_ACTIVITIES) {
    phrases.push(...activities.map((a) => a.text));
  } else if (activities.length > MAX_LISTED_ACTIVITIES) {
    const sums: Record<string, { count: number; weighted: number }> = {};
    const order: Activity["bucket"][] = [];
    for (const activity of activities) {
      if (!sums[activity.bucket]) {
        sums[activity.bucket] = { count: 0, weighted: 0 };
        order.push(activity.bucket);
      }
      sums[activity.bucket].count += 1;
      sums[activity.bucket].weighted += activity.weight ?? 1;
    }
    const BUCKET_TEXT: Record<string, (s: { count: number; weighted: number }) => string> = {
      posts: (s) => `Scanned ${fmtCompact(s.weighted)} posts`,
      replies: (s) => `Read ${fmtCompact(s.weighted)} replies & comments`,
      profiles: (s) => `Read ${s.count} profiles`,
      reads: () => "Read strategy library",
      writes: (s) =>
        s.weighted === 1
          ? "Saved 1 strategy entry"
          : `Saved ${fmtCompact(s.weighted)} strategy entries`,
      engagements: (s) => `Engaged ${s.count} ${s.count === 1 ? "time" : "times"}`,
      questions: (s) => `Asked you ${s.weighted} ${s.weighted === 1 ? "question" : "questions"}`,
      images: (s) => `Generated ${s.count} ${s.count === 1 ? "image" : "images"}`,
    };
    for (const bucket of order) {
      const render = BUCKET_TEXT[bucket];
      if (render) phrases.push(render(sums[bucket]));
    }
  }

  // Keep the settled header scannable.
  let used = 0;
  let chars = 0;
  for (const phrase of phrases) {
    chars += phrase.length + 3;
    if (chars > MAX_HEADER_CHARS) break;
    used++;
  }
  const minPhrases = Math.min(phrases.length, reasoningCount > 0 ? 2 : 3);
  const kept = phrases.slice(0, Math.max(used, minPhrases));
  if (kept.length < phrases.length) kept.push(`+${phrases.length - kept.length} more`);

  return { phrases: kept, failedCount };
}
