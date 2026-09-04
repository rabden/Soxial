# Media Safety Rules

MANDATORY before engaging with (replying to, commenting on, or drafting responses to) any post that may contain media. The feed/search tools return compact items that already include media signals — read them directly; do not guess.

## Signals

**X/Twitter items**: `media` array of `{ type, url }` where type is `"video"`, `"animated_gif"`, or `"photo"`.
**Reddit items**: `is_video` (bool), `post_hint` (`"image" | "hosted:video" | "rich:video" | "gallery" | "link" | "self"`), `is_self` (bool), and `media_url` (direct URL when present).

## Hard rules

1. **VIDEO POSTS: never engage.** Never draft a reply or comment to a video post.
   - X: `media[]` contains `{"type":"video"}` or `{"type":"animated_gif"}`.
   - Reddit: `is_video === true`, or `post_hint === "hosted:video"` / `"rich:video"`.
2. **IMAGE POSTS: engage only after inspection AND only if the reply genuinely depends on the image.**
   - Run `inspect_image_url` with the item's `media_url`/url first.
   - Memes, text screenshots, infographics whose entire value IS the image: skip unless the user explicitly asks.
   - If no direct image URL can be obtained, skip — never guess what an image shows.
3. **TEXT-ONLY POSTS: engage freely.**
   - X: empty/absent `media[]`. Reddit: `is_self === true`, or `post_hint === "self"` / null and no `media_url`.
4. **LINK POSTS: treat title + text as context.** Do not fetch the linked page unless the user asks.

These checks happen during candidate selection of ANY engagement/research workflow — BEFORE drafting. If you cannot verify an image's content, say so in your report instead of inventing visual details.
