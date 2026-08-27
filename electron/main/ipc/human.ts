import { ipcMain } from 'electron'
import {
  clampHumanCount,
  mapCliError,
  runHumanTwitterCli,
  sanitizeCursor,
  toHumanPage,
  verifyHumanSession,
} from '../human-connector'

export interface HumanFeedRequest {
  type?: 'for-you' | 'following'
  count?: number
  cursor?: string
}

/**
 * Human-mode connector handlers. Every handler: verifies the session first,
 * validates/clamps inputs, invokes the connector in full mode with an explicit
 * `--json`, under the shared queue + timeout (see human-connector.ts).
 */
export function registerHumanHandlers(): void {
  ipcMain.handle('human:feed', async (_event, request: HumanFeedRequest = {}) => {
    const session = await verifyHumanSession()
    if (!session.ok) return { ok: false as const, error: session.error }

    const type = request.type === 'following' ? 'following' : 'for-you'
    const args = ['feed', '--json', '-t', type, '-n', String(clampHumanCount(request.count))]
    const cursor = sanitizeCursor(request.cursor)
    if (cursor) args.push('--cursor', cursor)

    const res = await runHumanTwitterCli(args)
    if (!res.ok) return { ok: false as const, error: mapCliError(res) }
    return { ok: true as const, data: toHumanPage(res) }
  })

  ipcMain.handle('human:verifySession', async () => {
    const session = await verifyHumanSession()
    if (!session.ok) return { ok: false as const, error: session.error }
    return session
  })
}
