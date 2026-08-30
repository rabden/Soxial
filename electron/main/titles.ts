// Session title lifecycle (spec #65, ticket #67).
//
// Owner decisions baked in: the fallback lands instantly at send-time, AI
// titles run on the session's selected chat model, the title regenerates
// after the first turn completes, refreshes at real-user turns 3 and 6
// (grok-build cadence), then freezes — and manual renames always win
// (write-once, SQL-guarded in db.updateChatSessionTitleSmart).

export const TITLE_REFRESH_TURNS = [1, 3, 6] as const

export interface TitleMeta {
  kind: 'fallback' | 'ai' | 'manual' | null
  turn: number
}

export const TITLE_SYSTEM_PROMPT =
  'You generate short, distinctive conversation titles. Reply with the title only: 3-8 words, no quotes, no trailing punctuation, no explanation.'

/** Instant placeholder: first ≤6 whitespace words of the first user message. */
export function fallbackTitleFromText(text: string): string {
  const words = (text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'New chat'
  return words.slice(0, 6).join(' ').slice(0, 80)
}

/** Normalize a raw model title: first non-empty line, quotes stripped, ≤80 chars. */
export function cleanTitle(raw: string): string | null {
  const line = (raw || '').split('\n').map((l) => l.trim()).find(Boolean)
  if (!line) return null
  const stripped = line.replace(/^["'\u201c\u201d'']+|["'\u201c\u201d'']+$/g, '').trim()
  if (!stripped) return null
  return stripped.slice(0, 80)
}

/** Should an AI (re)generation run now, given the stored meta and the
 * completed real-user turn count? Manual renames freeze the lifecycle; the
 * watermark (meta.turn) keeps refresh points from re-running, while `>=`
 * comparison lets a missed point (failed run) self-heal at the next turn. */
export function shouldRegenerateTitle(meta: TitleMeta | null, userCount: number): boolean {
  if (meta?.kind === 'manual') return false
  const lastTurn = meta?.turn ?? 0
  return TITLE_REFRESH_TURNS.some((t) => userCount >= t && lastTurn < t)
}

/** Concurrent pass (runs during the first turn): title from the first user message. */
export function buildFirstMessageTitlePrompt(firstUserContent: string): string {
  return `A conversation starts with this message. Generate its title.\n\n${(firstUserContent || '').slice(0, 2000)}`
}

/** Post-turn pass (turns 1, 3, 6): title from the conversation so far. */
export function buildConversationTitlePrompt(digest: string): string {
  return `Generate a title capturing what this conversation is about:\n\n${digest}`
}
