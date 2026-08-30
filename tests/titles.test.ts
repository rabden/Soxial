import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Session title lifecycle (spec #65, ticket #67): instant fallback from the
 * first user message, AI passes on the selected chat model at turns
 * [1, 3, 6] then frozen, and manual renames win forever (SQL-guarded
 * write-once).
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'soxial-titles-test-'))

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
  TITLE_REFRESH_TURNS,
  buildConversationTitlePrompt,
  buildFirstMessageTitlePrompt,
  cleanTitle,
  fallbackTitleFromText,
  shouldRegenerateTitle,
} from '../electron/main/titles'
import {
  createChatSession,
  getChatSessionTitleMeta,
  renameChatSession,
  updateChatSessionTitleSmart,
} from '../electron/main/db'

describe('fallbackTitleFromText', () => {
  it('takes the first ≤6 words of the message', () => {
    expect(fallbackTitleFromText('Help me plan a content strategy for next week please')).toBe(
      'Help me plan a content strategy',
    )
  })

  it('keeps short messages whole', () => {
    expect(fallbackTitleFromText('hello world')).toBe('hello world')
  })

  it('falls back to "New chat" on empty input', () => {
    expect(fallbackTitleFromText('')).toBe('New chat')
    expect(fallbackTitleFromText('   ')).toBe('New chat')
  })

  it('caps the length at 80 chars', () => {
    const word = 'x'.repeat(40)
    expect(fallbackTitleFromText(`${word} ${word} ${word}`).length).toBeLessThanOrEqual(80)
  })
})

describe('cleanTitle', () => {
  it('takes the first non-empty line and strips wrapping quotes', () => {
    expect(cleanTitle('"The Reddit Growth Plan"\n\nSome explanation')).toBe('The Reddit Growth Plan')
    expect(cleanTitle("  'A title' ")).toBe('A title')
  })

  it('caps at 80 chars and returns null for nothing usable', () => {
    expect(cleanTitle(`${'-'.repeat(100)}`)).toHaveLength(80)
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('""')).toBeNull()
  })
})

describe('shouldRegenerateTitle', () => {
  it('regenerates after the first turn completes (owner request)', () => {
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 1 }, 1)).toBe(false) // concurrent pass already ran at turn 1
    expect(shouldRegenerateTitle({ kind: 'fallback', turn: 0 }, 1)).toBe(true) // AI never landed
  })

  it('refreshes at turns 3 and 6, then freezes', () => {
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 1 }, 2)).toBe(false)
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 1 }, 3)).toBe(true)
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 3 }, 5)).toBe(false)
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 3 }, 6)).toBe(true)
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 6 }, 9)).toBe(false)
  })

  it('self-heals a missed refresh point at the next turn', () => {
    // Turn 3's run failed before regeneration; turn 4's completion catches up.
    expect(shouldRegenerateTitle({ kind: 'ai', turn: 1 }, 4)).toBe(true)
  })

  it('never regenerates a manual rename', () => {
    for (const turn of TITLE_REFRESH_TURNS) {
      expect(shouldRegenerateTitle({ kind: 'manual', turn: 0 }, turn)).toBe(false)
    }
  })
})

describe('prompt builders', () => {
  it('builds a first-message prompt truncated to 2000 chars', () => {
    const prompt = buildFirstMessageTitlePrompt('x'.repeat(5000))
    expect(prompt).toContain('Generate its title')
    expect(prompt.length).toBeLessThan(2100)
  })

  it('builds a conversation digest prompt', () => {
    expect(buildConversationTitlePrompt('user: hi')).toContain('capturing what this conversation is about')
  })
})

describe('write-once vs manual renames (SQL guard)', () => {
  it('writes fallback and AI titles, recording kind and turn watermark', () => {
    const sid = createChatSession('t1') as unknown as number
    expect(updateChatSessionTitleSmart(sid, 'first words here', 'fallback', 0)).toBe(true)
    expect(getChatSessionTitleMeta(sid)).toEqual({ kind: 'fallback', turn: 0 })
    expect(updateChatSessionTitleSmart(sid, 'A Better Title', 'ai', 1)).toBe(true)
    expect(getChatSessionTitleMeta(sid)).toEqual({ kind: 'ai', turn: 1 })
  })

  it('refuses automatic writes after a manual rename', () => {
    const sid = createChatSession('t2') as unknown as number
    renameChatSession(sid, 'My Own Name')
    expect(updateChatSessionTitleSmart(sid, 'Robot Title', 'ai', 1)).toBe(false)
    expect(updateChatSessionTitleSmart(sid, 'fallback words', 'fallback', 0)).toBe(false)
    expect(getChatSessionTitleMeta(sid)).toEqual({ kind: 'manual', turn: 0 })
    const row = getChatSessionTitleMeta(sid)
    expect(row.kind).toBe('manual')
  })
})
