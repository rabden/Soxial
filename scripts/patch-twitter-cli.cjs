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
 * This script applies three idempotent edits to the venv's client.py:
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

function applyPatches(source) {
  if (source.includes(MARKER)) {
    return { source, alreadyPatched: true }
  }
  if (!source.includes(ORIGINAL_CT_FETCH)) {
    return { error: 'client.py no longer contains the expected ClientTransaction fetch block — the CLI may have updated upstream. Review and update scripts/patch-twitter-cli.cjs anchors.' }
  }
  let patched = source.replace(ORIGINAL_CT_FETCH, PATCHED_CT_FETCH)

  if (!patched.includes(RESET_METHOD_ANCHOR)) {
    return { error: 'client.py anchor for _ensure_client_transaction not found.' }
  }
  patched = patched.replace(RESET_METHOD_ANCHOR, RESET_METHOD)

  if (!patched.includes(RETRY_ANCHOR)) {
    return { error: 'client.py anchor for the queryId retry not found.' }
  }
  // Only the GET retry (first occurrence) — the POST retry keeps its shape.
  patched = patched.replace(RETRY_ANCHOR, RETRY_PATCHED)

  if (!patched.includes(HEADERS_ANCHOR)) {
    return { error: 'client.py anchor for the transaction-id header block not found.' }
  }
  patched = patched.replace(HEADERS_ANCHOR, HEADERS_PATCHED)

  return { source: patched, alreadyPatched: false }
}

function applyTwitterCliPatch(options = {}) {
  const clientPy = resolveClientPy(options.clientPy)
  if (!clientPy || !fs.existsSync(clientPy)) {
    return { ok: false, patched: false, reason: 'twitter-cli client.py not found (is the tool installed?)' }
  }
  const source = fs.readFileSync(clientPy, 'utf8')
  const result = applyPatches(source)
  if (result.error) {
    return { ok: false, patched: false, path: clientPy, reason: result.error }
  }
  if (result.alreadyPatched) {
    return { ok: true, patched: false, reason: 'already patched', path: clientPy }
  }
  if (options.checkOnly) {
    // Guard mode: report the unpatched state without touching the file.
    return { ok: true, patched: false, reason: 'not applied', path: clientPy, checkFailed: true }
  }
  fs.writeFileSync(clientPy, result.source, 'utf8')
  return { ok: true, patched: true, path: clientPy }
}

module.exports = { applyTwitterCliPatch, resolveClientPy, MARKER, _internals: { applyPatches } }

if (require.main === module) {
  const checkOnly = process.argv.includes('--check')
  const result = applyTwitterCliPatch({ checkOnly })
  if (!result.ok) {
    console.error(`[patch-twitter-cli] FAILED: ${result.reason}`)
    process.exit(2)
  }
  console.log(
    `[patch-twitter-cli] ${result.patched ? 'patched' : 'skipped'} ${result.path} (${result.reason || 'applied authed-transaction v1'})`,
  )
  if (checkOnly && result.checkFailed) process.exit(1)
}
