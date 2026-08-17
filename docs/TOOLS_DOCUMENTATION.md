# Soxial Tools Documentation

This document provides a comprehensive catalog of all AI agent tools available in Soxial (`electron/main/tools.ts`, `electron/main/agent.ts`, `electron/main/puter.ts`, and `electron/main/image-gen.ts`).

---

## Tool Summary Matrix

| Category | Tool Name | Description | Requires User Approval | Execution Mechanism |
|---|---|---|---|---|
| **Profile & Strategy** | `read_profile` | Read identity, goals, voice, brand colors, handles | No | SQLite Query |
| | `update_soxial_profile` | Update user profile fields | No | SQLite Update |
| | `read_hooks` | Query hook frameworks ranked by performance | No | SQLite Query |
| | `save_hook` | Upsert hook frameworks into hook library | No | SQLite Upsert |
| | `delete_hooks` | Delete hooks by name or ID | No | SQLite Delete |
| | `read_voice_rules` | Read anti-patterns & natural voice rules | No | SQLite Query |
| | `save_voice_rule` | Save voice anti-patterns or natural rules | No | SQLite Deduplicated Insert |
| | `delete_voice_rules` | Delete voice rules by content match or ID | No | SQLite Delete |
| | `read_replies` | Read curated voice snippets | No | SQLite Query |
| | `save_reply` | Save voice snippets to replies archive | No | SQLite Insert |
| | `read_social_content` | Query auto-saved posts/replies archive | No | SQLite Query |
| | `read_algorithm` | Read platform algorithm ranking rules | No | SQLite Query |
| | `save_algorithm_rule` | Save platform ranking signal rules | No | SQLite Upsert |
| | `delete_algorithm_rules` | Delete algorithm rules by signal or ID | No | SQLite Delete |
| | `read_memory` | Read performance lessons and audience intelligence | No | SQLite Query |
| | `save_memory` | Save memory entries | No | SQLite Insert |
| | `read_pillars` | Read core content pillars | No | SQLite Query |
| | `save_pillar` | Upsert content pillars by name | No | SQLite Upsert |
| | `delete_pillars` | Delete content pillars by name or ID | No | SQLite Delete |
| | `read_targets` | Read target accounts & subreddits | No | SQLite Query |
| | `save_target` | Save target accounts/subreddits | No | SQLite Deduplicated Insert |
| | `delete_targets` | Delete target accounts by handle or ID | No | SQLite Delete |
| | `save_milestone` | Record growth milestone snapshots | No | SQLite Insert |
| **Post Scheduling** | `schedule_post` | Queue a post for publication | No | SQLite Insert |
| | `get_scheduled_posts` | Query queued/draft scheduled posts | No | SQLite Query |
| **X / Twitter** | `twitter_status` | Verify X authentication status | No | `twitter status --json` |
| | `twitter_whoami` | Fetch authenticated user bio & follower count | No | `twitter whoami --json` |
| | `twitter_user` | Fetch public X user profile | No | `twitter user <handle> --json` |
| | `twitter_search` | Search X posts by keywords/filters | No | `twitter search ... --json` |
| | `twitter_user_posts` | Fetch recent posts of an X user | No | `twitter search --from ...` / `user-posts` |
| | `twitter_replies` | Fetch recent replies of an X user | No | `twitter search from:<handle> filter:replies` |
| | `twitter_followers` | List followers of an X user | No | `twitter followers <handle> -n N` |
| | `twitter_following` | List accounts followed by an X user | No | `twitter following <handle> -n N` |
| | `twitter_likes` | Show liked tweets (auth user only) | No | `twitter likes <handle> -n N` |
| | `twitter_feed` | Browse X home feed (For You / Following) | No | `twitter feed -t <type> -n N` |
| | `twitter_tweet` | View single tweet and its replies | No | `twitter tweet <id> -n N` |
| | `twitter_article` | Fetch long-form Twitter Article | No | `twitter article <id> --markdown` |
| | `twitter_list` | Fetch tweets from a Twitter List | No | `twitter list <id> -n N` |
| | `twitter_bookmark` | Bookmark, unbookmark, or list saved tweets | No | `twitter bookmark` / `unbookmark` / `bookmarks` |
| | `twitter_post` | Post a tweet (max 280 chars) | **YES** | `twitter post <text> [-i image]` |
| | `twitter_reply` | Reply to a tweet | **YES** | `twitter reply <id> <text> [-i image]` |
| | `twitter_quote` | Quote tweet with commentary | **YES** | `twitter quote <id> <text> [-i image]` |
| | `twitter_like` | Like or unlike a tweet | **YES** | `twitter like` / `unlike <id>` |
| | `twitter_retweet` | Retweet or unretweet a tweet | **YES** | `twitter retweet` / `unretweet <id>` |
| | `twitter_delete` | Delete own tweet | **YES** | `twitter delete <id> --yes` |
| | `twitter_follow` | Follow or unfollow an X user | **YES** | `twitter follow` / `unfollow <handle>` |
| **Reddit** | `reddit_login` | Refresh Reddit browser cookies | No | `rdt login` + `rdt status` |
| | `reddit_whoami` | Check Reddit karma & auth status | No | `rdt whoami` / `rdt user` |
| | `reddit_search` | Search Reddit posts | No | `rdt search <query> -r <sub shroud> -s <sort>` |
| | `reddit_sub` | Browse a specific subreddit | No | `rdt sub <subreddit> -s <sort>` |
| | `reddit_sub_info` | View subreddit subscriber count & rules | No | `rdt sub-info <subreddit>` |
| | `reddit_read` | Read post and expanded comments | No | `rdt read <id> -n N` |
| | `reddit_user` | View public Reddit user profile | No | `rdt user <username>` |
| | `reddit_user_posts` | Fetch user posts (paginated lookback) | No | `rdt user-posts <username>` |
| | `reddit_user_comments` | Fetch user comments (paginated lookback) | No | `rdt user-comments <username>` |
| | `reddit_feed` | Browse user home feed | No | `rdt feed --subs-only` |
| | `reddit_popular` | Browse r/popular feed | No | `rdt popular` |
| | `reddit_all` | Browse r/all feed | No | `rdt all` |
| | `reddit_saved` | Browse saved Reddit posts | No | `rdt saved` |
| | `reddit_upvoted` | Browse upvoted Reddit posts | No | `rdt upvoted` |
| | `reddit_save` | Save or unsave a Reddit post | No | `rdt save <id> [--undo]` |
| | `reddit_comment` | Comment on a Reddit post | **YES** | `rdt comment <id> <text>` |
| | `reddit_upvote` | Upvote, downvote, or undo vote | **YES** | `rdt upvote <id> [--down/--undo]` |
| | `reddit_subscribe` | Subscribe or unsubscribe from subreddit | **YES** | `rdt subscribe <subreddit> [--undo]` |
| **Image & Media** | `read_image_guide` | Load full image generation guide | No | Direct file read (`references/image-generation.md`) |
| | `inspect_image_url` | Download direct image URL & encode base64 | No | Direct HTTP fetch & base64 encoding |
| | `generate_image` | Generate image via Gemini or Puter.js | No | Gemini SDK `interactions.create` / Puter.js `client.ai.txt2img` |
| **Interaction** | `ask_user` | Morph chat prompt into MCQ or text UI | No | Electron IPC event (`chat:question`) |
| | `ask_user_questions` | Multi-question interview UI (onboarding) | No | Electron IPC event (`onboarding:question`) |

---

## Detailed Tool Specifications

### 1. Profile & Strategy Tools

#### `read_profile`
- **Description:** Read user profile metadata (identity, niche, goals, voice, brand colors, platform handles).
- **Parameters:** None `{}`
- **Executed Command / Logic:** Invokes `getProfile()` from `electron/main/db.ts`. Strips raw API key strings before returning data.

#### `update_soxial_profile`
- **Description:** Update strategy and voice profile fields (brand colors, voice, goals, growth strategy, etc.). User identity fields (`name`, `twitter_handle`, `reddit_username`, `timezone`) are owned by the user and locked against agent modification.
- **Parameters:**
  ```json
  {
    "data": {
      "niche": "string (optional)",
      "specialization": "string (optional)",
      "superpower": "string (optional)",
      "primary_goal": "string (optional)",
      "target_audience": "string (optional)",
      "voice_description": "string (optional)",
      "avoid_words": "string (optional)",
      "brand_primary_color": "string (optional)",
      "brand_secondary_color": "string (optional)",
      "brand_accent_color": "string (optional)",
      "style_preset": "string (optional)",
      "growth_strategy": "string (optional)",
      "branding_strategy": "string (optional)",
      "tools_stack": "string (optional)",
      "monetization_goals": "string (optional)",
      "growth_target": "string (optional)",
      "portfolio_status": "string (optional)",
      "tone_balance": "string (optional)"
    }
  }
  ```
- **Executed Command / Logic:** Strips protected user identity keys and runs SQLite `UPDATE user_profile SET ... WHERE id = 1`.

#### `read_hooks`
- **Description:** Query post opening frameworks ranked by performance.
- **Parameters:** `category` (`showcase`, `community`, `all`), `limit` (`number`).
- **Executed Command / Logic:** Runs `SELECT * FROM hooks WHERE category = ? ORDER BY rank ASC LIMIT ?`.

#### `save_hook`
- **Description:** Upserts hook frameworks into hook library.
- **Parameters:** Array `items` containing `rank`, `category`, `name`, `description`, `why_it_works`, `template`, `niche_examples`, `performance_notes`.
- **Executed Command / Logic:** SQL upsert on `hooks` matching by `name`.

#### `read_voice_rules`
- **Description:** Read voice anti-patterns (banned phrases, banned structures) and natural elements.
- **Parameters:** `type` (`banned_phrase`, `banned_structure`, `natural_element`, `all`).
- **Executed Command / Logic:** Runs `SELECT * FROM voice_rules WHERE type = ?`.

#### `save_voice_rule`
- **Description:** Save voice rules or natural elements.
- **Parameters:** Array `items` containing `type` and `content`.
- **Executed Command / Logic:** Checks existence before `INSERT INTO voice_rules`.

#### `read_social_content`
- **Description:** Read auto-saved posts/replies/comments from `social_content` archive.
- **Parameters:** `platform` (`twitter`, `reddit`), `content_type` (`post`, `reply`, `comment`), `author_handle`, `subreddit`, `limit`, `include_raw`, `summary_only`.
- **Executed Command / Logic:** Queries SQLite `social_content` table with ordering by `posted_at DESC`.

---

### 2. X / Twitter Tools (CLI Execution)

#### `twitter_search`
- **Description:** Search X/Twitter for posts with engagement metrics.
- **Parameters:** `query`, `type` (`top`, `latest`, `photos`, `videos`), `from`, `to`, `lang`, `since`, `until`, `exclude`, `filter`, `max`.
- **Executed Command:**
  ```bash
  twitter -c search "<query>" --json --type <type> --from <from> --since <since> -n <max>
  ```

#### `twitter_user_posts`
- **Description:** Fetch recent posts from an X user (up to 100 items covering 2 months).
- **Parameters:** `handle` (`string`), `max` (`number`).
- **Executed Command:**
  ```bash
  twitter -c search --from <handle> --exclude replies --since <2_months_ago> -n 100 --json
  # Fallback if empty:
  twitter -c user-posts <handle> --max 100 --json
  ```
- **Side Effect:** Automatically persists results into the `social_content` SQLite table.

#### `twitter_post` (Requires User Approval)
- **Description:** Publish a tweet (max 280 characters).
- **Parameters:** `text` / `content` (max 280 chars), `image_path` / `image_paths` (up to 4 images), `reply_to`.
- **Executed Command:**
  ```bash
  twitter post "<text>" -i <image_path_1> -i <image_path_2> --reply-to <reply_to> --json
  ```

#### `twitter_reply` (Requires User Approval)
- **Description:** Reply to an existing tweet.
- **Parameters:** `tweet_id` / `originalId`, `text` / `reply` (max 280 chars), `image_path`.
- **Executed Command:**
  ```bash
  twitter reply <tweet_id> "<text>" -i <image_path> --json
  ```

---

### 3. Reddit Tools (CLI Execution)

#### `reddit_search`
- **Description:** Search Reddit for posts or browse specific subreddits.
- **Parameters:** `query`, `subreddit`, `sort` (`relevance`, `hot`, `top`, `new`, `comments`), `time`, `max`.
- **Executed Command:**
  ```bash
  rdt search "<query>" --json -r <subreddit> -s <sort> -t <time> -n <max>
  ```

#### `reddit_comment` (Requires User Approval)
- **Description:** Post a comment on a Reddit post.
- **Parameters:** `post_id` / `postId`, `text` / `reply`.
- **Executed Command:**
  ```bash
  rdt comment <post_id> "<text>"
  ```

#### `reddit_upvote` (Requires User Approval)
- **Description:** Upvote, downvote, or undo vote on a Reddit post.
- **Parameters:** `post_id`, `action` (`upvote`, `downvote`, `undo`).
- **Executed Command:**
  ```bash
  rdt upvote <post_id> [--down / --undo]
  ```

---

### 4. Image & Media Tools

#### `inspect_image_url`
- **Description:** Fetch an image from a direct HTTPS URL, convert to base64, and pass to the model as an inline visual attachment.
- **Parameters:** `url` (`string`).
- **Execution Mechanism:** Node `fetch()` with custom `Referer: https://x.com/` headers for X/twimg URLs, returning base64 buffer via `toModelOutput`.

#### `generate_image`
- **Description:** Generate marketing graphics using Gemini `gemini-3.5-flash-lite-image` with fallback to Puter.js (`gpt-image-2`).
- **Parameters:** `prompt` (`string`), `filename` (`string`), `model` (`string`, optional Puter model).
- **Execution Mechanism:**
  1. Calls `GoogleGenAI.interactions.create` with `gemini-3.5-flash-lite-image`.
  2. Saves generated buffer to `<userData>/media/<filename>`.
  3. On error, falls back to `puterClient.ai.txt2img({ prompt, model })`.

---

### 5. Interactive UI Tools

#### `ask_user`
- **Description:** Converts the chat prompt input into an interactive question widget (MCQ or text input).
- **Parameters:** `text`, `type` (`single`, `multi`, `text`), `options` (`string[]`).
- **Execution Mechanism:** Emits IPC event `chat:question` to renderer and halts tool loop until user submits answer via IPC event `chat:answer`.

#### `ask_user_questions`
- **Description:** Onboarding interview tool asking all initial questions in a single multi-step wizard.
- **Parameters:** Array `questions` containing `id`, `text`, `type`, `options`.
- **Execution Mechanism:** Emits IPC event `onboarding:question` and waits for batch response via IPC event `onboarding:answer`.
