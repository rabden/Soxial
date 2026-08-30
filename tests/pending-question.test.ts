import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Persisted ask_user questions (spec #65, ticket #69): the question a turn
 * asked survives an app close — stored session-scoped, loadable for the
 * read-only interrupted panel, and clearable.
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'soxial-pending-question-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getAppPath: () => userDataDir },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
}))

vi.mock('../electron/main/cli', () => ({
  runCli: vi.fn(),
  runTwitterCli: vi.fn(),
  ensureTwitterAuth: vi.fn(),
  ensureRdtAuth: vi.fn(),
}))

import {
  createChatSession,
  getChatSessionPendingQuestion,
  getDb,
  updateChatSessionPendingQuestion,
} from '../electron/main/db'

describe('persisted ask_user questions', () => {
  it('round-trips a question and clears to null', () => {
    const sid = createChatSession('t') as unknown as number
    expect(getChatSessionPendingQuestion(sid)).toBeNull()

    const question = {
      id: 'chatq_123',
      text: 'Should I post this now?',
      type: 'single' as const,
      options: ['Yes', 'No'],
    }
    updateChatSessionPendingQuestion(sid, question)
    expect(getChatSessionPendingQuestion(sid)).toEqual(question)

    updateChatSessionPendingQuestion(sid, null)
    expect(getChatSessionPendingQuestion(sid)).toBeNull()
  })

  it('treats corrupt JSON as absent', () => {
    const sid = createChatSession('t') as unknown as number
    getDb().prepare('UPDATE chat_sessions SET pending_question = ? WHERE id = ?').run('{not json', sid)
    expect(getChatSessionPendingQuestion(sid)).toBeNull()
  })
})
