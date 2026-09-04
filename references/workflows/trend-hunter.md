# Trend Hunter

Load this guide when the user asks "what's trending" or wants to engage with what's hot right now.

## Step 1 — Platform trend scan

- X: `twitter_search` on niche keywords + adjacent terms, `type: top`, last 24–48h (`since`). Look for abnormal velocity: high engagement per hour, rising reply counts.
- Reddit: `reddit_popular` + `reddit_sub` (hot) on target subreddits.
- Fan the fetching out to `run_subagent(kind: "researcher")` when scanning several keywords.

## Step 2 — Judge fit

For each trend: does it connect to the user's positioning? Off-brand hype damages vector consistency — filter ruthlessly. A trend is usable when the user can add a take only THEY would give.

## Step 3 — Draft plays

For best-fit trends, prepare either:
- **(a) A timely post/take** — full post-crafting bar (hook, `[N/280]`, conversation driver). Speed matters; skip heavy research, but check `read_memory` for past trend-post outcomes.
- **(b) Replies to the top 2–3 trending posts** on that topic — apply `media-safety` verification and the reply-crafting voice bar to each.

## Step 4 — Present and execute

1. Render drafts as cards labeled with the trend they ride.
2. One `ask_user` (multi) for which to execute.
3. Post/schedule per approval; `save_memory` (performance/lesson): which trend, which play, early signal to check later.
4. Optionally note a follow-up engagement pass in a few hours as ONE line of text — no extra approval prompt.

## Timing honesty

Trend windows are short. If research shows the peak passed (engagement decaying for 12h+), say so and recommend skipping rather than posting late into a dead trend.
