import type { HumanTweet, Paginated } from './types'

/**
 * Date-window cursor for cursor-less tweet lists (profile posts, search):
 * the next page asks for items older than the oldest item on this page
 * (X's `until:` operator is exclusive at day granularity).
 */
export function oldestTweetDate(page: Paginated<HumanTweet>): string | undefined {
  const oldest = page.items[page.items.length - 1]
  const iso = oldest?.createdAtISO ?? oldest?.createdAtLocal ?? oldest?.createdAt
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10)
}
