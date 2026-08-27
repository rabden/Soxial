import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))

const { fakeSpawn } = vi.hoisted(() => ({ fakeSpawn: vi.fn() }))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: fakeSpawn }
})

import { runCli } from '../electron/main/cli'

function fakeChild() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

beforeEach(() => {
  fakeSpawn.mockReset()
})

describe('runCli timeout hardening (Human foundation)', () => {
  it('kills the child and resolves with a network_error after the timeout', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)

    const promise = runCli('twitter', ['feed', '--json'], { timeoutMs: 30 })
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network_error')
    expect(result.error).toContain('timed out')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does not resolve twice when the child closes after the timeout fired', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)

    const promise = runCli('twitter', ['feed', '--json'], { timeoutMs: 20 })
    const first = await promise
    // Late close must not overwrite the timeout result.
    child.stdout.emit('data', '{"ok":true,"data":[]}')
    child.emit('close', 0)

    expect(first.ok).toBe(false)
  })

  it('clears the timer on normal completion and keeps envelope parsing intact', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)

    const promise = runCli('twitter', ['status', '--json'], { timeoutMs: 5_000 })
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        schema_version: '1',
        data: { authenticated: true, user: { screenName: 'me' } },
        pagination: { nextCursor: 'cur_1' },
      }),
    )
    child.stderr.emit('data', 'noise')
    child.emit('close', 0)
    const result = await promise

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ authenticated: true, user: { screenName: 'me' } })
    expect(result.nextCursor).toBe('cur_1')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('preserves structured error codes from the CLI envelope', async () => {
    const child = fakeChild()
    fakeSpawn.mockReturnValue(child)

    const promise = runCli('twitter', ['bookmarks', '--json'], { timeoutMs: 5_000 })
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        schema_version: '1',
        error: { code: 'not_authenticated', message: 'missing cookies' },
      }),
    )
    child.emit('close', 1)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_authenticated')
    expect(result.error).toBe('missing cookies')
  })
})
