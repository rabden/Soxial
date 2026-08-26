# Intelligence Update

Load this guide for performance reviews and self-evolving strategy updates. This is what keeps the user's operating system current — run it when asked, or as a mini-review after several work sessions.

## Phase 1 — Performance analysis (what's working for us)

1. Fetch recent posts: `twitter_user_posts` / `reddit_user_posts`.
2. Rank by engagement (likes + replies + reposts + bookmarks; Reddit: score + comments).
3. Identify top and bottom performers: hook type, format, time slot, media, topic.
4. Update `save_memory` with findings. Re-rank hooks via `save_hook` when the data clearly demotes/promotes specific frameworks.

## Phase 2 — Feed intelligence (what's working for others)

1. Scan `twitter_feed`, target subreddits (`reddit_sub` hot), and 1–3 tier-1 targets' posts.
2. Extract from top posts: hook pattern, format, topic, reply-to-like ratio (high ratio = conversation driver).
3. New hook pattern not in the library? Add it via `save_hook` tagged as unvalidated in its description.
4. `save_memory` (competitor type): moves worth adopting or countering.

## Phase 3 — Audience profiling (who we're reaching)

1. Read replies/comments on recent posts (`twitter_tweet` / `reddit_read`).
2. Categorize engagers into audience segments relevant to the niche.
3. `save_memory` (audience): segment breakdown, recurring pain points, their language.

## Phase 4 — Auto-update rules

- **Append-only mindset**: memory entries are additive; never claim to delete history.
- Hook re-ranking and new hooks are normal writes. Pillar/target/voice changes are MATERIAL — summarize and confirm via one `ask_user` before writing.
- Never invent metrics. If a metric is unavailable, say so.

## Cadence

- Mini (Phase 1): after every few sessions or on request.
- Standard (Phases 1–3): every ~5 posts or weekly.
- Deep review: user asks for "strategy review" → run all phases plus the `strategy-chat` diagnosis.

## Delegation

Phase 1–2 fetching and number-crunching delegates well to `run_subagent(kind: "intel-updater")`. You keep interpretation, material-change confirmation, and reporting.
