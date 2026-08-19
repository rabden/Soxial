import { BrowserWindow } from 'electron'
import { registerApiHandlers } from './api'
import { registerPlatformHandlers } from './platform'
import { registerProfileHandlers } from './profile'
import { registerScheduledPostHandlers } from './scheduled-posts'
import { registerMediaHandlers } from './media'
import { registerBackupHandlers } from './backup'

export interface IpcRegistrationDependencies {
  getWindow: () => BrowserWindow | null
  isProfileRebuildActive: () => boolean
  hasActiveRun: () => boolean
  registerStatefulHandlers: () => void
}

export function registerIpcHandlers(deps: IpcRegistrationDependencies): void {
  registerProfileHandlers(deps.isProfileRebuildActive)
  registerScheduledPostHandlers(deps.isProfileRebuildActive)
  registerPlatformHandlers(deps.getWindow, deps.hasActiveRun)
  registerApiHandlers()
  registerMediaHandlers()
  registerBackupHandlers(deps.hasActiveRun)
  deps.registerStatefulHandlers()
}
