export type ToolCallStatus = "calling" | "complete";

const TOOL_LABELS: Record<string, string> = {
  // X / Twitter — data fetching & reads
  twitter_whoami: "Checking X account",
  twitter_status: "Checking X connection",
  twitter_user: "Fetching X profile",
  twitter_user_posts: "Fetching posts from X",
  twitter_replies: "Fetching replies from X",
  twitter_followers: "Fetching X followers",
  twitter_following: "Fetching X following list",
  twitter_likes: "Fetching X likes",
  twitter_bookmark: "Reading X bookmarks",
  twitter_feed: "Fetching X home feed",
  twitter_search: "Searching X",
  twitter_tweet: "Reading X post",
  twitter_article: "Reading X article",
  twitter_list: "Fetching X list",
  twitter_post: "Composing X post",
  twitter_reply: "Composing X reply",
  twitter_quote: "Composing X quote",
  twitter_like: "Liking X post",
  twitter_retweet: "Retweeting X post",
  twitter_follow: "Following on X",
  twitter_delete: "Deleting X post",

  // Reddit data fetching & social
  reddit_whoami: "Checking Reddit account",
  reddit_login: "Checking Reddit connection",
  reddit_user: "Fetching Reddit profile",
  reddit_user_posts: "Fetching posts from Reddit",
  reddit_user_comments: "Fetching comments from Reddit",
  reddit_feed: "Fetching Reddit feed",
  reddit_search: "Searching Reddit",
  reddit_sub: "Browsing subreddit",
  reddit_sub_info: "Reading subreddit info",
  reddit_read: "Reading Reddit post",
  reddit_popular: "Browsing Reddit popular",
  reddit_all: "Browsing r/all",
  reddit_saved: "Fetching saved posts",
  reddit_upvoted: "Fetching upvoted posts",
  reddit_comment: "Composing Reddit comment",
  reddit_upvote: "Voting on Reddit post",
  reddit_save: "Saving Reddit post",
  reddit_subscribe: "Changing subreddit subscription",

  // App profile (NOT the user's X/Reddit profile)
  update_soxial_profile: "Saving app profile",
  read_profile: "Reading app profile",
  reset_strategy_defaults: "Resetting strategy defaults",

  // Platform connector setup
  connect_twitter: "Connecting X / Twitter",
  connect_reddit: "Connecting Reddit",

  // Strategy / memory
  read_hooks: "Reading hook library",
  save_hook: "Saving hooks",
  delete_hooks: "Removing hooks",
  read_voice_rules: "Reading voice rules",
  save_voice_rule: "Saving voice rules",
  delete_voice_rules: "Removing voice rules",
  read_replies: "Reading voice examples",
  save_reply: "Saving voice examples",
  read_pillars: "Reading content pillars",
  save_pillar: "Saving content pillars",
  delete_pillars: "Removing content pillars",
  read_algorithm: "Reading algorithm rules",
  read_targets: "Reading target accounts",
  save_target: "Saving target accounts",
  delete_targets: "Removing target accounts",
  save_algorithm_rule: "Saving algorithm rules",
  delete_algorithm_rules: "Removing algorithm rules",
  read_memory: "Reading memory",
  save_memory: "Saving memory",
  save_milestone: "Recording milestone",
  read_social_content: "Reading social archive",
  schedule_post: "Scheduling post",
  get_scheduled_posts: "Reading scheduled posts",

  // Playbooks & delegation
  read_workflow_guide: "Loading playbook",
  run_subagent: "Delegating to specialist",
  get_subagent_output: "Checking delegated task",
  cancel_subagent: "Cancelling delegated task",
};

const UPDATE_PROFILE_NOTE =
  "App profile only — this does NOT edit your X/Twitter or Reddit profile.";

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? prettify(name);
}

export function getToolCallDescription(
  name: string,
  status: ToolCallStatus,
  args: unknown,
): string | undefined {
  if (status !== "calling") return undefined;
  if (name === "connect_twitter") return "Installing twitter-cli & detecting browser session...";
  if (name === "connect_reddit") return "Installing rdt-cli & detecting browser session...";
  if (name === "twitter_status" || name === "twitter_whoami") return "Verifying X account cookies...";
  if (name === "reddit_login" || name === "reddit_whoami") return "Verifying Reddit account cookies...";
  if (name === "update_soxial_profile") return UPDATE_PROFILE_NOTE;
  if (!args) return undefined;
  if (typeof args === "object" && Object.keys(args as object).length === 0) return undefined;
  const str = JSON.stringify(args);
  return str.length > 120 ? `${str.slice(0, 117)}…` : str;
}

function prettify(snake: string): string {
  if (!snake) return snake;
  const spaced = snake.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}