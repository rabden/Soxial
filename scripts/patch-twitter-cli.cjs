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

  if (!changed) return { source: patched, alreadyPatched: true }
  return { source: patched, alreadyPatched: false }
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

module.exports = { applyTwitterCliPatch, resolveClientPy, cliExitCode, MARKER, _internals: { applyPatches, applyGraphqlPatch } }

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
