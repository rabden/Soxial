import { app, dialog, ipcMain } from 'electron'
import { readFileSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { errorForRenderer } from '../errors'

/** Images the X connector accepts (twitter-cli upload_media gate). */
const REPLY_IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const REPLY_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export function registerMediaHandlers(): void {
  // Native multi-select picker for reply attachments — resolves absolute
  // paths in main (renderer File objects lost their paths across the
  // contextBridge, so webUtils.getPathForFile was unreliable here).
  ipcMain.handle('dialog:pickImages', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    })
    if (result.canceled) return { ok: true as const, paths: [] }
    return { ok: true as const, paths: result.filePaths.slice(0, 4) }
  })

  // Read a picked image as a data URL for <img> previews (renderer cannot
  // load arbitrary local paths). Enforces the connector's image gates.
  ipcMain.handle('media:dataUrl', (_event, filePath: string) => {
    const mime = REPLY_IMAGE_MIME[extname(filePath).toLowerCase()]
    if (!mime) {
      const appError = errorForRenderer('Only jpg, png, gif or webp images are supported')
      return { success: false as const, error: appError.message }
    }
    try {
      if (statSync(filePath).size > REPLY_IMAGE_MAX_BYTES) {
        const appError = errorForRenderer('Images must be 5 MB or smaller')
        return { success: false as const, error: appError.message }
      }
      const data = readFileSync(filePath)
      return { success: true as const, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    } catch {
      const appError = errorForRenderer('Image could not be read')
      return { success: false as const, error: appError.message }
    }
  })

  ipcMain.handle('get:media', (_event, filename: string) => {
    if (basename(filename) !== filename) {
      const appError = errorForRenderer('Invalid filename')
      return { success: false, error: appError.message, appError }
    }
    const filePath = join(app.getPath('userData'), 'media', filename)
    try {
      const data = readFileSync(filePath)
      return { success: true, data: data.toString('base64'), mime: 'image/png' }
    } catch {
      const appError = errorForRenderer('File not found')
      return { success: false, error: appError.message, appError }
    }
  })

  // OG cache: conversation re-renders remount LinkPreview components, which
  // would refetch every link's og on each mount. OG data rarely changes.
  const ogCache = new Map<string, { success: boolean; data: { url: string; title: string; description: string; image: string } }>()
  const ogInflight = new Map<string, Promise<{ success: boolean; data: { url: string; title: string; description: string; image: string } }>>()

  const fetchOg = async (url: string) => {
    const cached = ogCache.get(url)
    if (cached) return cached
    const inflight = ogInflight.get(url)
    if (inflight) return inflight
    const promise = (async () => {
      if (!/^https?:\/\//i.test(url)) {
        return { success: false, data: { url, title: '', description: '', image: '' } }
      }
      try {
        // 5-second hard timeout so slow/dead external sites don't hang and throw ETIMEDOUT
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(5000),
        })

        if (!res.ok) {
          return { success: false, data: { url, title: '', description: '', image: '' } }
        }

        const html = await res.text()
        const pick = (...patterns: RegExp[]) => patterns.map(pattern => html.match(pattern)?.[1]?.trim()).find(Boolean) || ''
        const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        const title = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i, /<title[^>]*>([^<]+)<\/title>/i))
        const description = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i))
        const image = decode(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i))

        return { success: true, data: { url, title, description, image } }
      } catch {
        // Gracefully return empty data instead of crashing or logging an AggregateError
        return { success: false, data: { url, title: '', description: '', image: '' } }
      }
    })()
    ogInflight.set(url, promise)
    try {
      const result = await promise
      ogCache.set(url, result)
      return result
    } finally {
      ogInflight.delete(url)
    }
  }

  ipcMain.handle('link:preview', (_event, url: string) => fetchOg(url))
}
