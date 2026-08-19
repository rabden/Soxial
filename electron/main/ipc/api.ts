import { ipcMain } from 'electron'
import {
  addApiKey,
  getApiKeys,
  getApiTier,
  getAvailableModels,
  getDefaultModel,
  getModelExhaustionStatus,
  getSelectedModel,
  removeApiKey,
  setSelectedModel,
} from '../db'
import { credentialSuffix } from '../credentials'
import { detectApiTier } from '../api-tier'

export function registerApiHandlers(): void {
  ipcMain.handle('api:getTier', () => getApiTier())
  ipcMain.handle('api:getAvailableModels', () => getAvailableModels())
  ipcMain.handle('api:getDefaultModel', () => getDefaultModel())
  ipcMain.handle('api:getSelectedModel', () => getSelectedModel())
  ipcMain.handle('api:setSelectedModel', (_event, model: string) => setSelectedModel(model))
  ipcMain.handle('api:getApiKeys', (_event, provider: string = 'google') => (
    getApiKeys(provider).map(({ api_key, ...key }) => ({
      ...key,
      masked: api_key ? credentialSuffix(api_key) : null,
      configured: Boolean(api_key),
    }))
  ))
  ipcMain.handle('api:addApiKey', (_event, apiKey: string, provider: string = 'google') => {
    if (!apiKey.trim()) throw new Error('API key cannot be empty')
    if (!['google', 'zhipu'].includes(provider)) throw new Error('Unsupported API key provider')
    return addApiKey(apiKey.trim(), provider)
  })
  ipcMain.handle('api:removeApiKey', (_event, id: number) => {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid API key ID')
    return removeApiKey(id)
  })
  ipcMain.handle('api:getModelExhaustionStatus', (_event, model: string) => getModelExhaustionStatus(model))
  ipcMain.handle('api:detectTier', (_event, force?: boolean) => detectApiTier(force))
}
