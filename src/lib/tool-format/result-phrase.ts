// Result phrase: the pill subtitle once the call completes, plus the
// completed chip combining target → outcome.
import {
  countNoun,
  envelopeOf,
  findHandle,
  fmtBytes,
  fmtCompact,
  formatClock,
  isFailedResult,
  isRecord,
  itemsOf,
  numericField,
  repliesArrayOf,
  shortError,
} from "./envelope";
import {
  ACTION_VERBS,
  COMBINE_TARGET,
  DELETE_ARG_KEYS,
  LISTING_NOUNS,
  LOCAL_READ_NOUNS,
  NOISE_TOOLS,
  SAVE_NOUNS,
  actionPhrase,
  hasMedia,
} from "./families";
import { joinParts, toolArgsChip } from "./args-chip";

function listingPhrase(name: string, env: ReturnType<typeof envelopeOf>): string {
  if (env.ok === false) return shortError(env.error) ?? "Failed";
  const items = itemsOf(env.data);
  if (items.length === 0) return "No results";
  const [singular, plural] = LISTING_NOUNS[name] ?? ["result", "results"];
  let text = countNoun(items.length, singular, plural);
  const mediaCount = items.filter(hasMedia).length;
  if (mediaCount > 0) text += ` · ${mediaCount} w/ media`;
  return text;
}

function profilePhrase(env: ReturnType<typeof envelopeOf>, fallback: string): string {
  if (env.ok === false) return shortError(env.error) ?? "Failed";
  return findHandle(env.data) ?? fallback;
}

function localRowsPhrase(name: string, env: ReturnType<typeof envelopeOf>): string {
  if (env.ok === false) return shortError(env.error) ?? "Failed";
  if (name === "read_profile") return "Loaded";
  const noun = LOCAL_READ_NOUNS[name] ?? "rows";
  if (Array.isArray(env.data)) return env.data.length === 0 ? "Empty" : countNoun(env.data.length, noun.replace(/s$/, ""), noun);
  // summary_only counts object ({twitter:{post:n,...}, ...})
  if (isRecord(env.data)) {
    let total = 0;
    for (const v of Object.values(env.data)) {
      if (typeof v === "number") total += v;
      else if (isRecord(v)) for (const inner of Object.values(v)) if (typeof inner === "number") total += inner;
    }
    return total === 0 ? "Archive empty" : countNoun(total, "archived item", "archived items");
  }
  return "Done";
}

function writePhrase(result: any): string {
  const r = isRecord(result) ? result : {};
  if (r.success === false) return shortError(r.error) ?? "Failed";
  const parts: string[] = [];
  if (typeof r.saved === "number" && r.saved > 0) parts.push(`Saved ${r.saved}`);
  if (typeof r.updated === "number" && r.updated > 0) parts.push(`Updated ${r.updated}`);
  if (typeof r.skipped === "number" && r.skipped > 0) parts.push(`Skipped ${r.skipped}`);
  if (typeof r.deleted === "number" && r.deleted > 0) parts.push(`Deleted ${r.deleted}`);
  if (parts.length === 0 && typeof r.count === "number") parts.push(`Saved ${r.count}`);
  if (parts.length === 0) {
    const msg = shortError(r.message, 32);
    return msg ?? "Done";
  }
  return parts.join(" · ");
}

export function toolResultPhrase(name: string, args: any, result: any): string {
  const env = envelopeOf(result);
  if (env.ok === false && !(isRecord(result) && typeof result.status === "string")) {
    return shortError(env.error) ?? "Failed";
  }

  switch (name) {
    case "twitter_status":
    case "twitter_whoami":
    case "reddit_login":
      return profilePhrase(env, "Connected");
    case "reddit_whoami":
      return profilePhrase(env, "Connected");
    case "twitter_user":
      return profilePhrase(env, "Profile loaded");
    case "reddit_user":
      return profilePhrase(env, "Profile loaded");
    case "twitter_tweet": {
      if (env.ok === false) return shortError(env.error) ?? "Failed";
      const replies = repliesArrayOf(env.data);
      return replies ? `Post + ${countNoun(replies.length, "reply", "replies")}` : "Post loaded";
    }
    case "reddit_read": {
      if (env.ok === false) return shortError(env.error) ?? "Failed";
      const comments = repliesArrayOf(env.data);
      return comments ? `Post + ${countNoun(comments.length, "comment", "comments")}` : "Post loaded";
    }
    case "twitter_article":
      return env.ok === false ? (shortError(env.error) ?? "Failed") : "Article loaded";
    case "reddit_sub_info": {
      if (env.ok === false) return shortError(env.error) ?? "Failed";
      const top = isRecord(env.data) ? env.data : {};
      const nested = isRecord(top.data) ? top.data : {};
      const subscribers =
        numericField(top, ["subscribers", "subscriber_count", "members", "active_user_count"]) ??
        numericField(nested, ["subscribers", "subscriber_count", "members", "active_user_count"]);
      return subscribers !== undefined ? `${fmtCompact(subscribers)} members` : "Subreddit info";
    }
    case "generate_image": {
      const r = isRecord(result) ? result : {};
      return r.success === false || typeof r.error === "string" ? (shortError(r.error) ?? "Failed") : "Image saved";
    }
    case "inspect_image_url": {
      const r = isRecord(result) ? result : {};
      if (typeof r.error === "string") return shortError(r.error) ?? "Failed";
      const size = fmtBytes(r.byteLength);
      const mime = typeof r.mimeType === "string" ? r.mimeType.split("/")[1]?.toUpperCase() : undefined;
      return joinParts([mime, size], 24) ?? "Image loaded";
    }
    case "schedule_post": {
      const r = isRecord(result) ? result : {};
      if (r.success === false) return shortError(r.error) ?? "Failed";
      const time = formatClock(typeof r.message === "string" ? r.message.replace(/^.*?\bfor\s+/i, "").trim() : undefined)
        ?? formatClock(isRecord(args) ? args.scheduled_time : undefined);
      return time ? `Scheduled ${time}` : "Scheduled";
    }
    case "ask_user": {
      const r = isRecord(result) ? result : {};
      if (r.answer !== undefined) return "Answered";
      if (r.status === "timeout") return "No answer";
      if (r.status === "cancelled") return "Cancelled";
      return shortError(r.error) ?? "Answered";
    }
    case "ask_user_questions": {
      const r = isRecord(result) ? result : {};
      if (Array.isArray(r.answers)) return `All ${r.answers.length} answered`;
      if (r.status === "timeout") return "No answer";
      if (r.status === "cancelled") return "Cancelled";
      return shortError(r.error) ?? "Answered";
    }
    case "record_onboarding_gap":
      return isRecord(result) && result.success ? "Gap recorded" : "Failed";
    case "record_evidence_assessment":
      return isRecord(result) && result.success ? "Assessment recorded" : "Failed";
    default:
      break;
  }

  if (LISTING_NOUNS[name]) return listingPhrase(name, env);
  if (LOCAL_READ_NOUNS[name]) return localRowsPhrase(name, env);
  if (SAVE_NOUNS[name] || DELETE_ARG_KEYS[name] || name === "update_soxial_profile") return writePhrase(result);
  if (ACTION_VERBS[name]) return actionPhrase(name, args, env);
  if (NOISE_TOOLS.has(name)) return env.ok === false ? (shortError(env.error) ?? "Failed") : "Connected";

  // Unknown tool: generic envelope summary.
  if (env.ok === false) return shortError(env.error) ?? "Failed";
  const items = itemsOf(env.data);
  if (items.length > 0) return countNoun(items.length, "item", "items");
  return "Done";
}

export function toolCompletedChip(name: string, args: any, result: any): string | undefined {
  if (isFailedResult(result)) {
    const r = isRecord(result) ? result : {};
    return shortError(r.error ?? r.message) ?? "Failed";
  }
  const phrase = toolResultPhrase(name, args, result);
  if (!COMBINE_TARGET.has(name)) return phrase;
  const target = toolArgsChip(name, args);
  if (!target) return phrase;
  const combined = `${target} → ${phrase}`;
  return combined.length <= 64 ? combined : phrase;
}
