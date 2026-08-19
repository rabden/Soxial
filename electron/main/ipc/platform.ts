import { ipcMain, BrowserWindow } from 'electron'
import { checkCli, checkCliAuth, ensureCliInstalled, runCli } from '../cli'
import { isTwitterHandleRebuildActive, previewTwitterHandleRebuild, startTwitterHandleRebuild } from '../twitter-handle-rebuild'
import { createBackup } from '../backup'

export function registerPlatformHandlers(
  getWindow: () => BrowserWindow | null,
  hasActiveRun: () => boolean,
): void {
  ipcMain.handle('twitterHandleRebuild:preview', (_event, handle: string) => previewTwitterHandleRebuild(handle))
  ipcMain.handle('twitterHandleRebuild:start', async (_event, handle: string, previewCount: number) => {
    await createBackup('pre-profile-rebuild')
    return startTwitterHandleRebuild(handle, previewCount, getWindow(), hasActiveRun)
  })
  ipcMain.handle('cli:check', (_event, name: 'twitter' | 'rdt') => checkCli(name))
  ipcMain.handle('cli:install', (_event, name: 'twitter' | 'rdt') => ensureCliInstalled(name))
  ipcMain.handle('cli:checkAuth', async (_event, name: 'twitter' | 'rdt') => checkCliAuth(name))
  ipcMain.handle('cli:twitterTweet', (_event, tweetId: string, max?: number) => {
    const args = ['tweet', tweetId, '--json']
    if (max) args.push('-n', String(max))
    return runCli('twitter', args)
  })
  ipcMain.handle('cli:redditRead', (_event, postId: string, maxComments?: number) => {
    const args = ['read', postId, '--json']
    if (maxComments) args.push('-n', String(maxComments))
    return runCli('rdt', args)
  })
}
