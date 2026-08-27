import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userDataDir = mkdtempSync(join(tmpdir(), 'soxial-human-mode-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

import { getAppMode, setAppMode, getDb } from '../electron/main/db'
import { registerApiHandlers } from '../electron/main/ipc/api'
import { ipcMain } from 'electron'

describe('Human Mode - DB & IPC', () => {
  beforeAll(() => {
    // initialize db schema
    getDb()
  })

  beforeEach(() => {
    // Reset user_profile row
    getDb().prepare('UPDATE user_profile SET app_mode = \'agent\' WHERE id = 1').run()
  })

  it('defaults app_mode to agent', () => {
    expect(getAppMode()).toBe('agent')
  })

  it('updates app_mode to human and persists it', () => {
    setAppMode('human')
    expect(getAppMode()).toBe('human')

    const row = getDb().prepare('SELECT app_mode FROM user_profile WHERE id = 1').get() as { app_mode: string }
    expect(row.app_mode).toBe('human')

    setAppMode('agent')
    expect(getAppMode()).toBe('agent')
  })

  it('rejects invalid app_mode values at DB level or setter', () => {
    expect(() => setAppMode('invalid' as any)).toThrow()
  })

  it('registers api:getAppMode and api:setAppMode IPC handlers', async () => {
    const handlers: Record<string, Function> = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
      handlers[channel] = handler
    })

    registerApiHandlers()

    expect(handlers['api:getAppMode']).toBeDefined()
    expect(handlers['api:setAppMode']).toBeDefined()

    setAppMode('agent')
    expect(await handlers['api:getAppMode']()).toBe('agent')

    await handlers['api:setAppMode']({} as any, 'human')
    expect(getAppMode()).toBe('human')
    expect(await handlers['api:getAppMode']()).toBe('human')

    expect(() => handlers['api:setAppMode']({} as any, 'invalid')).toThrow()
  })

  it('handles empty user_profile correctly when setting app mode', () => {
    getDb().prepare('DELETE FROM user_profile').run()
    setAppMode('human')
    expect(getAppMode()).toBe('human')
  })
})
