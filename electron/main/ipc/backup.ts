import { dialog, ipcMain } from 'electron'
import { createBackup, exportUserData, listBackups, restoreBackup } from '../backup'

export function registerBackupHandlers(hasActiveRun: () => boolean): void {
  ipcMain.handle('backup:create', () => createBackup('manual'))
  ipcMain.handle('backup:list', () => listBackups())
  ipcMain.handle('backup:restore', async (_event, fileName: string) => {
    if (hasActiveRun()) throw new Error('Stop active generation before restoring a backup.')
    return restoreBackup(fileName)
  })
  ipcMain.handle('export:data', async (_event, includeMedia = false) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Soxial data',
      defaultPath: 'soxial-export.zip',
      filters: [
        { name: 'Soxial export archive', extensions: ['zip'] },
        { name: 'JSON data export', extensions: ['json'] },
      ],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    return exportUserData(result.filePath, { includeMedia })
  })
}
