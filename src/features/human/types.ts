import type { AppError } from '../../types/app-error'

export type Mode = 'agent' | 'human'

export type HumanTab = 'feed' | 'profile' | 'bookmarks' | 'follow' | 'search'

export type HumanProfileSubTab = 'posts' | 'replies'

export type HumanFollowSubTab = 'following' | 'followers'

/**
 * The connector's own hard cap (`rateLimit.maxCount`, config.py). Count-growth
 * surfaces (bookmarks, follow lists) grow toward it, then stop. Shared by the
 * main-process clamp and the renderer growth math so they cannot drift.
 */
export const HUMAN_LIST_HARD_CAP = 200

/* ------------------------------------------------------------------ *
 * Connector data contract (full/non-compact twitter-cli output).
 * See plans/twitter-cli-contract.md §3–§4.                            *
 * ------------------------------------------------------------------ */

export interface HumanTweetAuthor {
  screenName: string
  name: string
  verified?: boolean
  profileImageUrl?: string
}

export interface HumanQuotedTweet {
  id: string
  text: string
  author?: { screenName: string; name: string; profileImageUrl?: string; verified?: boolean }
  media?: Array<{ type: string; url: string; width?: number; height?: number }>
  urls?: string[]
  createdAtISO?: string
  createdAt?: string
  createdAtLocal?: string
}

/** Full-mode tweet object from the connector (count keys under `metrics.*`). */
export interface HumanTweet {
  id: string
  text: string
  author?: HumanTweetAuthor | string
  metrics?: Partial<
    Record<'likes' | 'retweets' | 'replies' | 'quotes' | 'views' | 'bookmarks', number>
  >
  createdAt?: string
  createdAtLocal?: string
  createdAtISO?: string
  media?: Array<{ type: string; url: string; width?: number; height?: number }>
  urls?: string[]
  isRetweet?: boolean
  retweetedBy?: string | null
  quotedTweet?: HumanQuotedTweet | null
  lang?: string
  /** Present on Profile Posts — the pinned tweet lands first (X convention). */
  pinned?: boolean
  /** Viewer state: the signed-in user already liked/retweeted this tweet. */
  liked?: boolean
  retweeted?: boolean
}

/** Full-mode user object (count keys `followers`/`following`/`tweets`). */
export interface HumanUser {
  id?: string
  screenName: string
  name: string
  bio?: string
  location?: string
  url?: string
  followers?: number
  following?: number
  tweets?: number
  likes?: number
  verified?: boolean
  profileImageUrl?: string
  createdAt?: string
  createdAtISO?: string
}

export interface Paginated<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

/** Uniform IPC result every Human handler returns. */
export type HumanResult<T> = { ok: true; data: T } | { ok: false; error: AppError }

export type HumanFeedType = 'for-you' | 'following'

export interface HumanFeedRequest {
  type?: HumanFeedType
  count?: number
  cursor?: string
}

export interface HumanSessionUser {
  screenName: string
  name?: string
  profileImageUrl?: string
}

export type HumanSessionResult = HumanResult<{ authenticated: boolean; user: HumanSessionUser | null }>

/* ------------------------------------------------------------------ *
 * Sub-tab request contracts (T4–T7).                                  *
 * ------------------------------------------------------------------ */

export interface HumanProfilePostsRequest {
  subTab: HumanProfileSubTab
  count?: number
  /** ISO date; deeper pages request items older than the last seen. */
  until?: string
}

export interface HumanBookmarksRequest {
  count?: number
}

export interface HumanFollowListRequest {
  subTab: HumanFollowSubTab
  count?: number
}

export interface HumanSearchRequest {
  query: string
  product?: 'Top' | 'Latest' | 'Photos' | 'Videos'
  count?: number
  until?: string
  from?: string
  to?: string
  lang?: string
  since?: string
  has?: Array<'links' | 'images' | 'videos' | 'media'>
  exclude?: Array<'retweets' | 'replies' | 'links'>
  minLikes?: number
  minRetweets?: number
}

export type HumanFollowActionResult = HumanResult<{ handle: string; following: boolean }>

/* ------------------------------------------------------------------ *
 * One-shot AI reply drafting (Human composer).                        *
 * ------------------------------------------------------------------ */

/** Media item as seen by the drafter — connector/attachment types normalized. */
export interface HumanReplyDraftMediaItem {
  /** 'photo' | 'video' | 'animated_gif' | 'gif' | 'link' (gif aliases animated_gif). */
  type: string
  url: string
}

export interface HumanReplyDraftRequest {
  tweetId: string
  authorHandle?: string
  authorName?: string
  content?: string
  /** Native attachments of the target tweet (renderer fast-path + context). */
  media?: HumanReplyDraftMediaItem[]
  /** The quote layer, when the target tweet quotes another post. */
  quoted?: {
    id?: string
    authorHandle?: string
    text?: string
    media?: HumanReplyDraftMediaItem[]
  } | null
  /** Effective composer limit (280, or 25 000 for verified/Premium). */
  charLimit?: number
  /** Optional user steer, e.g. "keep it short", "push back gently". */
  instruction?: string
  /** Prior drafts for this composer — regeneration must vary. */
  previousDrafts?: string[]
}

export interface HumanReplyDraftResult {
  /** Draft text — absent when refused. */
  text?: string
  archetype?: string
  /** One line: what value the reply adds / why this angle. */
  why?: string
  /** Set when the drafter declines (native video, substance-is-video quote…). */
  refused?: { reason: string }
}
