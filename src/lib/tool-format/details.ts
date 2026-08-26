// Expanded pill details: compacted args + result rows for the pill body.
import {
  countNoun,
  envelopeOf,
  findHandle,
  fmtCompact,
  formatClock,
  isRecord,
  itemsOf,
  numericField,
  repliesArrayOf,
  shortError,
  truncate,
} from "./envelope";

export interface ToolDetailRow {
  label: string;
  value: string;
  tone?: "error";
}

/** Args shown most useful first; long free-text sinks to the bottom. */
const DETAIL_KEY_PRIORITY = [
  "query", "type", "sort", "subreddit", "handle", "username", "author_handle",
  "tweet_id", "post_id", "list_id", "url", "action", "platform",
  "scheduled_time", "limit", "max", "model", "filename",
  "by_name", "by_content", "by_handle", "by_signal", "items", "questions",
  "text", "content", "reply", "answer", "prompt", "data",
];

function humanizeKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function detailValue(key: string, v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) return undefined;
    if (key === "scheduled_time") return formatClock(t) ?? truncate(t, 40);
    if ((key === "handle" || key === "username" || key === "author_handle") && !t.startsWith("@")) {
      return `@${truncate(t, 40)}`;
    }
    if (key === "subreddit" && !/^r\//i.test(t)) return `r/${truncate(t, 40)}`;
    return truncate(t, 160);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    if (v.every((x) => typeof x === "string" || typeof x === "number")) {
      return truncate(v.join(", "), 120);
    }
    return countNoun(v.length, "item", "items");
  }
  if (isRecord(v)) return countNoun(Object.keys(v).length, "field", "fields");
  return truncate(String(v), 80);
}

const MAX_ARG_ROWS = 6;

function argsRows(args: any): ToolDetailRow[] {
  const a = isRecord(args) ? args : {};
  const rank = (k: string) => {
    const i = DETAIL_KEY_PRIORITY.indexOf(k);
    return i === -1 ? DETAIL_KEY_PRIORITY.length : i;
  };
  const pairs = Object.keys(a)
    .map((key) => ({ key, value: detailValue(key, a[key]) }))
    .filter((p): p is { key: string; value: string } => p.value !== undefined)
    .sort((x, y) => rank(x.key) - rank(y.key));
  if (pairs.length === 0) return [];
  const rows: ToolDetailRow[] = pairs.slice(0, MAX_ARG_ROWS).map((p) => ({
    label: humanizeKey(p.key),
    value: p.value,
  }));
  if (pairs.length > MAX_ARG_ROWS) {
    rows.push({ label: "+", value: `${pairs.length - MAX_ARG_ROWS} more fields` });
  }
  return rows;
}

function detailText(item: any): string | undefined {
  if (!isRecord(item)) return undefined;
  for (const key of ["text", "title", "name", "hook", "selftext", "body", "content", "rule", "signal", "example", "description"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return truncate(v.replace(/\s+/g, " ").trim(), 90);
  }
  return undefined;
}

/** One compact preview line for a listing item: who · what · reach. */
function itemLine(item: any): string {
  if (item === null || item === undefined) return "—";
  if (!isRecord(item)) return truncate(String(item), 90);
  const parts: string[] = [];
  const handle = findHandle(item);
  if (handle) parts.push(handle);
  const text = detailText(item);
  if (text) parts.push(text);
  const likes = numericField(item, ["likes", "like_count", "favorite_count", "score", "ups"]);
  if (likes !== undefined) parts.push(`♥ ${fmtCompact(likes)}`);
  const replies = numericField(item, ["replies", "reply_count", "comments", "num_comments"]);
  if (replies !== undefined) parts.push(`↩ ${fmtCompact(replies)}`);
  if (parts.length === 0) {
    const id = item.id ?? item.tweet_id ?? item.post_id;
    return id !== undefined ? `#${String(id).slice(-12)}` : "item";
  }
  return truncate(parts.join(" · "), 140);
}

const MAX_RESULT_ROWS = 6;

function resultRows(name: string, result: any): ToolDetailRow[] {
  if (result === null || result === undefined) return [];
  const env = envelopeOf(result);

  if (env.ok === false || (isRecord(result) && result.success === false)) {
    const r = isRecord(result) ? result : {};
    const err = shortError(r.error ?? r.message ?? env.error, 280) ?? "Failed";
    return [{ label: "Error", value: err, tone: "error" }];
  }

  // ask_user / ask_user_questions outcomes.
  if (isRecord(result) && typeof result.status === "string") {
    const rows: ToolDetailRow[] = [{ label: "Status", value: result.status }];
    const answer = detailValue("answer", result.answer);
    if (answer) rows.push({ label: "Answer", value: answer });
    return rows;
  }

  // generate_image receipt.
  if (name === "generate_image" && isRecord(result) && typeof result.path === "string") {
    const rows: ToolDetailRow[] = [{ label: "Saved to", value: truncate(result.path, 200) }];
    if (typeof result.backend === "string") rows.push({ label: "Backend", value: result.backend });
    if (typeof result.filename === "string") rows.push({ label: "File", value: result.filename });
    return rows;
  }

  const items = itemsOf(env.data);
  if (items.length > 0) {
    const rows: ToolDetailRow[] = items.slice(0, MAX_RESULT_ROWS).map((item, i) => ({
      label: String(i + 1),
      value: itemLine(item),
    }));
    if (items.length > MAX_RESULT_ROWS) rows.push({ label: "+", value: `${items.length - MAX_RESULT_ROWS} more` });
    return rows;
  }

  const replies = repliesArrayOf(env.data);
  if (replies && replies.length > 0) {
    const rows: ToolDetailRow[] = [];
    const mainText = detailText(isRecord(env.data) ? (env.data.tweet ?? env.data.post ?? env.data) : undefined);
    if (mainText) rows.push({ label: "Post", value: mainText });
    rows.push(...replies.slice(0, MAX_RESULT_ROWS).map((item, i) => ({ label: `R${i + 1}`, value: itemLine(item) })));
    if (replies.length > MAX_RESULT_ROWS) rows.push({ label: "+", value: `${replies.length - MAX_RESULT_ROWS} more replies` });
    return rows;
  }

  if (typeof env.data === "string") {
    const t = env.data.replace(/\s+/g, " ").trim();
    return t ? [{ label: "Result", value: truncate(t, 240) }] : [{ label: "Result", value: "Done" }];
  }

  if (isRecord(env.data)) {
    const d = env.data;
    // Write receipts ({saved, updated, skipped, ...}).
    const counters = ["saved", "updated", "skipped", "deleted", "count"]
      .filter((k) => typeof d[k] === "number")
      .map((k) => ({ label: humanizeKey(k), value: String(d[k]) }));
    if (counters.length > 0) {
      if (typeof d.message === "string" && d.message.trim()) {
        counters.push({ label: "Message", value: truncate(d.message.replace(/\s+/g, " ").trim(), 160) });
      }
      return counters;
    }
    // Profile payloads.
    const handle = findHandle(d);
    if (handle) {
      const rows: ToolDetailRow[] = [{ label: "Profile", value: handle }];
      if (typeof d.name === "string" && d.name.trim()) rows.push({ label: "Name", value: truncate(d.name.trim(), 80) });
      const bio = typeof d.description === "string" ? d.description : typeof d.bio === "string" ? d.bio : undefined;
      if (bio?.trim()) rows.push({ label: "Bio", value: truncate(bio.replace(/\s+/g, " ").trim(), 180) });
      for (const k of ["followers", "following", "tweets"]) {
        if (typeof d[k] === "number") rows.push({ label: humanizeKey(k), value: fmtCompact(d[k]) });
      }
      if (typeof d.verified === "boolean") rows.push({ label: "Verified", value: String(d.verified) });
      return rows;
    }
    // Flat scalar records → readable key/value pairs, never raw JSON.
    const pairs = Object.keys(d)
      .map((key) => ({ key, value: detailValue(key, d[key]) }))
      .filter((p): p is { key: string; value: string } => p.value !== undefined);
    if (pairs.length > 0) {
      const rows: ToolDetailRow[] = pairs.slice(0, MAX_RESULT_ROWS).map((p) => ({
        label: humanizeKey(p.key),
        value: p.value,
      }));
      if (pairs.length > MAX_RESULT_ROWS) rows.push({ label: "+", value: `${pairs.length - MAX_RESULT_ROWS} more fields` });
      return rows;
    }
    if (typeof d.message === "string" && d.message.trim()) {
      return [{ label: "Result", value: truncate(d.message.replace(/\s+/g, " ").trim(), 240) }];
    }
    return [{ label: "Result", value: "Done" }];
  }

  return [{ label: "Result", value: "Done" }];
}

/**
 * Compacted, human-readable rows for the expanded pill body: the args that
 * mattered plus a digest of the result (item previews, counters, errors).
 * Never raw JSON.
 */
export function toolDetails(name: string, args: any, result: any): ToolDetailRow[] {
  return [...argsRows(args), ...resultRows(name, result)].slice(0, 12);
}
