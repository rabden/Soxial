import { ipcMain } from 'electron'
import { deleteRow, getScheduledPosts } from '../db'

export function registerScheduledPostHandlers(isBlocked: () => boolean): void {
  ipcMain.handle('scheduledPosts:list', () => getScheduledPosts())
  ipcMain.handle('scheduledPosts:delete', (_event, id: number) => {
    if (isBlocked()) throw new Error('Profile rebuild in progress. Try again after it finishes.')
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid scheduled post ID')
    return deleteRow('scheduled_posts', id)
  })
}
