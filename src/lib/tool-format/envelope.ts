// Tolerant accessors and formatting primitives shared by every layer.
// Leaf module: imports nothing else in this directory.

type AnyRecord = Record<string, any>

export function isRecord(v: any): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalizes any tool result into a CliResult-like view. */
export function envelopeOf(result: any): { ok: boolean | null; data: any; error?: string } {
  if (result === null || result === undefined) return { ok: null, data: undefined };
  if (Array.isArray(result)) return { ok: true, data: result };
  if (typeof result === "string") return { ok: true, data: result };
  if (isRecord(result)) {
    const err = typeof result.error === "string" ? result.error : undefined;
    if (typeof result.ok === "boolean") return { ok: result.ok, data: result.data ?? null, error: err };
    // Local DB tools never set `ok`; success flag or bare payload implies success.
    if (err !== undefined) return { ok: false, data: result.data ?? null, error: err };
    return { ok: true, data: result };
  }
  return { ok: true, data: result };
}

/** Items array from listing payloads (data | data.data | data.children). */
export function itemsOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.children)) return data.children.map((c: any) => (isRecord(c) && c.data ? c.data : c));
  }
  return [];
}

/**
 * True when a completed result actually failed. Interactive outcomes
 * ({error, status}) are soft failures — the phrase layer renders those.
 */
export function isFailedResult(result: any): boolean {
  const env = envelopeOf(result);
  if (env.ok === false) {
    // ask_user / ask_user_questions cancellations carry a `status` field.
    return !(isRecord(result) && typeof result.status === "string");
  }
  if (isRecord(result) && result.success === false) return true;
  return false;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function shortError(error: unknown, cap = 64): string | undefined {
  let s: string | undefined;
  if (typeof error === "string") s = error;
  else if (isRecord(error) && typeof error.message === "string") s = error.message;
  else if (error != null) s = String(error);
  s = s?.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}

export function countNoun(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatClock(iso: unknown): string | undefined {
  if (typeof iso !== "string" || !iso.trim()) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return truncate(iso.trim(), 20);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

export function fmtBytes(n: unknown): string | undefined {
  if (typeof n !== "number" || !isFinite(n) || n < 0) return undefined;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function handleOf(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return `@${v.trim().replace(/^@/, "")}`;
}

export function subOf(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return `r/${v.trim().replace(/^r\//i, "")}`;
}

export function shortId(v: unknown, keep = 8): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  let s = v.trim();
  const status = s.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
  if (status) s = status[1];
  s = s.replace(/^t[13]_/, "");
  return s.length > keep ? `…${s.slice(-keep)}` : s;
}

export function quoteQuery(q: unknown): string | undefined {
  if (typeof q !== "string" || !q.trim()) return undefined;
  const t = q.trim();
  return /\s/.test(t) ? `“${truncate(t, 30)}”` : truncate(t, 32);
}

/** Depth-limited search for a Twitter-style user object inside CLI data. */
export function findHandle(value: any, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  if (typeof value === "string") {
    return /^@[A-Za-z0-9_]{1,20}$/.test(value.trim()) ? value.trim() : undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = value.username ?? value.screenName ?? value.handle;
  if (typeof direct === "string" && direct.trim()) return handleOf(direct);
  for (const child of Object.values(value)) {
    const found = findHandle(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** First array found under common reply/comment keys. */
export function repliesArrayOf(data: any): any[] | undefined {
  if (!isRecord(data)) return undefined;
  for (const key of ["replies", "comments", "children"]) {
    const arr = data[key];
    if (Array.isArray(arr)) return arr.map((c: any) => (isRecord(c) && c.data ? c.data : c));
    if (isRecord(arr) && Array.isArray(arr.data)) return arr.data;
  }
  return undefined;
}

export function numericField(record: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "number" && isFinite(v)) return v;
  }
  return undefined;
}
