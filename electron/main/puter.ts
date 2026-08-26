import { GoogleGenAI } from '@google/genai'
import { init } from '@heyputer/puter.js/src/init.cjs'
import { getProfile, updateProfile } from './db'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { logger } from './log'
import { interactivePuterSignIn, PuterAuthCancelledError } from './puter-auth'

let puterClient: any = null

/** Get the initialized Puter client. Throws if not signed in. */
export function getPuterClient(): any {
  if (puterClient) return puterClient
  const profile = getProfile()
  const token = profile?.puter_token
  if (!token) throw new Error('Not signed in to Puter. Complete sign-in first.')
  puterClient = init(token)
  return puterClient
}

/** Check whether a Puter token is stored. */
export function checkPuterAuth(): boolean {
  const profile = getProfile()
  return !!profile?.puter_token
}

/** Reset cached client (e.g. after token change). */
export function resetPuterClient() {
  puterClient = null
}

/** Open the interactive in-app Puter sign-in and store the token. Rejects with
 *  PuterAuthCancelledError when dismissed/closed/timed out; other errors propagate as-is. */
export async function puterSignIn(): Promise<void> {
  try {
    const token = await interactivePuterSignIn()
    if (!token) throw new Error('No token received from Puter')
    updateProfile({ puter_token: token })
    puterClient = init(token)
    logger.info('puter', 'signed in successfully')
  } catch (e: any) {
    // Failure logged on all paths, cancelled included.
    const cancelled = e instanceof PuterAuthCancelledError
    logger.error('puter', `sign-in failed${cancelled ? ' (cancelled)' : ''}`, e.message)
    throw e
  }
}

function getApiKey(): string {
  const profile = getProfile()
  const apiKey = profile?.gemini_api_key || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('No Google AI Studio API key configured for image generation')
  return apiKey
}

async function generateGeminiImage(prompt: string, filename: string): Promise<string> {
  const apiKey = getApiKey()
  const ai = new GoogleGenAI({ apiKey })

  logger.info('gemini-image', `generating: "${prompt.slice(0, 80)}" -> ${filename}`)

  const interaction = await ai.interactions.create({
    model: 'gemini-3.1-flash-lite-image',
    store: false,
    input: [{ type: 'user_input', content: [{ type: 'text', text: prompt }] }],
  } as any)

  // The SDK exposes the last generated image via output_image.
  const out = (interaction as any).output_image
  const data = out?.data
  if (!data) {
    // Fall back to scanning steps for an image content block.
    for (const s of (interaction as any).steps || []) {
      for (const c of s?.content || []) {
        if (c?.type === 'image' && c.data) {
          const buffer = Buffer.from(c.data, 'base64')
          return saveImage(buffer, filename)
        }
      }
    }
    throw new Error('Gemini image generation returned no image')
  }

  const base64 = data.includes(',') ? data.split(',')[1] : data
  const buffer = Buffer.from(base64, 'base64')
  logger.info('gemini-image', `saved to ${filename} (${buffer.length} bytes)`)
  return saveImage(buffer, filename)
}

function saveImage(buffer: Buffer, filename: string): string {
  const mediaDir = join(app.getPath('userData'), 'media')
  mkdirSync(mediaDir, { recursive: true })
  const outputPath = join(mediaDir, filename)
  writeFileSync(outputPath, buffer)
  return outputPath
}

async function generatePuterImage(prompt: string, filename: string, model?: string): Promise<string> {
  let client: any
  try {
    client = getPuterClient()
  } catch {
    logger.info('puter', 'no stored auth found, starting sign-in before image generation')
    await puterSignIn() // PuterAuthCancelledError propagates naturally
    client = getPuterClient()
  }

  logger.info('puter', `generating: "${prompt.slice(0, 80)}" -> ${filename} (model: ${model || 'gpt-image-2'})`)

  const options: Record<string, any> = { prompt }
  if (model) options.model = model
  else options.model = 'gpt-image-2'
  const result = await client.ai.txt2img(options)

  let dataUrl: string
  if (typeof result === 'string') {
    dataUrl = result
  } else if (result?.src) {
    dataUrl = result.src
  } else if (result?.data) {
    dataUrl = result.data
  } else {
    throw new Error(`Unexpected Puter.js txt2img response: ${typeof result}`)
  }

  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Invalid data URL from Puter.js')

  const buffer = Buffer.from(base64, 'base64')
  const path = saveImage(buffer, filename)
  logger.info('puter', `saved to ${path} (${buffer.length} bytes)`)
  return path
}

export type GeneratedImage = { path: string; backend: 'gemini' | 'puter' }

/** Generate an image with Gemini by default, falling back to Puter.js if Gemini fails. */
export async function generateImage(prompt: string, filename: string, model?: string): Promise<GeneratedImage> {
  try {
    const path = await generateGeminiImage(prompt, filename)
    return { path, backend: 'gemini' }
  } catch (e: any) {
    logger.warn('gemini-image', `Gemini image failed, falling back to Puter.js: ${e.message}`)
    const path = await generatePuterImage(prompt, filename, model)
    return { path, backend: 'puter' }
  }
}
