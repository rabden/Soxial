import { shell } from 'electron'
import { createServer, type Server } from 'http'
import { logger } from './log'
import type { BrowserWindow } from 'electron'
import type { PuterAuthEventStatus } from '../../src/types/puter-auth-events'

/**
 * Interactive Puter sign-in via the system browser.
 *
 * The stock @heyputer/puter.js `getAuthToken()` opens the external browser at
 * `puter.com/?action=authme&redirectURL=http://localhost:<port>` — a shortcut
 * that only completes when the browser already has a Puter session. A fresh
 * visitor routed into signup lands on the normal web app instead, the redirect
 * never fires, and the promise hangs forever.
 *
 * Instead we host a local page that loads the official js.puter.com v2 SDK and
 * calls `puter.auth.signIn()` in the user's default browser, opened with
 * `shell.openExternal()`. That flow is built for third-party apps: it carries
 * the OAuth-style grant through BOTH login and signup popups, and hands us
 * `puter.authToken` when it resolves.
 *
 * This used to run in an in-app BrowserWindow, but secondary-window renderers
 * wedge in some Linux/Wayland environments (black, unresponsive window), so
 * the flow moved to the system browser. Browsers block sign-in popups without
 * a user gesture, so the page starts from an explicit "Sign in" button.
 */

/** Thrown when sign-in was dismissed, cancelled, or timed out. */
export class PuterAuthCancelledError extends Error {
  constructor(message = 'Puter sign-in was cancelled.') {
    super(message)
    this.name = 'PuterAuthCancelledError'
  }
}

// Generous enough for a full signup, bounded so image generation can't hang forever.
const AUTH_TIMEOUT_MS = 5 * 60 * 1000

type SignInOutcome = { token: string } | { cancelled: true; reason: string }

let inFlight: Promise<string> | null = null

/**
 * Open the sign-in page in the system browser and resolve with the Puter auth
 * token. Concurrent callers share the in-flight attempt. Rejects with
 * {@link PuterAuthCancelledError} when the attempt is cancelled from the
 * renderer or times out.
 */
export function interactivePuterSignIn(): Promise<string> {
  if (inFlight) return inFlight
  inFlight = runSignInFlow().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Cancel any active sign-in (renderer banner button). Returns true if one was active. */
export function cancelInteractivePuterSignIn(): boolean {
  if (!cancelActive) return false
  logger.info('puter-auth', 'sign-in cancelled from app')
  cancelActive({ cancelled: true, reason: 'cancelled by user' })
  return true
}

let cancelActive: ((outcome: SignInOutcome) => void) | null = null

let activeSignInUrl: string | null = null

/** Re-open the sign-in page in the browser (renderer banner "Sign in"). False if no flow is live. */
export async function openPuterSignInPage(): Promise<boolean> {
  const url = activeSignInUrl
  if (!url) return false
  await shell.openExternal(url)
  return true
}

let getHostWindow: (() => BrowserWindow | null) | null = null

/** Called once from the composition root (index.ts) at startup. */
export function initPuterAuthHost(opts: { getWindow: () => BrowserWindow | null }): void {
  getHostWindow = opts.getWindow
}

function runSignInFlow(): Promise<string> {
  const notifyWin = getHostWindow?.() ?? null
  const sendEvent = (status: PuterAuthEventStatus, detail?: string) => {
    try {
      notifyWin?.webContents.send('puter:authEvent', detail ? { status, detail } : { status })
    } catch {
      // Renderer may be mid-reload; the banner state is cosmetic.
    }
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let server: Server | null = null
    let timer: NodeJS.Timeout | null = null

    const finish = (outcome: SignInOutcome) => {
      if (settled) return
      settled = true
      cancelActive = null
      activeSignInUrl = null
      if (timer) clearTimeout(timer)
      server?.close()
      sendEvent('token' in outcome ? 'completed' : 'cancelled')
      if ('token' in outcome) resolve(outcome.token)
      else reject(new PuterAuthCancelledError(cancelReasonMessage(outcome.reason)))
    }

    cancelActive = finish

    const handleRequest = (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/start') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(startPageHtml())
        return
      }
      if (url.pathname === '/page-event') {
        // Failure beacons from the sign-in page (popup blocked, SDK unreachable).
        const msg = (url.searchParams.get('m') || '').slice(0, 200)
        if (msg && !settled) sendEvent('required', msg)
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname === '/token') {
        const token = url.searchParams.get('t') || ''
        if (token.length < 8) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<body style="font-family:system-ui;background:#050507;color:#fff">Invalid token.</body>')
          return
        }
        logger.info('puter-auth', 'received auth token from browser sign-in')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(successPageHtml())
        finish({ token })
        return
      }
      res.writeHead(404)
      res.end()
    }

    timer = setTimeout(() => {
      logger.warn('puter-auth', 'sign-in timed out')
      finish({ cancelled: true, reason: 'timed out' })
    }, AUTH_TIMEOUT_MS)

    server = createServer(handleRequest)
    server.once('error', (err) => {
      logger.error('puter-auth', `local auth server failed: ${err.message}`)
      finish({ cancelled: true, reason: 'could not start local auth server' })
    })
    server.listen(0, '127.0.0.1', () => {
      // A cancel/timeout landing before this async callback must not resurrect the flow.
      if (settled) return
      const port = (server!.address() as import('net').AddressInfo).port
      const startUrl = `http://127.0.0.1:${port}/start`
      activeSignInUrl = startUrl
      sendEvent('required')
      logger.info('puter-auth', `opening sign-in page in system browser at ${startUrl}`)
      shell.openExternal(startUrl).catch((err) => {
        logger.error('puter-auth', `could not open system browser: ${err.message}`)
        if (!settled) {
          // Leave the flow alive so the user can still open the URL by hand.
          sendEvent('required', `Could not open a browser — visit ${startUrl} to sign in.`)
        }
      })
    })
  })
}

function cancelReasonMessage(reason: string): string {
  if (reason === 'timed out') return 'Puter sign-in timed out.'
  return `Puter sign-in was not completed (${reason}).`
}

function startPageHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sign in to Puter</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #050507; color: #fafafa;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  .card { text-align: center; padding: 32px; max-width: 340px; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { font-size: 13px; line-height: 1.6; color: #a1a1aa; margin: 0 0 22px; }
  #status { font-size: 13px; color: #a1a1aa; min-height: 18px; margin-top: 18px; }
  button { background: #fafafa; color: #09090b; border: none; border-radius: 8px;
           padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
  button:hover { background: #e4e4e7; }
  button:disabled { opacity: 0.6; cursor: default; }
  .logo { font-size: 12px; letter-spacing: 3px; color: #52525b; margin-bottom: 26px; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">SOXIAL</div>
    <h1>Connect Puter</h1>
    <p>Soxial uses a free Puter account for AI image generation. A puter.com window will open &mdash; log&nbsp;in or sign&nbsp;up, then approve access.</p>
    <button id="signin">Sign in to Puter</button>
    <div id="status"></div>
  </div>
<script>
(function () {
  var status = document.getElementById('status')
  var button = document.getElementById('signin')
  function setStatus(t) { status.textContent = t }
  function report(msg) {
    setStatus(msg)
    button.textContent = 'Retry sign-in'
    button.disabled = false
    // Beacon the failure back to the app banner.
    fetch('/page-event?m=' + encodeURIComponent(msg)).catch(function () {})
  }
  function begin() {
    button.disabled = true
    setStatus('Loading Puter\u2026')
    var s = document.createElement('script')
    s.src = 'https://js.puter.com/v2/'
    s.onload = function () {
      setStatus('Opening Puter sign-in\u2026')
      puter.auth.signIn().then(function () {
        setStatus('Signed in \u2014 finishing up\u2026')
        var t = puter.authToken
        if (!t) { report('No token was returned by Puter.'); return }
        window.location.href = '/token?t=' + encodeURIComponent(t)
      }).catch(function (err) {
        report(err && err.message
          ? err.message + ' \u2014 if a popup was blocked, allow popups for this page and retry.'
          : 'Sign-in did not complete. If a popup was blocked, allow popups for this page and retry.')
      })
    }
    s.onerror = function () { report('Could not reach js.puter.com. Check your connection.') }
    document.head.appendChild(s)
  }
  button.addEventListener('click', begin)
})()
</script>
</body>
</html>`
}

function successPageHtml(): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Signed in</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #050507; color: #fafafa;
         display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
</style></head>
<body><div><h1>&#10003;</h1><p>Signed in to Puter &mdash; you can close this tab and return to Soxial.</p></div></body>
</html>`
}
