# Content Planner

Load this guide when the user wants to plan the week, fill the content calendar, or line up posts ahead.

## Step 1 — Load strategy context

`read_pillars`, `read_hooks`, `read_memory` (recent performance), `read_targets`. Note which pillars are due vs stale based on what was actually posted (memory + `read_social_content`).

## Step 2 — Scan

1. `twitter_feed` and/or target-account posts; 1–2 target subreddits via `reddit_sub`.
2. Identify: what's trending in the niche, what competitors just covered, what gaps remain.
3. Delegate the raw fetching to `run_subagent(kind: "researcher")`; you do selection.

## Step 3 — Draft 3–5 posts

- Spread across pillars per their frequency targets. Never more than 2 self-promo posts in a row.
- Full post-crafting quality bar: hooks from the library, `[N/280]`, conversation-driving endings.
- Generate images only where they clearly help (`image-generation` guidance first).
- Assign suggested posting times using the user's timezone and past performance patterns from memory.

## Step 4 — Present and queue

1. Render all drafts as cards with pillar tags and proposed times.
2. One `ask_user` (multi): which to schedule/post now.
3. On approval:
   - Post now → execute via platform tools, show live cards.
   - Schedule → `schedule_post` with ISO datetime (future times relative to current local time), confirm the queue via `get_scheduled_posts`.
   - Keep as draft → `schedule_post` with status draft semantics or leave as approved text in memory notes.
4. `save_memory` (performance/lesson): what was planned and why.

## Cadence guidance

Mix showcase (~40%) with community/engagement (~60%). Weekends favor community questions and trend riders. If memory shows a pillar underperforming for 2+ weeks, flag it in your report — but changing pillars is a material strategy rewrite: summarize and confirm before touching them.
