import { ipcMain } from 'electron'
import { getProfile, updateProfile } from '../db'

export function registerProfileHandlers(isBlocked: () => boolean): void {
  ipcMain.handle('db:getProfile', () => getProfile())
  ipcMain.handle('db:updateProfile', (_event, data: Record<string, unknown>) => {
    if (isBlocked()) throw new Error('Profile rebuild in progress. Try again after it finishes.')
    return updateProfile(data)
  })
}
