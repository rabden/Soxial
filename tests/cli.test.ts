/**
 * CLI spawn/envelope parity tests (#46, #47).
 *
 * Locks the in-app vs shell contract at the runCli seam: env propagation
 * (HOME/PATH/XDG), structured error codes + cursors preserved from the JSON
 * envelope, stderr ClientTransaction warnings never becoming user-facing
 * errors, and the kill-on-timeout guard.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))

const { fakeSpawn } = vi.hoisted(() => ({ fakeSpawn: vi.fn() }))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: fakeSpawn }
})

import { runCli, runTwitterCli, cliSpawnEnv } from '../electron/main/cli'

function fakeChild() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function emitJson(child: any, payload: unknown, code = 0) {
  child.stdout.emit('data', JSON.stringify(payload))
  child.emit('close', code)
}

beforeEach(() => {
  fakeSpawn.mockReset()
})

describe('runCli env propagation (#46)', () => {
  it('spawns children with HOME and ~/.local/bin on PATH', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)
    const promise = runCli('rdt', ['status', '--json'])
    emitJson(child, { ok: true, data: { authenticated: true } })
    await promise

    const env = fakeSpawn.mock.calls[0][2].env
    expect(env.HOME).toBe(process.env.HOME || homedir())
    expect(env.PATH.split(':')).toContain(join(homedir(), '.local', 'bin'))
    // XDG_* must never be stripped
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('XDG_')) expect(env[key]).toBe(process.env[key])
    }
  })

  it('cliSpawnEnv is exported for reuse', () => {
    const env = cliSpawnEnv()
    expect(env.HOME).toBeTruthy()
    expect(typeof env.PATH).toBe('string')
  })
})

describe('CliResult envelope shape (#47)', () => {
  it('preserves structured error codes from the JSON envelope', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)
    const promise = runCli('twitter', ['search', '--from', 'x', '--json'])
    emitJson(
      child,
      { ok: false, schema_version: '1', error: { code: 'not_found', message: 'Twitter API error (HTTP 404)' } },
      1,
    )
    const result = await promise

    expect(result).toEqual({
      ok: false,
      data: null,
      error: 'Twitter API error (HTTP 404)',
      errorCode: 'not_found',
      nextCursor: undefined,
    })
  })

  it('preserves pagination.nextCursor for cursor-native commands', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)
    const promise = runCli('twitter', ['feed', '--json', '-n', '10'])
    emitJson(child, {
      ok: true,
      schema_version: '1',
      data: [{ id: '1' }],
      pagination: { nextCursor: 'cursor-token-1' },
    })
    const result = await promise

    expect(result.ok).toBe(true)
    expect(result.nextCursor).toBe('cursor-token-1')
  })

  it('a stderr ClientTransaction warning never becomes the user-facing error on a success envelope', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)
    const promise = runCli('twitter', ['search', '--from', 'x', '--json'])
    child.stderr.emit('data', 'WARNING twitter_cli.client: Failed to init ClientTransaction')
    emitJson(child, { ok: true, schema_version: '1', data: [] })
    const result = await promise

    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('falls back to stderr only when no JSON envelope exists', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)
    const promise = runCli('twitter', ['feed', '--json'])
    child.stderr.emit('data', 'boom')
    child.emit('close', 1)
    const result = await promise

    expect(result).toEqual({ ok: false, data: null, error: 'boom', errorCode: undefined, nextCursor: undefined })
  })
})

describe('runTwitterCli compact flag', () => {
  it('prepends -c by default and keeps full mode when compact:false', async () => {
    const childA = fakeChild()
    fakeSpawn.mockReturnValueOnce(childA)
    const compactPromise = runTwitterCli(['feed', '--json'])
    emitJson(childA, { ok: true, data: [] })
    await compactPromise
    expect(fakeSpawn.mock.calls[0][1]).toEqual(['-c', 'feed', '--json'])

    const childB = fakeChild()
    fakeSpawn.mockReturnValueOnce(childB)
    const fullPromise = runTwitterCli(['feed', '--json'], { compact: false })
    emitJson(childB, { ok: true, data: [] })
    await fullPromise
    expect(fakeSpawn.mock.calls[1][1]).toEqual(['feed', '--json'])
  })
})

describe('runCli timeout guard', () => {
  it('kills the child and resolves with network_error after the timeout', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)

    const result = await runCli('twitter', ['search', '--json'], { timeoutMs: 20 })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network_error')
    expect(result.error).toContain('timed out')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
