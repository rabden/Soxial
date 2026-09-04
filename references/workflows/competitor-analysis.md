# Competitor Analysis

Load this guide when the user asks "what are competitors doing" or as the competitor phase of an intelligence update.

## Step 1 — Pick targets

`read_targets` (tier1 first). Choose 1–3 accounts for this pass — more becomes noise.

## Step 2 — Collect

For each target: `twitter_user_posts(handle, max: 10)` / `reddit_user_posts(username)`. This fetching delegates cleanly to `run_subagent(kind: "researcher")`.

## Step 3 — Extract patterns

Per target:
- Hook patterns (map to hook-library categories)
- Formats (text, image, video, thread) and media discipline
- Cadence (posts/week, time-of-day pattern)
- Engagement ratios; reply-count vs like ratio
- Content gaps: what they are NOT covering that fits the user's positioning

## Step 4 — Compare and recommend

Against the user's recent performance (`read_memory`, `read_social_content`):
- 2–3 concrete things to adopt (with how)
- 2–3 gaps to exploit (with a first concrete move)
- Anything they do that the user should deliberately avoid (off-vector for their positioning)

## Step 5 — Save and offer action

1. `save_memory` (competitor type): findings with dates.
2. Render a short ranked findings list.
3. One `ask_user` (single): "Draft a response post" / "Engage one of their threads" / "Just save the notes". Execute only on choice. Then stop.
