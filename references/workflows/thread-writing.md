# Thread Writing

Load this guide before writing multi-post threads (X) or long-form Reddit posts.

## Structure (X threads: 3–7 tweets)

1. **Tweet 1** — hook + promise + thread indicator. Must work alone as a scroll-stopper.
2. **Tweets 2..N-1** — one clear point per tweet. Each tweet must make sense if screenshotted individually.
3. **Final tweet** — takeaway + CTA + question (drives replies on the last tweet, which the algorithm reads as conversation).

## Rules

- Run the full post-crafting research phase first (`post-crafting` guide) — threads amplify whatever angle you picked, including a weak one.
- Every tweet ≤280 chars; show `[Tweet N/M]` boundaries and `[N/280]` counts per tweet.
- No links inside the thread body — link goes in the first reply of tweet 1.
- Vary openings across tweets; do not repeat the same sentence pattern.
- Voice rules apply per-tweet: run the reply-crafting verification checklist against the user's voice for each tweet's tone.

## Execution

1. Render all tweets as draft cards so the user sees the full flow.
2. One `ask_user` for approval of the sequence (single: Approve/Edit/Skip).
3. Post sequentially: `twitter_post` → capture ID → `twitter_reply(id, next_tweet)` for each subsequent tweet. If any step fails, stop and report exactly where the thread broke — never continue posting into a broken chain.
4. After posting: show the first tweet's live card, remind about the golden window, `save_memory` with the thread topic and hook used.

## Reddit long-form

Reddit has no threads in the X sense — write ONE self-post with markdown structure (title carries the hook). Check subreddit rules via `reddit_sub_info` before posting; many subreddits restrict self-promotion links.
