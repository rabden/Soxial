# Post Crafting Pipeline

Load this guide before crafting any post or thread. Follow the phases in order.

## Phase A — Understand the request

1. Identify the angle: why now, what is unique, what problem does it solve.
2. Classify the post type. Not everything is self-promotion:
   - **Showcase (40%)**: portfolio piece (demo/screenshot/recording), deep dive (the WHY behind a decision), process reveal (how you work), social proof drop (stats/milestones).
   - **Community & engagement (60%)**: trend rider, community question, debate starter, spotlighting someone else's work.
3. Check `read_pillars` — the post must map to one of the user's pillars (vector consistency).

## Phase B — Research (mandatory before drafting)

Do this yourself or delegate to `run_subagent(kind: "researcher")` for the fetching; you own the synthesis.

1. `read_memory` for past performance on similar topics and winning hooks.
2. `read_hooks` for proven openers ranked by performance.
3. Platform scan:
   - X: `twitter_search` on the topic (`type: top` + `latest`). Who is posting, what gets engagement?
   - Reddit: `reddit_search` / `reddit_sub` on target subreddits from `read_targets`.
4. Check at least one Tier 1 target: `twitter_user_posts` / `reddit_user_posts`.
5. Media check: apply `media-safety` rules to every candidate post you engage with or draw from.

**Research Summary gate** — before drafting, you must be able to state:
- 2–3 recent posts found on the topic (with engagement data)
- The conversation gap: what has NOT been said yet
- What worked before for this user on similar topics (memory)
- At least one competitor angle observed

If you cannot fill these, research more. Never skip to drafting.

## Phase C — Craft

Write **2–3 variations**, each with a different hook from `read_hooks`:

- Hook first — opening line stops the scroll.
- Specific details — exact tools, numbers, outcomes; never vague.
- Ends with something that earns replies: sharp claim, takeaway, or question.
- `[N/280]` count shown per variation (URLs = 23 chars). Reddit: no hashtags, match subreddit norms, markdown allowed.
- 1–3 niche-relevant hashtags max on X, at the end or woven in.
- @tag only when genuinely referencing work.
- No external links in the main post — links go in the first reply.

For each variation, give one line of strategic reasoning (which gap it fills, which hook it uses).

## Phase D — Package and execute

After the user picks a variation:

1. Render the final draft as a rich-content card with `showPostButton`.
2. Prepare the first reply (link + extra context) if there is a link.
3. Suggest posting time from memory patterns and the user's timezone.
4. Name 2–3 engagement targets to reply to after posting.
5. Remind about the golden window: stay online ~30 minutes, reply to every comment (Author-Engaged Reply is the strongest ranking signal).
6. On explicit approval: execute via `twitter_post` / `reddit_comment` (attach image paths if generated), then show the resulting ID-based card and `save_memory` with the outcome.

## Visual hooks (optional)

If the post would scroll past unnoticed (community question, tip, hot take), consider `generate_image`: read `image-generation` guidance first via `read_image_guide`, pull brand colors via `read_profile`, and end prompts with "No watermarks, no logos, no AI artifacts." Video/screen recordings beat generated images whenever available.
