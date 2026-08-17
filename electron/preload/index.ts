import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,
  getProfile: () => ipcRenderer.invoke('db:getProfile'),
  updateProfile: (data: Record<string, any>) => ipcRenderer.invoke('db:updateProfile', data),
  dbQuery: (table: string, where?: string, params?: any[]) => ipcRenderer.invoke('db:query', table, where, params),
  dbInsert: (table: string, data: Record<string, any>) => ipcRenderer.invoke('db:insert', table, data),
  dbDelete: (table: string, id: number) => ipcRenderer.invoke('db:delete', table, id),

  previewTwitterHandleRebuild: (handle: string) => ipcRenderer.invoke('twitterHandleRebuild:preview', handle),
  startTwitterHandleRebuild: (handle: string, previewCount: number) => ipcRenderer.invoke('twitterHandleRebuild:start', handle, previewCount),
  onTwitterHandleRebuildProgress: (cb: (event: { phase: string; message?: string; name?: string; args?: unknown; result?: unknown; text?: string; model?: string }) => void) => {
    const listener = (_e: any, event: any) => cb(event)
    ipcRenderer.on('twitterHandleRebuild:progress', listener)
    return () => { ipcRenderer.off('twitterHandleRebuild:progress', listener) }
  },

  checkCli: (name: 'twitter' | 'rdt') => ipcRenderer.invoke('cli:check', name),
  installCli: (name: 'twitter' | 'rdt') => ipcRenderer.invoke('cli:install', name),
  checkCliAuth: (name: 'twitter' | 'rdt') => ipcRenderer.invoke('cli:checkAuth', name),
  twitterTweet: (tweetId: string, max?: number) => ipcRenderer.invoke('cli:twitterTweet', tweetId, max),
  redditRead: (postId: string, maxComments?: number) => ipcRenderer.invoke('cli:redditRead', postId, maxComments),

  runOnboarding: (profileData: Record<string, any>, continueFromMessages?: any[]) => ipcRenderer.invoke('onboarding:run', profileData, continueFromMessages),
  resetOnboarding: () => ipcRenderer.invoke('onboarding:reset'),
  onOnboardingChunk: (cb: (text: string) => void) => ipcRenderer.on('onboarding:chunk', (_e, text) => cb(text)),
  onOnboardingToolCall: (cb: (data: { name: string, args: any }) => void) => ipcRenderer.on('onboarding:toolCall', (_e, data) => cb(data)),
  onOnboardingToolResult: (cb: (data: { name: string, result: any }) => void) => ipcRenderer.on('onboarding:toolResult', (_e, data) => cb(data)),
  onOnboardingReasoning: (cb: (text: string) => void) => ipcRenderer.on('onboarding:reasoning', (_e, text) => cb(text)),
  onOnboardingTransientRetry: (cb: (info: { attempt: number; maxAttempts: number; backoffMs: number; model: string }) => void) =>
    ipcRenderer.on('onboarding:transientRetry', (_e, info) => cb(info)),
  onOnboardingQuestion: (cb: (payload: { batchId: string; questions: { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[] }[] }) => void) =>
    ipcRenderer.on('onboarding:question', (_e, payload) => cb(payload)),
  sendOnboardingAnswer: (id: string, answers: { id: string; answer: string | string[] }[]) => ipcRenderer.send('onboarding:answer', { id, answers }),
  saveOnboardingConversation: (messages: { role: string; content: string; steps?: any[] }[]) => ipcRenderer.invoke('onboarding:saveConversation', messages),
  retryOnboardingAuth: (id: string, action: 'retry' | 'skip_twitter' | 'skip_reddit' | 'abort' | boolean) => ipcRenderer.send('onboarding:retryAuth', { id, action }),
  onOnboardingAuthRequired: (cb: (payload: { id: string; twitter: { needed: boolean; ok: boolean; username?: string; name?: string }; reddit: { needed: boolean; ok: boolean; username?: string; name?: string }; canSkipTwitter?: boolean; canSkipReddit?: boolean; canProceedPartial?: boolean }) => void) =>
    ipcRenderer.on('onboarding:authRequired', (_e, payload) => cb(payload)),

  chatSend: (messages: any[], options?: { model?: string; effort?: string }, sessionId?: number) => ipcRenderer.invoke('chat:send', messages, options, sessionId),
  chatInject: (payload: any, sessionId?: number) => ipcRenderer.invoke('chat:inject', payload, sessionId),
  chatStop: (sessionId?: number) => ipcRenderer.invoke('chat:stop', sessionId),
  onChatQuestion: (cb: (q: { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[] }) => void) =>
    ipcRenderer.on('chat:question', (_e, q) => cb(q)),
  sendChatAnswer: (id: string, answer: string | string[]) => ipcRenderer.send('chat:answer', { id, answer }),
  createSession: () => ipcRenderer.invoke('chat:createSession'),
  getSessions: () => ipcRenderer.invoke('chat:getSessions'),
  getMessages: (sessionId: number) => ipcRenderer.invoke('chat:getMessages', sessionId),
  addMessage: (sessionId: number, role: string, content: string, reasoning?: string, toolCallsJson?: string, attachmentsJson?: string) => ipcRenderer.invoke('chat:addMessage', sessionId, role, content, reasoning, toolCallsJson, attachmentsJson),
  updateSessionTitle: (sessionId: number, title: string) => ipcRenderer.invoke('chat:updateTitle', sessionId, title),
  deleteSession: (sessionId: number) => ipcRenderer.invoke('chat:deleteSession', sessionId),
  generateTitle: (sessionId: number, messages: { role: string; content: string }[]) => ipcRenderer.invoke('chat:generateTitle', sessionId, messages),
  generateSummary: (sessionId: number, messages: { role: string; content: string }[]) => ipcRenderer.invoke('chat:generateSummary', sessionId, messages),
  getSessionSummary: (sessionId: number) => ipcRenderer.invoke('chat:getSessionSummary', sessionId),
  reTitle: (sessionId: number, messages: { role: string; content: string }[]) => ipcRenderer.invoke('chat:reTitle', sessionId, messages),
  generateQuickActions: () => ipcRenderer.invoke('chat:generateQuickActions'),
  getMedia: (filename: string) => ipcRenderer.invoke('get:media', filename),
  fetchLinkPreview: (url: string) => ipcRenderer.invoke('link:preview', url),
  onChatChunk: (cb: (data: { text: string; sessionId: number }) => void) => {
    const listener = (_e: any, text: any) => cb(text)
    ipcRenderer.on('chat:chunk', listener)
    return () => { ipcRenderer.off('chat:chunk', listener) }
  },
  onChatToolCall: (cb: (data: { name: string; args: any; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:toolCall', listener)
    return () => { ipcRenderer.off('chat:toolCall', listener) }
  },
  onChatToolResult: (cb: (data: { name: string; result: any; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:toolResult', listener)
    return () => { ipcRenderer.off('chat:toolResult', listener) }
  },
  onChatError: (cb: (data: { error: string; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:error', listener)
    return () => { ipcRenderer.off('chat:error', listener) }
  },
  onChatReasoning: (cb: (data: { text: string; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:reasoning', listener)
    return () => { ipcRenderer.off('chat:reasoning', listener) }
  },
  onChatTransientRetry: (cb: (info: { attempt: number; maxAttempts: number; backoffMs: number; model: string; sessionId: number }) => void) => {
    const listener = (_e: any, info: any) => cb(info)
    ipcRenderer.on('chat:transientRetry', listener)
    return () => { ipcRenderer.off('chat:transientRetry', listener) }
  },
  onChatInjected: (cb: (data: { messages: any[]; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:injected', listener)
    return () => { ipcRenderer.off('chat:injected', listener) }
  },
  onChatModelSwitch: (cb: (data: { model: string; sessionId: number }) => void) => {
    const listener = (_e: any, data: any) => cb(data)
    ipcRenderer.on('chat:modelSwitch', listener)
    return () => { ipcRenderer.off('chat:modelSwitch', listener) }
  },

  getTier: () => ipcRenderer.invoke('api:getTier'),
  getAvailableModels: () => ipcRenderer.invoke('api:getAvailableModels'),
  getDefaultModel: () => ipcRenderer.invoke('api:getDefaultModel'),
  getSelectedModel: () => ipcRenderer.invoke('api:getSelectedModel'),
  setSelectedModel: (model: string) => ipcRenderer.invoke('api:setSelectedModel', model),
  getApiKeys: (provider?: string) => ipcRenderer.invoke('api:getApiKeys', provider),
  addApiKey: (apiKey: string, provider?: string) => ipcRenderer.invoke('api:addApiKey', apiKey, provider),
  removeApiKey: (id: number) => ipcRenderer.invoke('api:removeApiKey', id),
  getModelExhaustionStatus: (model: string) => ipcRenderer.invoke('api:getModelExhaustionStatus', model),
  detectApiTier: (force?: boolean) => ipcRenderer.invoke('api:detectTier', force),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
