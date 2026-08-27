import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { logger } from './log'

// Electron often inherits a minimal PATH; uv-installed CLIs live in ~/.local/bin
const localBin = join(homedir(), '.local', 'bin')
if (localBin && !process.env.PATH?.split(':').includes(localBin)) {
  process.env.PATH = `${localBin}:${process.env.PATH || ''}`
}

function parseCliStdout(stdout: string): any {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('empty stdout')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('no JSON in stdout')
  }
}

function normalizeCliEnvelope(parsed: any, code: number, stderr: string): CliResult {
  const ok = parsed.ok ?? (code === 0)
  let data = parsed.data
  if (data === undefined && !parsed.error) {
    data = parsed
  }
  let error: string | undefined
  let errorCode: string | undefined
  if (!ok) {
    if (typeof parsed.error === 'object' && parsed.error?.message) {
      error = parsed.error.message
      if (typeof parsed.error.code === 'string') errorCode = parsed.error.code
    } else if (typeof parsed.error === 'string') {
      error = parsed.error
    } else {
      error = stderr.trim() || `Exit code ${code}`
    }
  }
  // Cursor-native list commands (`feed`, `list`) emit { pagination: { nextCursor } }.
  const nextCursor =
    typeof parsed.pagination?.nextCursor === 'string' ? parsed.pagination.nextCursor : undefined
  return { ok, data: data ?? null, error, errorCode, nextCursor }
}

async function findBin(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('which', [name], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.on('close', (code) => {
      resolve(code === 0 ? name : null)
    })
    child.on('error', () => resolve(null))
  })
}

async function getUvPath(): Promise<string | null> {
  return await findBin('uv')
}

export async function checkCli(name: 'twitter' | 'rdt'): Promise<boolean> {
  const found = await findBin(name) !== null
  logger.debug('cli', `check ${name}: ${found}`)
  return found
}

export async function ensureCliInstalled(name: 'twitter' | 'rdt'): Promise<boolean> {
  if (await checkCli(name)) {
    logger.info('cli', `${name} already installed`)
    return true
  }

  const uv = await getUvPath()
  if (!uv) {
    logger.info('cli', 'uv not found, installing...')
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], { stdio: ['pipe', 'pipe', 'pipe'] })
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error('uv install failed')))
        child.on('error', reject)
      })
      logger.info('cli', 'uv installed')
    } catch (err) {
      logger.error('cli', 'failed to install uv', err)
      return false
    }
  }

  const pkg = name === 'twitter' ? 'twitter-cli' : 'rdt-cli'
  try {
    logger.info('cli', `installing ${pkg} via uv...`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn('uv', ['tool', 'install', pkg], { stdio: ['pipe', 'pipe', 'pipe'] })
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${pkg} install failed`)))
      child.on('error', reject)
    })
    const ok = await checkCli(name)
    logger.info('cli', `${pkg} installed: ${ok}`)
    return ok
  } catch (err) {
    logger.error('cli', `failed to install ${pkg}`, err)
    return false
  }
}

export async function runCli(
  bin: 'twitter' | 'rdt',
  args: string[],
  options?: { timeoutMs?: number },
): Promise<CliResult> {
  const cmd = `${bin} ${args.join(' ')}`
  logger.info('cli', `running: ${cmd}`)
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        logger.warn('cli', `timeout after ${options.timeoutMs}ms: ${cmd}`)
        resolve({
          ok: false,
          data: null,
          error: `Command timed out after ${options.timeoutMs}ms`,
          errorCode: 'network_error',
        })
      }, options.timeoutMs)
    }

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      logger.debug('cli', `exit code ${code}`, { stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500) })
      try {
        const parsed = parseCliStdout(stdout)
        resolve(normalizeCliEnvelope(parsed, code ?? 1, stderr))
        return
      } catch { /* fall through */ }

      if (code !== 0) {
        resolve({ ok: false, data: null, error: stderr.trim() || stdout.trim() || `Exit code ${code}` })
        return
      }
      resolve({ ok: true, data: stdout.trim() })
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      logger.error('cli', `spawn error: ${cmd}`, err.message)
      resolve({ ok: false, data: null, error: err.message })
    })
  })
}

export interface CliResult {
  ok: boolean
  data: any
  error?: string
  /** Structured connector error code (`not_authenticated`, `rate_limited`, …). */
  errorCode?: string
  /** `pagination.nextCursor` from cursor-native list commands (`feed`, `list`). */
  nextCursor?: string
}

/** Run the X connector. Compact `-c` is a global flag and must precede the subcommand. */
export async function runTwitterCli(
  args: string[],
  options?: { compact?: boolean; timeoutMs?: number },
): Promise<CliResult> {
  const compact = options?.compact !== false
  const fullArgs = compact ? ['-c', ...args] : args
  return runCli('twitter', fullArgs, options)
}

/** Verify Twitter session via browser cookies (auto-extracted on first use). */
export async function ensureTwitterAuth(): Promise<CliResult> {
  logger.info('cli', 'twitter status — verifying session')
  const status = await runCli('twitter', ['status', '--json'])
  if (status.ok && status.data?.authenticated) {
    const user = status.data.user
    logger.info('cli', `twitter authenticated as ${user?.username || user?.screenName || 'unknown'}`)
    return { ok: true, data: status.data }
  }
  return {
    ok: false,
    data: status.data ?? null,
    error: status.error || 'No Twitter cookies found — log in to x.com in your browser, then retry',
  }
}

export function checkCliAuth(bin: 'twitter' | 'rdt'): Promise<CliResult> {
  if (bin === 'twitter') return runCli('twitter', ['status', '--json'])
  return runCli('rdt', ['status', '--json'])
}

/** Establish the Reddit session from browser cookies. Idempotent when already authenticated. */
export async function ensureRdtAuth(): Promise<CliResult> {
  logger.info('cli', 'rdt login — extracting browser cookies')
  await runCli('rdt', ['login'])
  const status = await runCli('rdt', ['status', '--json'])
  if (status.ok && status.data?.authenticated) {
    logger.info('cli', `rdt authenticated as ${status.data.username || 'unknown'}`)
    return { ok: true, data: status.data }
  }
  return {
    ok: false,
    data: status.data ?? null,
    error: status.data?.error || status.error || 'No Reddit cookies found — log in to reddit.com in your browser, then retry',
  }
}

export async function ensureRdtCliReady(): Promise<{ installed: boolean; authenticated: boolean; auth?: CliResult }> {
  const installed = await ensureCliInstalled('rdt')
  if (!installed) return { installed: false, authenticated: false }
  const auth = await ensureRdtAuth()
  return { installed: true, authenticated: auth.ok, auth }
}
