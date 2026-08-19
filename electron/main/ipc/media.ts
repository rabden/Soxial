import { app, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { basename, join } from 'path'
import { errorForRenderer } from '../errors'

export function registerMediaHandlers(): void {
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

  ipcMain.handle('link:preview', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      const appError = errorForRenderer('Invalid URL')
      return { success: false, error: appError.message, appError }
    }
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = await res.text()
      const pick = (...patterns: RegExp[]) => patterns.map(pattern => html.match(pattern)?.[1]?.trim()).find(Boolean) || ''
      const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      const title = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i, /<title[^>]*>([^<]+)<\/title>/i))
      const description = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i))
      const image = decode(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i))
      return { success: true, data: { url, title, description, image } }
    } catch (error: any) {
      const appError = errorForRenderer(error)
      return { success: false, error: appError.message, appError }
    }
  })
}
