import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  generateImage: vi.fn(),
}))

// generate_image resolves ./puter lazily inside execute; mocking the module
// pins the classification without booting Electron or any SDK client.
vi.mock('../electron/main/puter', () => ({
  generateImage: (...args: unknown[]) => state.generateImage(...args),
}))

import { createTools } from '../electron/main/tools'
import { PuterAuthCancelledError } from '../electron/main/puter-auth'

/**
 * The cancelled envelope is an AI-visible contract: the model decides whether
 * to retry based on these exact bytes, so any drift silently breaks retry
 * suppression. Genuine failures must keep the plain {error} shape so the model
 * still sees them as retryable tool errors.
 */

const CANCELLED_CONTRACT = {
  success: false,
  cancelled: true,
  error: 'Image could not be generated: the Puter sign-in was dismissed or did not complete. Do not retry automatically — tell the user you cannot generate images until they finish signing in to Puter.',
}

function executeGenerateImage(): Promise<Record<string, unknown>> {
  const tools = createTools() as Record<string, any>
  return tools.generate_image.execute({ prompt: 'a red cube on a beach', filename: 'semantics_test.png' })
}

describe('generate_image Puter auth error semantics', () => {
  it('cancelled sign-in resolves with the byte-identical cancelled contract', async () => {
    state.generateImage.mockRejectedValueOnce(new PuterAuthCancelledError('Puter sign-in timed out.'))

    const result = await executeGenerateImage()

    expect(result).toEqual(CANCELLED_CONTRACT)
    expect(CANCELLED_CONTRACT.error).toContain('Do not retry automatically')
  })

  it('genuine generation failures do NOT set cancelled:true', async () => {
    state.generateImage.mockRejectedValueOnce(new Error('Puter.js quota exceeded'))

    const result = await executeGenerateImage()

    expect(result).toEqual({ error: 'Puter.js quota exceeded' })
    expect('cancelled' in result).toBe(false)
    expect('success' in result).toBe(false)
  })

  it('classification is instanceof-based, not message-based', async () => {
    state.generateImage.mockRejectedValueOnce(new Error('Puter sign-in timed out.'))

    const result = await executeGenerateImage()

    // A lookalike message must not trigger the cancelled envelope.
    expect(result).toEqual({ error: 'Puter sign-in timed out.' })
    expect('cancelled' in result).toBe(false)
  })
})
