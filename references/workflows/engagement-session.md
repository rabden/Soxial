# Engagement Session

Load this guide when the user asks to "do engagement", "scan my feed", or "find reply opportunities".

## Time structure (remind once, don't lecture)

Classic split: ~30 min replies → ~30 min own content → ~30 min follow-ups. Scale to the user's stated time budget in their profile.

## Step 1 — Fetch candidates

- X: `twitter_feed` + `twitter_search` on niche keywords from the strategy.
- Reddit: `reddit_sub` / `reddit_search` on target subreddits (`read_targets`), sort by hot.
- Volume: 10–20 candidates is plenty. This step fans out well to `run_subagent(kind: "researcher")`.

## Step 2 — Select and verify (per candidate)

1. Worth replying? Prioritize: target accounts (tier1/tier2), high-engagement threads, unanswered niche questions, posts where the user can add real value.
2. Media verification per `media-safety`: skip all video; inspect images only when the reply depends on them.
3. Skip anything you cannot add genuine value to — a forced reply reads as spam and hurts vector consistency.

## Step 3 — Draft replies

- Follow the full `reply-crafting` guide (voice sync → archetype → verification checklist).
- 2–4 replies per batch is a good session size.
- Delegate bulk drafting to `run_subagent(kind: "reply-crafter")`; you keep selection, verification, and approval.

## Step 4 — Reply Cards and approval (mandatory)

Present every candidate as a card with: target handle, why this post is worth replying to, the drafted reply with `[N/280]`, and the archetype used.

One `ask_user` (multi) listing the drafts: user approves which to send. **Never post a reply without explicit approval of that specific reply.** Edits: apply their text verbatim.

## Step 5 — Execute and track

1. Send approved replies via `twitter_reply` / `reddit_comment`.
2. Show resulting cards by ID.
3. `save_memory` (engagement type): accounts engaged, what was sent, outcomes to watch.
4. Report: N approved, N skipped, notable threads to revisit.

Then stop. Suggesting a follow-up pass later is fine as ONE line of text — never another approval prompt.
