#!/usr/bin/env node
/**
 * Patch the installed twitter-cli so SearchTimeline works inside Electron (#45).
 *
 * Root cause: `TwitterClient._ensure_client_transaction()` fetches
 * https://x.com WITHOUT the authenticated cookie string, so the logged-out
 * HTML contains no `ondemand.s.<hash>.js`; ClientTransaction init fails
 * ("'NoneType' object has no attribute 'group'") and every search GraphQL
 * call goes out without `X-Client-Transaction-Id` → HTTP 404. HomeTimeline
 * still answers 200, which is why `feed` kept working.
 *
 * This script applies idempotent edits to the venv's client.py and graphql.py:
 *   A. `_ensure_client_transaction` fetches https://x.com/home with
 *      `Cookie` + `X-Csrf-Token` so the authenticated HTML (with the
 *      ondemand bundle) is parsed; the ~/.twitter-cli/transaction_cache.json
 *      cache + TTL logic is reused unchanged (shared with the shell).
 *   B. New `_reset_client_transaction()`: drop the cache file and flags,
 *      reinitialize from a fresh authed fetch.
 *   C. On a 404/422 queryId retry, reset the transaction first — a stale or
 *      missing transaction id also manifests as 404.
 *   D. `_build_headers` logs (debug) the redacted *presence* of the
 *      transaction id — never its value.
 *   E. `graphql.py` FALLBACK_QUERY_IDS refreshed from twitter-openapi
 *      (2026-08-28) — HomeTimeline, HomeLatestTimeline etc were stale and
 *      produced `Query: Unspecified` (HTTP 0) instead of 404, so C's
 *      404-only retry never fired.
 *   F. `client.py` queryId retry now also triggers on `Query` errors
 *      (status 0, message `Query: Unspecified`) so stale fallbacks always
 *      recover via live lookup.
 *   G. `client.py` fetch_user_tweets reads the current UserTweets response
 *      shape (`user.result.timeline.timeline.instructions`); the old
 *      `timeline_v2` path returns "No timeline instructions found" →
 *      `user-posts` answered an empty list, so Human Profile fell back to
 *      SearchTimeline (whose `from:` index is incomplete — recent posts
 *      missing entirely).
 *   H. Pinned tweets: `parser.py` skips the `TimelinePinEntry` instruction
 *      (a single `entry`, not in `entries`); `models.py` gains
 *      `Tweet.pinned` and `serialization.py` emits it, so `user-posts`
 *      returns the pinned tweet first with `pinned: true`.
 *   I. Viewer state: `parser.py` reads `legacy.favorited`/`legacy.retweeted`
 *      (ORing the wrapper and the original for retweets), `models.py` gains
 *      `Tweet.liked`/`Tweet.retweeted` and `serialization.py` emits them —
 *      the UI fills the Like/Repost buttons for already-acted-on tweets.
 *   J. `serialization.py` quotedTweet dict gains media + urls (+ ISO time) so
 *      the UI can show the quote's own media/og preview when the quoting
 *      tweet has no attachment of its own (X behavior).
 *   K. Feed cursor pagination backport (upstream #56, never released to
 *      PyPI — latest is 0.8.5): `client.py` `_fetch_timeline`/
 *      `fetch_home_timeline`/`fetch_following_feed` gain `start_cursor`/
 *      `return_cursor` plumbing and `cli.py`'s `feed` command gains
 *      `--cursor` plus `pagination.nextCursor` on the structured envelope.
 *      Without K the Human feed ends after one page ("You're all caught
 *      up") and every reload re-serves X's CDN-cached launch page head.
 *      Skips itself when upstream ships the feature natively.
 *
 * Usage: node scripts/patch-twitter-cli.cjs [--check]
 *   --check  exit 1 if the patch is not currently applied (CI guard)
 *
 * Re-applied automatically by `ensureCliInstalled('twitter')`, the
 * `native:electron` npm script, and the `onboarding:prepare` IPC handler.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const MARKER = '# SOXIAL-PATCH: authed-transaction v1'
const MARKER_QIDS = '# SOXIAL-PATCH: queryIds v2'
const MARKER_RETRY2 = '# SOXIAL-PATCH: query-retry v2'
const MARKER_USERTWEETS = '# SOXIAL-PATCH: user-tweets-path v1'
const MARKER_PIN = 'SOXIAL-PATCH: pin-entry v1'
const MARKER_VIEWER = 'SOXIAL-PATCH: viewer-state v1'
const MARKER_QUOTE = 'SOXIAL-PATCH: quote-media v1'
const MARKER_FEED_CURSOR = 'SOXIAL-PATCH: feed-cursor v1'
const MARKER_ENTITIES = 'SOXIAL-PATCH: url-entities v1'

/** Resolve the installed twitter-cli's client.py inside its uv tool venv. */
function resolveClientPy(explicit) {
  if (explicit) return explicit
  const candidates = []
  try {
    const toolDir = execFileSync('uv', ['tool', 'dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    candidates.push(path.join(toolDir, 'twitter-cli'))
  } catch { /* uv not on PATH here */ }
  candidates.push(path.join(os.homedir(), '.local', 'share', 'uv', 'tools', 'twitter-cli'))

  for (const root of candidates) {
    if (!fs.existsSync(root)) continue
    const libDir = path.join(root, 'lib')
    if (!fs.existsSync(libDir)) continue
    for (const py of fs.readdirSync(libDir).sort().reverse()) {
      const candidate = path.join(libDir, py, 'site-packages', 'twitter_cli', 'client.py')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveGraphqlPy() {
  const candidates = []
  try {
    const toolDir = execFileSync('uv', ['tool', 'dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    candidates.push(path.join(toolDir, 'twitter-cli'))
  } catch {}
  candidates.push(path.join(os.homedir(), '.local', 'share', 'uv', 'tools', 'twitter-cli'))
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue
    const libDir = path.join(root, 'lib')
    if (!fs.existsSync(libDir)) continue
    for (const py of fs.readdirSync(libDir).sort().reverse()) {
      const candidate = path.join(libDir, py, 'site-packages', 'twitter_cli', 'graphql.py')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

const ORIGINAL_CT_FETCH = [
  '            cffi_session = _get_cffi_session()',
  '            ct_headers = _gen_ct_headers()',
  '            home_page = cffi_session.get(',
  '                "https://x.com", headers=ct_headers, timeout=10,',
  '            )',
].join('\n')

const PATCHED_CT_FETCH = [
  '            cffi_session = _get_cffi_session()',
  '            ct_headers = _gen_ct_headers()',
  `            ${MARKER} — fetch /home with the authenticated`,
  '            # cookie string so the HTML carries ondemand.s.<hash>.js.',
  '            ct_headers["Cookie"] = (',
  '                self._cookie_string',
  '                or "auth_token=%s; ct0=%s" % (self._auth_token, self._ct0)',
  '            )',
  '            if self._ct0:',
  '                ct_headers["X-Csrf-Token"] = self._ct0',
  '            home_page = cffi_session.get(',
  '                "https://x.com/home", headers=ct_headers, timeout=10,',
  '            )',
].join('\n')

const RESET_METHOD_ANCHOR = '    def _ensure_client_transaction(self):'

const RESET_METHOD = [
  `    ${MARKER}`,
  '    def _reset_client_transaction(self):',
  '        # type: () -> None',
  '        """Drop the cached ClientTransaction and reinitialize from a fresh authed fetch."""',
  '        try:',
  '            cache_path = self._ct_cache_path()',
  '            if os.path.exists(cache_path):',
  '                os.remove(cache_path)',
  '        except Exception as exc:',
  '            logger.debug("Failed to remove CT cache: %s", exc)',
  '        self._client_transaction = None',
  '        self._ct_init_attempted = False',
  '        self._ensure_client_transaction()',
  '',
  RESET_METHOD_ANCHOR,
].join('\n')

const RETRY_ANCHOR = [
  '                logger.info("Retrying %s with live queryId after %d", operation_name, exc.status_code)',
  '                _invalidate_query_id(operation_name)',
].join('\n')

const RETRY_PATCHED = [
  '                logger.info("Retrying %s with live queryId after %d", operation_name, exc.status_code)',
  `                ${MARKER} — a stale or missing transaction id also`,
  '                # manifests as 404; regenerate it before the retry.',
  '                self._reset_client_transaction()',
  '                _invalidate_query_id(operation_name)',
].join('\n')

const HEADERS_ANCHOR = [
  '        # Generate x-client-transaction-id if available',
  '        if self._client_transaction and url:',
].join('\n')

const HEADERS_PATCHED = [
  '        # Generate x-client-transaction-id if available',
  `        ${MARKER} (redacted presence only — never the value)`,
  '        logger.debug("x-client-transaction-id available=%s", bool(self._client_transaction))',
  '        if self._client_transaction and url:',
].join('\n')

// E/F: Query retry for `Query: Unspecified` (status 0) — stale fallback must also recover.
const RETRY2_GET_OLD = '            if exc.status_code in (404, 422) and using_fallback:'
const RETRY2_GET_NEW = `            if using_fallback and (exc.status_code in (404, 422) or 'Query' in str(exc)):  # ${MARKER_RETRY2}`
const RETRY2_POST_OLD = '            if exc.status_code in (404, 422) and using_fallback:'
const RETRY2_POST_NEW = `            if using_fallback and (exc.status_code in (404, 422) or 'Query' in str(exc)):  # ${MARKER_RETRY2}`

// G: UserTweets response moved from timeline_v2 → timeline; prefer the new
// shape with the old one as fallback so both CLI builds keep working.
const USERTWEETS_OLD = '            lambda data: _deep_get(data, "data", "user", "result", "timeline_v2", "timeline", "instructions"),'
const USERTWEETS_NEW = [
  `            lambda data: (  # ${MARKER_USERTWEETS}`,
  '                _deep_get(data, "data", "user", "result", "timeline", "timeline", "instructions")',
  '                or _deep_get(data, "data", "user", "result", "timeline_v2", "timeline", "instructions")',
  '            ),',
].join('\n')

// H: pinned tweets — parser skips TimelinePinEntry; models/serialization expose the flag.
const PARSER_LOOP_OLD = [
  '    for instruction in instructions:',
  `        entries = instruction.get("entries") or instruction.get("moduleItems") or []  # ${MARKER_PIN}`,
  '        # TimelinePinEntry delivers the pinned tweet in a single `entry` key,',
  '        # not the `entries` list — without this it is silently dropped.',
  '        is_pin_instruction = instruction.get("type") == "TimelinePinEntry"',
  '        if not entries and instruction.get("entry"):',
  '            entries = [instruction["entry"]]',
  '        for entry in entries:',
  '            content = entry.get("content", {})',
  '            next_cursor = _extract_cursor(content) or next_cursor',
  '',
  '            item_content = content.get("itemContent", {})',
  '            result = _deep_get(item_content, "tweet_results", "result")',
  '            if result:',
  '                tweet = parse_tweet_result(result)',
  '                if tweet:',
  '                    if is_pin_instruction or _deep_get(item_content, "socialContext", "contextType") == "Pin":',
  '                        tweet.pinned = True',
  '                    tweets.append(tweet)',
].join('\n')

const PARSER_LOOP_NEW = [
  '    for instruction in instructions:',
  `        entries = instruction.get("entries") or instruction.get("moduleItems") or []  # ${MARKER_PIN}`,
  '        # TimelinePinEntry delivers the pinned tweet in a single `entry` key,',
  '        # not the `entries` list — without this it is silently dropped.',
  '        is_pin_instruction = instruction.get("type") == "TimelinePinEntry"',
  '        if not entries and instruction.get("entry"):',
  '            entries = [instruction["entry"]]',
  '        for entry in entries:',
  '            content = entry.get("content", {})',
  '            next_cursor = _extract_cursor(content) or next_cursor',
  '',
  '            item_content = content.get("itemContent", {})',
  '            result = _deep_get(item_content, "tweet_results", "result")',
  '            if result:',
  '                tweet = parse_tweet_result(result)',
  '                if tweet:',
  '                    if is_pin_instruction or _deep_get(item_content, "socialContext", "contextType") == "Pin":',
  '                        tweet.pinned = True',
  '                    tweets.append(tweet)',
].join('\n')

const MODELS_OLD = [
  '    article_title: Optional[str] = None',
  '    article_text: Optional[str] = None',
].join('\n')
const MODELS_NEW = [
  '    article_title: Optional[str] = None',
  '    article_text: Optional[str] = None',
  `    pinned: bool = False  # ${MARKER_PIN}`,
].join('\n')

const SERIALIZATION_OLD = [
  '        "lang": tweet.lang,',
  '        "score": tweet.score,',
  '    }',
].join('\n')
const SERIALIZATION_NEW = [
  '        "lang": tweet.lang,',
  '        "score": tweet.score,',
  `        "pinned": tweet.pinned,  # ${MARKER_PIN}`,
  '    }',
].join('\n')

// I: viewer state — liked/retweeted flags (X: `legacy.favorited` /
// `legacy.retweeted`). Without this the UI cannot fill the Like/Repost
// buttons for tweets the user already acted on.
const PARSER_TWEET_KWARGS_OLD = [
  '        is_retweet=is_retweet,',
  '        retweeted_by=retweeted_by,',
].join('\n')
const PARSER_TWEET_KWARGS_NEW = [
  '        is_retweet=is_retweet,',
  `        # Viewer state: whether the signed-in user already liked/retweeted.  # ${MARKER_VIEWER}`,
  '        # A retweet wrapper carries its own `retweeted` flag while the like',
  '        # lands on the original tweet — OR both positions.',
  '        liked=bool(legacy.get("favorited") or actual_legacy.get("favorited")),',
  '        retweeted=bool(legacy.get("retweeted") or actual_legacy.get("retweeted")),',
  '        retweeted_by=retweeted_by,',
].join('\n')

const MODELS_VIEWER_OLD = [
  `    pinned: bool = False  # ${MARKER_PIN}`,
].join('\n')
const MODELS_VIEWER_NEW = [
  `    pinned: bool = False  # ${MARKER_PIN}`,
  `    liked: bool = False  # ${MARKER_VIEWER}`,
  `    retweeted: bool = False  # ${MARKER_VIEWER}`,
].join('\n')

const SERIALIZATION_VIEWER_OLD = [
  `        "pinned": tweet.pinned,  # ${MARKER_PIN}`,
  '    }',
].join('\n')
const SERIALIZATION_VIEWER_NEW = [
  `        "pinned": tweet.pinned,  # ${MARKER_PIN}`,
  `        "liked": tweet.liked,  # ${MARKER_VIEWER}`,
  `        "retweeted": tweet.retweeted,  # ${MARKER_VIEWER}`,
  '    }',
].join('\n')

// J: quote media — the quoted tweet's dict gains media + urls (+ ISO time) so
// the UI can render the quote's own preview when the quoting tweet has none.
// v1 emitted only screenName/name; v2 adds avatar + verified so the quote header
// can render correctly (author image + blue check).
const SERIALIZATION_QUOTE_OLD = [
  '    if tweet.quoted_tweet:',
  '        data["quotedTweet"] = {',
  '            "id": tweet.quoted_tweet.id,',
  '            "text": tweet.quoted_tweet.text,',
  '            "author": {',
  '                "screenName": tweet.quoted_tweet.author.screen_name,',
  '                "name": tweet.quoted_tweet.author.name,',
  '            },',
  '        }',
].join('\n')
const SERIALIZATION_QUOTE_NEW = [
  '    if tweet.quoted_tweet:',
  '        data["quotedTweet"] = {',
  '            "id": tweet.quoted_tweet.id,',
  '            "text": tweet.quoted_tweet.text,',
  '            "author": {',
  '                "screenName": tweet.quoted_tweet.author.screen_name,',
  '                "name": tweet.quoted_tweet.author.name,',
  '                "profileImageUrl": tweet.quoted_tweet.author.profile_image_url,',
  '                "verified": tweet.quoted_tweet.author.verified,',
  '            },',
  `            # ${MARKER_QUOTE} — media + links so the quote can show its own`,
  '            # preview when the quoting tweet has none of its own.',
  '            "createdAtISO": format_iso8601(tweet.quoted_tweet.created_at),',
  '            "media": [',
  '                {',
  '                    "type": media.type,',
  '                    "url": media.url,',
  '                    "width": media.width,',
  '                    "height": media.height,',
  '                }',
  '                for media in tweet.quoted_tweet.media',
  '            ],',
  '            "urls": list(tweet.quoted_tweet.urls),',
  '        }',
].join('\n')

// J2: upgrade already-patched quote-media (v1 without author avatar/verified) to v2
const SERIALIZATION_QUOTE_V1_OLD = [
  '            "author": {',
  '                "screenName": tweet.quoted_tweet.author.screen_name,',
  '                "name": tweet.quoted_tweet.author.name,',
  '            },',
  `            # ${MARKER_QUOTE} — media + links so the quote can show its own`,
].join('\n')
const SERIALIZATION_QUOTE_V1_NEW = [
  '            "author": {',
  '                "screenName": tweet.quoted_tweet.author.screen_name,',
  '                "name": tweet.quoted_tweet.author.name,',
  '                "profileImageUrl": tweet.quoted_tweet.author.profile_image_url,',
  '                "verified": tweet.quoted_tweet.author.verified,',
  '            },',
  `            # ${MARKER_QUOTE} — media + links so the quote can show its own`,
].join('\n')

// K: feed cursor pagination — backport of upstream #56 ("Add list cursor
// pagination"), which PyPI never released (latest 0.8.5 predates it). The app's
// Human feed contract (plans/twitter-cli-contract.md §2) requires `--cursor`
// in and `pagination.nextCursor` out; without it the feed dead-ends after one
// page and every reload re-serves the CDN-cached launch-page head.
// client.py side: start_cursor/return_cursor plumbing through _fetch_timeline.
const CLIENT_HOME_OLD = [
  '    def fetch_home_timeline(self, count=20):',
  '        # type: (int) -> List[Tweet]',
  '        """Fetch home timeline tweets."""',
  '        return self._fetch_timeline(',
  '            "HomeTimeline",',
  '            count,',
  '            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),',
  '        )',
  '',
  '    def fetch_following_feed(self, count=20):',
  '        # type: (int) -> List[Tweet]',
  '        """Fetch chronological following feed."""',
  '        return self._fetch_timeline(',
  '            "HomeLatestTimeline",',
  '            count,',
  '            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),',
  '        )',
].join('\n')
const CLIENT_HOME_NEW = [
  `    def fetch_home_timeline(self, count=20, cursor=None, return_cursor=False):  # ${MARKER_FEED_CURSOR}`,
  '        # type: (int, Optional[str], bool) -> Any',
  '        """Fetch home timeline tweets."""',
  '        return self._fetch_timeline(',
  '            "HomeTimeline",',
  '            count,',
  '            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),',
  '            start_cursor=cursor,',
  '            return_cursor=return_cursor,',
  '        )',
  '',
  `    def fetch_following_feed(self, count=20, cursor=None, return_cursor=False):  # ${MARKER_FEED_CURSOR}`,
  '        # type: (int, Optional[str], bool) -> Any',
  '        """Fetch chronological following feed."""',
  '        return self._fetch_timeline(',
  '            "HomeLatestTimeline",',
  '            count,',
  '            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),',
  '            start_cursor=cursor,',
  '            return_cursor=return_cursor,',
  '        )',
].join('\n')

const CLIENT_FETCHSIG_OLD = [
  '    def _fetch_timeline(self, operation_name, count, get_instructions, extra_variables=None, override_base_variables=False, field_toggles=None):',
  '        # type: (str, int, Callable[[Any], Any], Optional[Dict[str, Any]], bool, Optional[Dict[str, Any]]) -> List[Tweet]',
].join('\n')
const CLIENT_FETCHSIG_NEW = [
  `    def _fetch_timeline(self, operation_name, count, get_instructions, extra_variables=None, override_base_variables=False, field_toggles=None, start_cursor=None, return_cursor=False):  # ${MARKER_FEED_CURSOR}`,
  '        # type: (str, int, Callable[[Any], Any], Optional[Dict[str, Any]], bool, Optional[Dict[str, Any]], Optional[str], bool) -> Any',
].join('\n')

const CLIENT_CURSOR_INIT_OLD = [
  '        tweets = []  # type: List[Tweet]',
  '        seen_ids = set()  # type: Set[str]',
  '        cursor = None  # type: Optional[str]',
  '        attempts = 0',
  '        max_attempts = int(math.ceil(count / 20.0)) + 2',
  '',
  '        while len(tweets) < count and attempts < max_attempts:',
].join('\n')
const CLIENT_CURSOR_INIT_NEW = [
  '        tweets = []  # type: List[Tweet]',
  '        seen_ids = set()  # type: Set[str]',
  `        cursor = start_cursor  # type: Optional[str]  # ${MARKER_FEED_CURSOR}`,
  '        continuation_cursor = None  # type: Optional[str]',
  '        attempts = 0',
  '        max_attempts = int(math.ceil(count / 20.0)) + 2',
  '',
  '        while len(tweets) < count and attempts < max_attempts:',
].join('\n')

const CLIENT_BREAKS_OLD = [
  '            if not next_cursor:',
  '                break',
  '            if next_cursor == cursor:',
  '                logger.debug("Timeline pagination stopped because cursor did not advance: %s", next_cursor)',
  '                break',
  '            cursor = next_cursor',
].join('\n')
const CLIENT_BREAKS_NEW = [
  '            if not next_cursor:',
  `                continuation_cursor = None  # ${MARKER_FEED_CURSOR}`,
  '                break',
  '            if next_cursor == cursor:',
  '                logger.debug("Timeline pagination stopped because cursor did not advance: %s", next_cursor)',
  `                continuation_cursor = None  # ${MARKER_FEED_CURSOR}`,
  '                break',
  '            continuation_cursor = next_cursor',
  '            cursor = next_cursor',
].join('\n')

const CLIENT_RETURN_OLD = [
  '        return tweets[:count]',
  '',
  '    def _fetch_user_list(self, operation_name, user_id, count, get_instructions):',
].join('\n')
const CLIENT_RETURN_NEW = [
  `        if return_cursor:  # ${MARKER_FEED_CURSOR}`,
  '            return tweets[:count], continuation_cursor',
  '        return tweets[:count]',
  '',
  '    def _fetch_user_list(self, operation_name, user_id, count, get_instructions):',
].join('\n')

// K (cli.py side): `feed` gains --cursor and emits pagination on the envelope.
const CLI_FEED_SIG_OLD = [
  "@click.option(\"--full-text\", is_flag=True, help=\"Show full tweet text in table output.\")",
  '@click.pass_context',
  'def feed(ctx, feed_type, max_count, as_json, as_yaml, input_file, output_file, do_filter, full_text):',
  '    # type: (Any, str, Optional[int], bool, bool, Optional[str], Optional[str], bool, bool) -> None',
  '    """Fetch home timeline with optional filtering."""',
  "    compact = ctx.obj.get(\"compact\", False)",
].join('\n')
const CLI_FEED_SIG_NEW = [
  "@click.option(\"--full-text\", is_flag=True, help=\"Show full tweet text in table output.\")",
  `@click.option("--cursor", type=str, default=None, help="Pagination cursor for continuing a previous feed request.")  # ${MARKER_FEED_CURSOR}`,
  '@click.pass_context',
  'def feed(ctx, feed_type, max_count, as_json, as_yaml, input_file, output_file, do_filter, full_text, cursor):',
  '    # type: (Any, str, Optional[int], bool, bool, Optional[str], Optional[str], bool, bool, Optional[str]) -> None',
  '    """Fetch home timeline with optional filtering."""',
  `    next_cursor = None  # type: Optional[str]  # ${MARKER_FEED_CURSOR}`,
  "    compact = ctx.obj.get(\"compact\", False)",
].join('\n')

const CLI_FEED_FETCH_OLD = [
  '            if feed_type == "following":',
  '                tweets = client.fetch_following_feed(fetch_count)',
  '            else:',
  '                tweets = client.fetch_home_timeline(fetch_count)',
].join('\n')
const CLI_FEED_FETCH_NEW = [
  '            if feed_type == "following":',
  `                tweets, next_cursor = client.fetch_following_feed(fetch_count, cursor=cursor, return_cursor=True)  # ${MARKER_FEED_CURSOR}`,
  '            else:',
  `                tweets, next_cursor = client.fetch_home_timeline(fetch_count, cursor=cursor, return_cursor=True)  # ${MARKER_FEED_CURSOR}`,
].join('\n')

const CLI_FEED_EMIT_OLD = [
  '    save_tweet_cache(filtered)',
  '',
  '    if emit_structured(tweets_to_data(filtered), as_json=as_json, as_yaml=as_yaml):',
  '        return',
  '',
  '    title = "👥 Following" if feed_type == "following" else "📱 Twitter"',
].join('\n')
const CLI_FEED_EMIT_NEW = [
  '    save_tweet_cache(filtered)',
  '',
  `    # ${MARKER_FEED_CURSOR} — pagination metadata on the structured envelope`,
  '    payload = success_payload(tweets_to_data(filtered))',
  '    if next_cursor:',
  '        payload["pagination"] = {"nextCursor": next_cursor}',
  '    if emit_structured(payload, as_json=as_json, as_yaml=as_yaml):',
  '        return',
  '',
  '    title = "👥 Following" if feed_type == "following" else "📱 Twitter"',
].join('\n')

// L: url-entities — the parser keeps only `expanded_url` from
// `legacy.entities.urls`, dropping the t.co→expanded mapping. The UI's
// positional fallback (Nth t.co → Nth urls entry) then breaks whenever the
// urls array is shorter than the text's link count (e.g. chat's 4-link
// compaction): only the first N links expand, the rest stay raw t.co.
// Emitting the full `{url, expanded_url}` pairs lets the UI expand exactly.
const PARSER_ENTITIES_OLD = [
  "    urls = [item.get(\"expanded_url\", \"\") for item in _deep_get(actual_legacy, \"entities\", \"urls\") or []]",
].join('\n')
const PARSER_ENTITIES_NEW = [
  "    urls = [item.get(\"expanded_url\", \"\") for item in _deep_get(actual_legacy, \"entities\", \"urls\") or []]",
  `    url_entities = [  # ${MARKER_ENTITIES}`,
  "        {\"url\": item.get(\"url\", \"\"), \"expanded_url\": item.get(\"expanded_url\", \"\")}",
  "         for item in _deep_get(actual_legacy, \"entities\", \"urls\") or []",
  "         if item.get(\"url\") and item.get(\"expanded_url\") and item.get(\"url\") != item.get(\"expanded_url\")]",
].join('\n')

const PARSER_TWEET_ENTITIES_OLD = [
  "        media=media,",
  "        urls=urls,",
].join('\n')
const PARSER_TWEET_ENTITIES_NEW = [
  "        media=media,",
  "        urls=urls,",
  `        url_entities=url_entities,  # ${MARKER_ENTITIES}-kw`,
].join('\n')

// v2 — note tweets: X keeps the FULL entity set in
// `note_tweet...entity_set.urls`; `legacy.entities.urls` is partial for long
// tweets (4 of 8 links on the repro tweet), so union both (note first — its
// order matches the note text the parser uses) and derive `urls` from the
// union. Idempotent upgrade over the v1 block.
const PARSER_ENTITIES_V2_OLD = [
  "    urls = [item.get(\"expanded_url\", \"\") for item in _deep_get(actual_legacy, \"entities\", \"urls\") or []]",
  "    url_entities = [  # SOXIAL-PATCH: url-entities v1",
  "        {\"url\": item.get(\"url\", \"\"), \"expanded_url\": item.get(\"expanded_url\", \"\")}",
  "         for item in _deep_get(actual_legacy, \"entities\", \"urls\") or []",
  "         if item.get(\"url\") and item.get(\"expanded_url\") and item.get(\"url\") != item.get(\"expanded_url\")]",
].join('\n')
const PARSER_ENTITIES_V2_NEW = [
  `    _entity_sources = []  # ${MARKER_ENTITIES}-v2`,
  "    _note_result = _deep_get(actual_data, \"note_tweet\", \"note_tweet_results\", \"result\") or {}",
  "    _note_entities = _deep_get(_note_result, \"entity_set\", \"urls\")",
  "    if isinstance(_note_entities, list):",
  "        _entity_sources.extend(_note_entities)",
  "    _legacy_entities = _deep_get(actual_legacy, \"entities\", \"urls\")",
  "    if isinstance(_legacy_entities, list):",
  "        _entity_sources.extend(_legacy_entities)",
  "    _seen_keys = set()",
  "    _seen_tco = set()",
  "    url_entities = []",
  "    urls = []",
  "    for item in _entity_sources:",
  "        _u = item.get(\"url\", \"\")",
  "        _e = item.get(\"expanded_url\", \"\")",
  "        if not _e:",
  "            continue",
  "        _key = _e.lower().split('//', 1)[-1].rstrip('/')",
  "        if _key in _seen_keys:",
  "            continue",
  "        _seen_keys.add(_key)",
  "        urls.append(_e)",
  "        if not _u or _u == _e or _u in _seen_tco:",
  "            continue",
  "        _seen_tco.add(_u)",
  "        url_entities.append({\"url\": _u, \"expanded_url\": _e})",
].join('\n')

const MODELS_ENTITIES_OLD = [
  "    media: List[TweetMedia] = field(default_factory=list)",
  "    urls: List[str] = field(default_factory=list)",
].join('\n')
const MODELS_ENTITIES_NEW = [
  "    media: List[TweetMedia] = field(default_factory=list)",
  "    urls: List[str] = field(default_factory=list)",
  `    url_entities: List[dict] = field(default_factory=list)  # ${MARKER_ENTITIES}`,
].join('\n')

const SERIALIZATION_ENTITIES_OLD = [
  '        "urls": list(tweet.urls),',
].join('\n')
const SERIALIZATION_ENTITIES_NEW = [
  '        "urls": list(tweet.urls),',
  `        "entities": {"urls": tweet.url_entities},  # ${MARKER_ENTITIES}-tweet`,
].join('\n')

const SERIALIZATION_QUOTE_ENTITIES_OLD = [
  '            "urls": list(tweet.quoted_tweet.urls),',
].join('\n')
const SERIALIZATION_QUOTE_ENTITIES_NEW = [
  '            "urls": list(tweet.quoted_tweet.urls),',
  `            "entities": {"urls": tweet.quoted_tweet.url_entities},  # ${MARKER_ENTITIES}-quote`,
].join('\n')

// E: fallback IDs refreshed 2026-08-28 from https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json
const FALLBACK_UPDATES = {
  HomeTimeline: '7zlnp2TxC044W4C1ZUJMHw',
  HomeLatestTimeline: '0dateTVgvXjpkf7kyBZy0g',
  UserByScreenName: 'IGgvgiOx4QZndDHuD3x9TQ',
  UserTweets: '36rb3Xj3iJ64Q-9wKDjCcQ',
  TweetDetail: 'oCon7R-cgWRFy6EfZjaKfg',
  Likes: 'rk2aeVVvKsyUdG3jf5uiLw',
  SearchTimeline: 'Yw6L66Pw54NHKuq4Dp7b4Q',
  Bookmarks: 'XD0ViOeSOW4YoeNTGjVaYw',
  ListLatestTweetsTimeline: 'FVWmROVvhgjRPC-4jAUh8A',
  Followers: '_orfRBQae57vylFPH0Huhg',
  Following: 'F42cDX8PDFxkbjjq6JrM2w',
  CreateTweet: '5CdvsV_zjv4L64XFifAglw',
  CreateRetweet: 'mbRO74GrOvSfRcJnlMapnQ',
  DeleteRetweet: 'ZyZigVsNiFO6v1dEks1eWg',
  DeleteBookmark: 'Wlmlj2-xzyS1GN3a6cj-mQ',
  TweetResultByRestId: 'tCVRZ3WCvoj0BVO7BKnL-Q',
}

function applyPatches(source) {
  let patched = source
  let changed = false

  // A/B/C/D — authed transaction (v1)
  if (!patched.includes(MARKER)) {
    if (!patched.includes(ORIGINAL_CT_FETCH)) {
      return { error: 'client.py no longer contains the expected ClientTransaction fetch block — the CLI may have updated upstream. Review and update scripts/patch-twitter-cli.cjs anchors.' }
    }
    patched = patched.replace(ORIGINAL_CT_FETCH, PATCHED_CT_FETCH)
    changed = true

    if (!patched.includes(RESET_METHOD_ANCHOR)) {
      return { error: 'client.py anchor for _ensure_client_transaction not found.' }
    }
    patched = patched.replace(RESET_METHOD_ANCHOR, RESET_METHOD)
    changed = true

    if (!patched.includes(RETRY_ANCHOR)) {
      return { error: 'client.py anchor for the queryId retry not found.' }
    }
    // Only the GET retry (first occurrence) — the POST retry keeps its shape.
    patched = patched.replace(RETRY_ANCHOR, RETRY_PATCHED)
    changed = true

    if (!patched.includes(HEADERS_ANCHOR)) {
      return { error: 'client.py anchor for the transaction-id header block not found.' }
    }
    patched = patched.replace(HEADERS_ANCHOR, HEADERS_PATCHED)
    changed = true
  }

  // F — retry also on Query: Unspecified (status 0)
  if (!patched.includes(MARKER_RETRY2)) {
    // Both _graphql_get and _graphql_post share the same old line — replace both.
    if (patched.includes(RETRY2_GET_OLD)) {
      // Replace all occurrences (GET and POST)
      patched = patched.split(RETRY2_GET_OLD).join(RETRY2_GET_NEW)
      changed = true
    }
  }

  // G — UserTweets reads the current timeline shape
  if (!patched.includes(MARKER_USERTWEETS)) {
    if (!patched.includes(USERTWEETS_OLD)) {
      return { error: 'client.py no longer contains the fetch_user_tweets timeline_v2 lambda — the CLI may have updated upstream. Review scripts/patch-twitter-cli.cjs anchors.' }
    }
    patched = patched.replace(USERTWEETS_OLD, USERTWEETS_NEW)
    changed = true
  }

  // K — feed cursor pagination (client side). Skips when upstream ships it
  // natively (git main has `start_cursor=`; a future PyPI release may too).
  if (!patched.includes(MARKER_FEED_CURSOR) && !patched.includes('start_cursor=')) {
    for (const [oldText, newText] of [
      [CLIENT_HOME_OLD, CLIENT_HOME_NEW],
      [CLIENT_FETCHSIG_OLD, CLIENT_FETCHSIG_NEW],
      [CLIENT_CURSOR_INIT_OLD, CLIENT_CURSOR_INIT_NEW],
      [CLIENT_BREAKS_OLD, CLIENT_BREAKS_NEW],
      [CLIENT_RETURN_OLD, CLIENT_RETURN_NEW],
    ]) {
      if (!patched.includes(oldText)) {
        return { error: 'client.py no longer contains the expected feed/timeline cursor block — the CLI may have updated upstream. Review scripts/patch-twitter-cli.cjs anchors.' }
      }
      patched = patched.replace(oldText, newText)
      changed = true
    }
  }

  if (!changed) return { source: patched, alreadyPatched: true }
  return { source: patched, alreadyPatched: false }
}

/** H/I — pinned tweets + viewer state: parser.py + models.py + serialization.py
 *  (next to client.py). Entries run sequentially: the pin patches land first
 *  so the viewer-state anchors (which extend the pinned lines) exist. */
function applyPinnedPatches(dir) {
  const results = []
  for (const [file, oldText, newText, marker] of [
    ['parser.py', PARSER_LOOP_OLD, PARSER_LOOP_NEW, MARKER_PIN],
    ['models.py', MODELS_OLD, MODELS_NEW, MARKER_PIN],
    ['serialization.py', SERIALIZATION_OLD, SERIALIZATION_NEW, MARKER_PIN],
    ['parser.py', PARSER_TWEET_KWARGS_OLD, PARSER_TWEET_KWARGS_NEW, MARKER_VIEWER],
    ['models.py', MODELS_VIEWER_OLD, MODELS_VIEWER_NEW, MARKER_VIEWER],
    ['serialization.py', SERIALIZATION_VIEWER_OLD, SERIALIZATION_VIEWER_NEW, MARKER_VIEWER],
    ['serialization.py', SERIALIZATION_QUOTE_OLD, SERIALIZATION_QUOTE_NEW, MARKER_QUOTE],
    // Upgrade existing quote-media v1 (author without avatar/verified) in-place
    ['serialization.py', SERIALIZATION_QUOTE_V1_OLD, SERIALIZATION_QUOTE_V1_NEW, 'profileImageUrl": tweet.quoted_tweet.author.profile_image_url'],
    // L — url-entities: keep the t.co→expanded mapping so the UI can expand
    // every link exactly, not just the first `len(urls)` positionally.
    // Per-entry marker suffixes: inserted comments contain the bare marker
    // as a substring, so a shared marker would make the second entry in the
    // same file skip itself.
    ['parser.py', PARSER_ENTITIES_OLD, PARSER_ENTITIES_NEW, MARKER_ENTITIES],
    ['parser.py', PARSER_TWEET_ENTITIES_OLD, PARSER_TWEET_ENTITIES_NEW, MARKER_ENTITIES + '-kw'],
    ['models.py', MODELS_ENTITIES_OLD, MODELS_ENTITIES_NEW, MARKER_ENTITIES],
    ['serialization.py', SERIALIZATION_QUOTE_ENTITIES_OLD, SERIALIZATION_QUOTE_ENTITIES_NEW, MARKER_ENTITIES],
    ['serialization.py', SERIALIZATION_ENTITIES_OLD, SERIALIZATION_ENTITIES_NEW, MARKER_ENTITIES + '-tweet'],
    // v2: union note_tweet entity_set (full map for long tweets) with legacy
    ['parser.py', PARSER_ENTITIES_V2_OLD, PARSER_ENTITIES_V2_NEW, MARKER_ENTITIES + '-v2'],
  ]) {
    const filePath = path.join(dir, file)
    if (!fs.existsSync(filePath)) {
      results.push({ file, skipped: 'not found' })
      continue
    }
    const source = fs.readFileSync(filePath, 'utf8')
    if (source.includes(marker)) {
      results.push({ file, skipped: 'already patched' })
      continue
    }
    if (!source.includes(oldText)) {
      results.push({ file, error: `${file} anchor not found — the CLI may have updated upstream` })
      continue
    }
    fs.writeFileSync(filePath, source.replace(oldText, newText), 'utf8')
    results.push({ file, patched: true })
  }
  return results
}

/** K — feed cursor pagination on cli.py (the `feed` command): `--cursor` in,
 *  `pagination.nextCursor` out on the structured envelope. Sibling of
 *  client.py (same package dir). Skips when the feature already exists
 *  (marker or a native upstream `--cursor` help string). */
function applyFeedCursorCliPatch(dir, checkOnly) {
  const filePath = path.join(dir, 'cli.py')
  if (!fs.existsSync(filePath)) return { skipped: 'cli.py not found' }
  const source = fs.readFileSync(filePath, 'utf8')
  if (
    source.includes(MARKER_FEED_CURSOR) ||
    source.includes('Pagination cursor for continuing a previous feed request')
  ) {
    return { skipped: 'already patched or native' }
  }
  let patched = source
  for (const [oldText, newText] of [
    [CLI_FEED_SIG_OLD, CLI_FEED_SIG_NEW],
    [CLI_FEED_FETCH_OLD, CLI_FEED_FETCH_NEW],
    [CLI_FEED_EMIT_OLD, CLI_FEED_EMIT_NEW],
  ]) {
    if (!patched.includes(oldText)) {
      return { error: 'cli.py feed command anchor not found — the CLI may have updated upstream. Review scripts/patch-twitter-cli.cjs anchors.' }
    }
    patched = patched.replace(oldText, newText)
  }
  if (checkOnly) return { checkFailed: true }
  fs.writeFileSync(filePath, patched, 'utf8')
  return { patched: true }
}

function applyGraphqlPatch(source) {
  let patched = source
  let changed = false
  let missing = []
  for (const [key, newId] of Object.entries(FALLBACK_UPDATES)) {
    // Match `"Key": "oldId",` — oldId may be any string
    const re = new RegExp(`("${key}":\\s*")[^"]+(")`)
    if (!re.test(patched)) { missing.push(key); continue }
    // Only replace if not already the newId
    if (patched.includes(`"${key}": "${newId}"`)) continue
    patched = patched.replace(re, `$1${newId}$2`)
    changed = true
  }
  if (missing.length) {
    // Not fatal — some keys may have been renamed upstream
    // but log for visibility
  }
  if (!patched.includes(MARKER_QIDS)) {
    // Ensure marker is present for idempotency, even if fallback already matched
    if (patched.includes('FALLBACK_QUERY_IDS = {')) {
      patched = patched.replace(
        'FALLBACK_QUERY_IDS = {',
        `FALLBACK_QUERY_IDS = {  # ${MARKER_QIDS}`
      )
      changed = true
    }
  }
  if (!changed) return { source: patched, alreadyPatched: true }
  return { source: patched, alreadyPatched: false }
}

function applyTwitterCliPatch(options = {}) {
  const clientPy = resolveClientPy(options.clientPy)
  if (!clientPy || !fs.existsSync(clientPy)) {
    return { ok: false, patched: false, reason: 'twitter-cli client.py not found (is the tool installed?)' }
  }
  const graphqlPy = resolveGraphqlPy()
  let totalPatched = false
  let reasons = []

  // Patch client.py
  const source = fs.readFileSync(clientPy, 'utf8')
  const result = applyPatches(source)
  if (result.error) {
    return { ok: false, patched: false, path: clientPy, reason: result.error }
  }
  if (!result.alreadyPatched) {
    if (options.checkOnly) {
      return { ok: true, patched: false, reason: 'client.py not patched', path: clientPy, checkFailed: true }
    }
    fs.writeFileSync(clientPy, result.source, 'utf8')
    totalPatched = true
    reasons.push('client.py patched')
  } else {
    reasons.push('client.py already patched')
  }

  // Patch graphql.py fallback IDs
  if (graphqlPy && fs.existsSync(graphqlPy)) {
    const gSource = fs.readFileSync(graphqlPy, 'utf8')
    const gResult = applyGraphqlPatch(gSource)
    if (!gResult.alreadyPatched) {
      if (options.checkOnly) {
        return { ok: true, patched: false, reason: 'graphql.py not patched', path: graphqlPy, checkFailed: true }
      }
      fs.writeFileSync(graphqlPy, gResult.source, 'utf8')
      totalPatched = true
      reasons.push('graphql.py patched')
    } else {
      reasons.push('graphql.py already patched')
    }
  }

  // G/H — UserTweets path (client.py) is applied above via applyPatches;
  // pinned tweets live in parser/models/serialization next to client.py.
  const pinDir = path.dirname(clientPy)
  const pinResults = applyPinnedPatches(pinDir)
  const pinFailed = pinResults.find((r) => r.error)
  if (pinFailed) {
    return { ok: false, patched: false, path: clientPy, reason: pinFailed.error }
  }
  const pinChanged = pinResults.some((r) => r.patched)
  if (pinChanged) {
    if (options.checkOnly) {
      return { ok: true, patched: false, reason: 'pinned patches not applied', path: clientPy, checkFailed: true }
    }
    totalPatched = true
    reasons.push('pin patches applied')
  } else {
    reasons.push('pin patches already applied')
  }

  // K — feed cursor pagination on cli.py (client.py side landed in applyPatches)
  const feedCursor = applyFeedCursorCliPatch(pinDir, options.checkOnly)
  if (feedCursor.error) {
    return { ok: false, patched: false, path: clientPy, reason: feedCursor.error }
  }
  if (feedCursor.checkFailed) {
    return { ok: true, patched: false, reason: 'feed-cursor patch not applied', path: clientPy, checkFailed: true }
  }
  if (feedCursor.patched) {
    totalPatched = true
    reasons.push('feed-cursor patch applied')
  } else {
    reasons.push(`feed-cursor: ${feedCursor.skipped ?? 'no change'}`)
  }

  // If neither file needed patching, we're already patched
  if (!totalPatched) {
    return { ok: true, patched: false, reason: reasons.join(', '), path: clientPy }
  }
  return { ok: true, patched: true, path: clientPy, reason: reasons.join(', ') }
}

/** Exit-code policy: not-installed soft-skips (CI must never break on a
 *  machine without the CLI); anchor drift blocks; --check flags unpatched. */
function cliExitCode(result) {
  if (!result.ok) return result.reason.includes('not found') ? 0 : 2
  if (result.checkFailed) return 1
  return 0
}

module.exports = { applyTwitterCliPatch, resolveClientPy, cliExitCode, MARKER, MARKER_USERTWEETS, MARKER_PIN, MARKER_VIEWER, MARKER_QUOTE, MARKER_FEED_CURSOR, _internals: { applyPatches, applyGraphqlPatch, applyPinnedPatches, applyFeedCursorCliPatch } }

if (require.main === module) {
  const checkOnly = process.argv.includes('--check')
  const result = applyTwitterCliPatch({ checkOnly })
  const code = cliExitCode(result)
  if (code === 0) {
    console.log(
      `[patch-twitter-cli] ${result.patched ? 'patched' : 'skipped'} ${result.path ?? ''} (${result.reason})`.trim(),
    )
  } else {
    console.error(`[patch-twitter-cli] FAILED: ${result.reason}`)
  }
  process.exit(code)
}
