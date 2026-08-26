// Tool family tables and the past-tense action phrase resolver.
import { isRecord, shortError } from "./envelope";
import type { envelopeOf } from "./envelope";

export const LISTING_NOUNS: Record<string, [singular: string, plural: string]> = {
  twitter_search: ["result", "results"],
  twitter_feed: ["post", "posts"],
  twitter_list: ["post", "posts"],
  twitter_likes: ["liked post", "liked posts"],
  twitter_bookmarks: ["bookmark", "bookmarks"],
  twitter_user_posts: ["post", "posts"],
  reddit_search: ["post", "posts"],
  reddit_sub: ["post", "posts"],
  reddit_feed: ["post", "posts"],
  reddit_popular: ["post", "posts"],
  reddit_all: ["post", "posts"],
  reddit_saved: ["saved post", "saved posts"],
  reddit_upvoted: ["upvoted post", "upvoted posts"],
};

export const HANDLE_TOOLS = new Set([
  "twitter_user_posts",
  "twitter_replies",
  "twitter_followers",
  "twitter_following",
  "twitter_likes",
]);

export const PROFILE_TOOLS = new Set(["twitter_user", "reddit_user"]);

export const LOCAL_READ_NOUNS: Record<string, string> = {
  read_hooks: "hooks",
  read_voice_rules: "rules",
  read_replies: "examples",
  read_algorithm: "rules",
  read_memory: "memories",
  read_pillars: "pillars",
  read_targets: "targets",
  get_scheduled_posts: "scheduled posts",
  read_social_content: "archived items",
};

export const SAVE_NOUNS: Record<string, string> = {
  save_hook: "hooks",
  save_voice_rule: "rules",
  save_pillar: "pillars",
  save_algorithm_rule: "rules",
  save_target: "targets",
  save_memory: "memories",
  save_reply: "examples",
  save_milestone: "milestones",
};

export const DELETE_ARG_KEYS: Record<string, string> = {
  delete_hooks: "by_name",
  delete_pillars: "by_name",
  delete_voice_rules: "by_content",
  delete_targets: "by_handle",
  delete_algorithm_rules: "by_signal",
};

/** Auth/connector plumbing that never belongs in the summary line. */
export const NOISE_TOOLS = new Set([
  "connect_twitter",
  "connect_reddit",
  "twitter_status",
  "twitter_whoami",
  "reddit_login",
  "reddit_whoami",
  "read_image_guide",
  "read_workflow_guide",
]);

/** Past-tense verb for social actions; resolved against the action arg. */
export const ACTION_VERBS: Record<string, [doVerb: string, undoVerb: string]> = {
  twitter_like: ["Liked", "Unliked"],
  twitter_retweet: ["Retweeted", "Unretweeted"],
  twitter_follow: ["Followed", "Unfollowed"],
  twitter_delete: ["Deleted", "Deleted"],
  twitter_post: ["Posted", "Posted"],
  twitter_reply: ["Replied", "Replied"],
  twitter_quote: ["Quoted", "Quoted"],
  twitter_bookmark: ["Bookmarked", "Removed bookmark"],
  reddit_comment: ["Commented", "Commented"],
  reddit_upvote: ["Upvoted", "Downvoted"],
  reddit_save: ["Saved", "Unsaved"],
  reddit_subscribe: ["Subscribed", "Unsubscribed"],
};

/** Tools whose completed chip benefits from keeping the args target. */
export const COMBINE_TARGET = new Set([
  "twitter_search",
  "reddit_search",
  "twitter_user",
  "reddit_user",
  "twitter_user_posts",
  "twitter_replies",
  "reddit_user_posts",
  "reddit_user_comments",
  "twitter_followers",
  "twitter_following",
  "reddit_sub",
  "reddit_sub_info",
  "twitter_tweet",
  "twitter_article",
  "reddit_read",
]);

export function hasMedia(item: any): boolean {
  if (!isRecord(item)) return false;
  if (Array.isArray(item.media) && item.media.length > 0) return true;
  return Boolean(item.media_url);
}

export function actionPhrase(name: string, args: any, env: ReturnType<typeof envelopeOf>): string {
  if (env.ok === false) return shortError(env.error) ?? "Failed";
  const verbs = ACTION_VERBS[name];
  if (!verbs) return "Done";
  const action = isRecord(args) && typeof args.action === "string" ? args.action : undefined;
  if (name === "reddit_upvote") {
    if (action === "downvote") return verbs[1];
    if (action === "undo") return "Vote removed";
    return verbs[0];
  }
  return action === "unlike" || action === "unretweet" || action === "unfollow" || action === "remove" || action === "unsubscribe"
    ? verbs[1]
    : verbs[0];
}
