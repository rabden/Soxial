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
`

function fixturePath(source: string = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), 'soxial-cli-patch-test-'))
  const file = join(dir, 'client.py')
  writeFileSync(file, source, 'utf8')
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
    expect(patched).not.toMatch(/logger\.\w+\(.*generate_transaction_id\(.*\)\s*\)/s)
  })

  it('is idempotent — a second run is a no-op', () => {
    const file = fixturePath()
    applyTwitterCliPatch({ clientPy: file })
    const result = applyTwitterCliPatch({ clientPy: file })

    expect(result).toMatchObject({ ok: true, patched: false, reason: 'already patched' })
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
})
