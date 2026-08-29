/**
 * twitter-cli patch script tests (#45, #47).
 *
 * Locks scripts/patch-twitter-cli.cjs against upstream drift: every anchor
 * the patch needs must match, the patch must be idempotent, and a drifted
 * client.py must fail loudly instead of silently no-oping — so a future
 * x_client_transaction rotation cannot silently re-break SearchTimeline
 * without a test going red.
 *
 * The fixture below mirrors the relevant regions of twitter_cli/client.py
 * at the verified snapshot (public-clis/twitter-cli@main, 2026-08-27).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { applyTwitterCliPatch, MARKER } = require('../scripts/patch-twitter-cli.cjs')

/** The exact source regions the patch anchors on. */
const FIXTURE = `import logging

logger = logging.getLogger(__name__)


class TwitterClient:
    def __init__(self, auth_token, ct0, rate_limit_config=None, cookie_string=None):
        self._auth_token = auth_token
        self._ct0 = ct0
        self._cookie_string = cookie_string
        self._client_transaction = None
        self._ct_init_attempted = False
        self._ensure_client_transaction()

    def _graphql_get(self, operation_name, variables, features, field_toggles=None):
        query_id = _resolve_query_id(operation_name, prefer_fallback=True, url_fetch_fn=_url_fetch)
        using_fallback = query_id == FALLBACK_QUERY_IDS.get(operation_name)
        url = _build_graphql_url(query_id, operation_name, variables, features, field_toggles)

        try:
            return self._api_get(url)
        except TwitterAPIError as exc:
            # Fallback query IDs can go stale. Retry with live queryId if 404/422.
            if exc.status_code in (404, 422) and using_fallback:
                logger.info("Retrying %s with live queryId after %d", operation_name, exc.status_code)
                _invalidate_query_id(operation_name)
                refreshed_query_id = _resolve_query_id(operation_name, prefer_fallback=False, url_fetch_fn=_url_fetch)
                retry_url = _build_graphql_url(refreshed_query_id, operation_name, variables, features, field_toggles)
                return self._api_get(retry_url)
            raise

    def _ensure_client_transaction(self):
        if self._ct_init_attempted:
            return
        self._ct_init_attempted = True

        if self._load_ct_cache():
            return

        try:
            cffi_session = _get_cffi_session()
            ct_headers = _gen_ct_headers()
            home_page = cffi_session.get(
                "https://x.com", headers=ct_headers, timeout=10,
            )
            home_page_response = bs4.BeautifulSoup(home_page.content, "html.parser")
            ondemand_url = get_ondemand_file_url(response=home_page_response)
            if not ondemand_url:
                raise ValueError("Failed to extract ondemand file URL from homepage")
            ondemand_file = cffi_session.get(
                ondemand_url, headers=ct_headers, timeout=10,
            )
            self._client_transaction = ClientTransaction(
                home_page_response=home_page_response,
                ondemand_file_response=ondemand_file.text,
            )
            logger.info("ClientTransaction initialized for x-client-transaction-id")
            _update_features_from_html(home_page.text)
            self._save_ct_cache(home_page.text, ondemand_file.text)
        except Exception as exc:
            logger.warning("Failed to init ClientTransaction: %s", exc)

    def _build_headers(self, url="", method="GET"):
        headers = {
            "Authorization": "Bearer %s" % BEARER_TOKEN,
            "Cookie": self._cookie_string or "auth_token=%s; ct0=%s" % (self._auth_token, self._ct0),
            "X-Csrf-Token": self._ct0,
        }
        if method == "POST":
            headers["Content-Type"] = "application/json"
        # Generate x-client-transaction-id if available
        if self._client_transaction and url:
            try:
                path = urllib.parse.urlparse(url).path
                tid = self._client_transaction.generate_transaction_id(
                    method=method, path=path,
                )
                headers["X-Client-Transaction-Id"] = tid
            except Exception as exc:
                logger.debug("Failed to generate transaction id: %s", exc)
        return headers

    def fetch_user_tweets(self, user_id, count=20):
        # type: (str, int) -> List[Tweet]
        """Fetch tweets posted by a user."""
        return self._fetch_timeline(
            "UserTweets",
            count,
            lambda data: _deep_get(data, "data", "user", "result", "timeline_v2", "timeline", "instructions"),
            extra_variables={},
        )

    def fetch_home_timeline(self, count=20):
        # type: (int) -> List[Tweet]
        """Fetch home timeline tweets."""
        return self._fetch_timeline(
            "HomeTimeline",
            count,
            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),
        )

    def fetch_following_feed(self, count=20):
        # type: (int) -> List[Tweet]
        """Fetch chronological following feed."""
        return self._fetch_timeline(
            "HomeLatestTimeline",
            count,
            lambda data: _deep_get(data, "data", "home", "home_timeline_urt", "instructions"),
        )

    def _fetch_timeline(self, operation_name, count, get_instructions, extra_variables=None, override_base_variables=False, field_toggles=None):
        # type: (str, int, Callable[[Any], Any], Optional[Dict[str, Any]], bool, Optional[Dict[str, Any]]) -> List[Tweet]
        """Generic timeline fetcher with pagination and deduplication."""
        tweets = []  # type: List[Tweet]
        seen_ids = set()  # type: Set[str]
        cursor = None  # type: Optional[str]
        attempts = 0
        max_attempts = int(math.ceil(count / 20.0)) + 2

        while len(tweets) < count and attempts < max_attempts:
            data = self._graphql_get(operation_name, variables, FEATURES, field_toggles=field_toggles)
            new_tweets, next_cursor = parse_timeline_response(data, get_instructions)

            if not next_cursor:
                break
            if next_cursor == cursor:
                logger.debug("Timeline pagination stopped because cursor did not advance: %s", next_cursor)
                break
            cursor = next_cursor

        return tweets[:count]

    def _fetch_user_list(self, operation_name, user_id, count, get_instructions):
        pass
`

/** The exact cli.py feed regions layer K anchors on (0.8.5 shape). */
const CLI_FIXTURE = `import click
from .output import emit_structured, success_payload
from .serialization import tweets_to_data


@click.command()
@click.option("--full-text", is_flag=True, help="Show full tweet text in table output.")
@click.pass_context
def feed(ctx, feed_type, max_count, as_json, as_yaml, input_file, output_file, do_filter, full_text):
    # type: (Any, str, Optional[int], bool, bool, Optional[str], Optional[str], bool, bool) -> None
    """Fetch home timeline with optional filtering."""
    compact = ctx.obj.get("compact", False)
    config = load_config()
    try:
            if feed_type == "following":
                tweets = client.fetch_following_feed(fetch_count)
            else:
                tweets = client.fetch_home_timeline(fetch_count)
    except (TwitterError, RuntimeError) as exc:
        _exit_with_error(exc)

    filtered = _apply_filter(tweets, do_filter, config, rich_output=rich_output)

    save_tweet_cache(filtered)

    if emit_structured(tweets_to_data(filtered), as_json=as_json, as_yaml=as_yaml):
        return

    title = "👥 Following" if feed_type == "following" else "📱 Twitter"
`

function fixturePath(source: string = FIXTURE, cliSource?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'soxial-cli-patch-test-'))
  const file = join(dir, 'client.py')
  writeFileSync(file, source, 'utf8')
  if (cliSource !== undefined) writeFileSync(join(dir, 'cli.py'), cliSource, 'utf8')
  return file
}

let warnings: string[]
beforeEach(() => {
  warnings = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(String(args[0]))
  return () => { console.warn = originalWarn }
})

describe('patch-twitter-cli.cjs (#45)', () => {
  it('applies the authed-transaction patch to a pristine client.py', () => {
    const file = fixturePath()
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result.ok).toBe(true)
    expect(result.patched).toBe(true)

    const patched = readFileSync(file, 'utf8')
    // A: authed /home fetch with cookies + csrf
    expect(patched).toContain('"https://x.com/home", headers=ct_headers, timeout=10,')
    expect(patched).toContain('ct_headers["Cookie"] = (')
    expect(patched).toContain('ct_headers["X-Csrf-Token"] = self._ct0')
    // B: reset method
    expect(patched).toContain('def _reset_client_transaction(self):')
    // C: retry resets the transaction before the fresh queryId lookup
    expect(patched).toContain('self._reset_client_transaction()')
    expect(patched.indexOf('self._reset_client_transaction()')).toBeGreaterThan(
      patched.indexOf('Retrying %s with live queryId after %d'),
    )
    // D: redacted presence log (boolean only, never the value)
    expect(patched).toContain('logger.debug("x-client-transaction-id available=%s", bool(self._client_transaction))')
    // No logger call may interpolate the generated transaction id value
    // (single-line scope — the value would appear inside the call's args).
    expect(patched).not.toMatch(/logger\.\w+\([^)\n]*generate_transaction_id/)

    // G: fetch_user_tweets reads the current timeline shape
    expect(patched).toContain('_deep_get(data, "data", "user", "result", "timeline", "timeline", "instructions")')
  })

  it('is idempotent — a second run is a no-op', () => {
    const file = fixturePath()
    applyTwitterCliPatch({ clientPy: file })
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result).toMatchObject({ ok: true, patched: false })
    expect(result.reason).toContain('already patched')
  })

  it('fails loudly when the anchor block drifted upstream', () => {
    const drifted = FIXTURE.replace(
      '"https://x.com", headers=ct_headers, timeout=10,',
      '"https://x.com/reshaped", headers=ct_headers, timeout=15,',
    )
    const file = fixturePath(drifted)

    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('anchors')
  })

  it('reports a missing installation without throwing', () => {
    const result = applyTwitterCliPatch({ clientPy: '/nonexistent/client.py' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('check mode guards without applying: exit-flagged when unpatched, clean when patched', () => {
    const pristine = fixturePath()
    const unpatched = applyTwitterCliPatch({ clientPy: pristine, checkOnly: true })
    expect(unpatched).toMatchObject({ ok: true, checkFailed: true })
    // Guard mode must not write.
    expect(readFileSync(pristine, 'utf8')).not.toContain(MARKER)

    applyTwitterCliPatch({ clientPy: pristine })
    const patched = applyTwitterCliPatch({ clientPy: pristine, checkOnly: true })
    expect(patched).toMatchObject({ ok: true, patched: false })
    expect(patched.reason).toContain('already patched')
    expect(patched.checkFailed).toBeUndefined()
  })

  it('exit-code policy: not-installed soft-skips, drift blocks, check flags unpatched', () => {
    const { cliExitCode } = require('../scripts/patch-twitter-cli.cjs')
    // Not installed → exit 0 so CI builds never break on machines without
    // the CLI (ensureCliInstalled applies the patch post-install instead).
    expect(cliExitCode({ ok: false, reason: 'twitter-cli client.py not found (is the tool installed?)' })).toBe(0)
    // Anchor drift → hard failure.
    expect(cliExitCode({ ok: false, reason: 'client.py no longer contains the expected … anchors.' })).toBe(2)
    // --check on an unpatched CLI → guard failure.
    expect(cliExitCode({ ok: true, checkFailed: true })).toBe(1)
    // Applied / already patched / clean check → success.
    expect(cliExitCode({ ok: true, patched: true })).toBe(0)
    expect(cliExitCode({ ok: true, patched: false, reason: 'already patched' })).toBe(0)
  })

  it('K: backports feed cursor pagination to client.py and cli.py (0.8.5 base)', () => {
    const file = fixturePath(FIXTURE, CLI_FIXTURE)
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result.ok).toBe(true)
    expect(result.reason).toContain('feed-cursor patch applied')

    const client = readFileSync(file, 'utf8')
    // client.py: cursor plumbing through the timeline fetcher
    expect(client).toContain('def fetch_home_timeline(self, count=20, cursor=None, return_cursor=False):')
    expect(client).toContain('start_cursor=cursor,')
    expect(client).toContain('cursor = start_cursor')
    expect(client).toContain('continuation_cursor = next_cursor')
    expect(client).toContain('if return_cursor:')
    expect(client).toContain('return tweets[:count], continuation_cursor')

    const cli = readFileSync(join(file, '..', 'cli.py'), 'utf8')
    // cli.py: --cursor option in, pagination.nextCursor out
    expect(cli).toContain('@click.option("--cursor", type=str, default=None')
    expect(cli).toContain('def feed(ctx, feed_type, max_count, as_json, as_yaml, input_file, output_file, do_filter, full_text, cursor):')
    expect(cli).toContain('client.fetch_home_timeline(fetch_count, cursor=cursor, return_cursor=True)')
    expect(cli).toContain('payload["pagination"] = {"nextCursor": next_cursor}')

    // Idempotent: a second run is a no-op on both files.
    const again = applyTwitterCliPatch({ clientPy: file })
    expect(again).toMatchObject({ ok: true, patched: false })
    expect(again.reason).toContain('feed-cursor: already patched or native')
  })

  it('K: skips cli.py when upstream ships the cursor feature natively', () => {
    const nativeCli = CLI_FIXTURE.replace(
      '@click.pass_context',
      '@click.option("--cursor", type=str, default=None, help="Pagination cursor for continuing a previous feed request.")\n@click.pass_context',
    )
    const file = fixturePath(FIXTURE, nativeCli)
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result.ok).toBe(true)
    expect(result.reason).toContain('feed-cursor: already patched or native')
  })

  it('K: fails loudly when the cli.py feed anchor drifted upstream', () => {
    const driftedCli = CLI_FIXTURE.replace(
      '    if emit_structured(tweets_to_data(filtered), as_json=as_json, as_yaml=as_yaml):',
      '    if emit_structured_v2(tweets_to_data(filtered), as_json=as_json, as_yaml=as_yaml):',
    )
    const file = fixturePath(FIXTURE, driftedCli)
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('cli.py feed command anchor not found')
  })
})
