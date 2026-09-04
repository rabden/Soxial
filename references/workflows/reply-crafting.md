# Reply Crafting

Load this guide before writing ANY reply or comment. Voice failure is the #1 quality problem — a generic AI-sounding reply is worse than no reply.

## Step 1 — Fetch and verify the target post

1. X: `twitter_tweet(tweet_id)` — full post + replies. Reddit: `reddit_read(post_id)`.
2. Apply `media-safety` rules BEFORE drafting:
   - Video posts: never draft a reply. Say so and move on.
   - Image posts: only engage if you ran `inspect_image_url` and the reply genuinely depends on the image.
   - Text-only: proceed.

## Step 2 — Sync voice (mandatory)

1. `read_voice_rules` — the user's banned phrases/structures and required natural elements.
2. `read_replies` — curated real examples of the user's voice word-for-word. Match phrasing, not a summary of it.
3. `read_social_content` if you need more raw samples (filter by author_handle).
4. Pick a reply archetype that fits the situation. Common archetypes:
   - Blunt one-liner
   - Helpful detailed advice
   - Direct question back
   - Personal anecdote dropped casually
   - Sarcastic joke (only if the user's archive supports it)
   - Contrarian take

## Step 3 — Draft

- Add genuine value — substance, not praise. "Great take!" is banned; say WHAT and WHY.
- Match the user's formatting habits from their archive: casing, punctuation, line breaks, emoji discipline (0–1 in replies).
- X: ≤280 chars, show `[N/280]`. Reddit: markdown fine, match subreddit tone, be useful before promotional.
- Preserve authentic quirks — do not fix the user's casual grammar.

**Verification checklist** — rewrite from scratch with a different archetype if any check fails:
1. Would the user plausibly type this?
2. Does it contain any phrase or structure from their banned lists?
3. Could you cut half the words and keep the meaning? (too wordy)
4. Does it start the same way as recent replies in the archive?
5. Is it trying to impress instead of converse?
6. Is it a mini-essay (intro/body/conclusion)? Replies are not essays.

## Step 4 — Present and execute

- Show 2–3 options as `twitter-reply-preview` / `reddit-reply-preview` cards (`showPostButton`), each labeled with its archetype.
- One `ask_user` (multi) to approve which to send — never batch-post without per-reply approval.
- On approval: send via `twitter_reply` / `reddit_comment`, show the resulting card by ID, then `save_memory` (engaged account + outcome).

## Delegation

For batches of 3+ replies (engagement sessions), delegate drafting to `run_subagent(kind: "reply-crafter")` per post or per small batch, giving it the post ID/context. You still own media verification, approval cards, posting, and reporting.
