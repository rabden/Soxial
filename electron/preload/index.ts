import { contextBridge, ipcRenderer } from 'electron'
import type { PuterAuthEvent } from '../../src/types/puter-auth-events'
import type {
  HumanFeedRequest,
  HumanFollowListRequest,
  HumanProfilePostsRequest,
  HumanReplyDraftRequest,
  HumanSearchRequest,
} from '../../src/features/human/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  platform: process.platform,
  getProfile: () => ipcRenderer.invoke('db:getProfile'),
  updateProfile: (data: Record<string, any>) => ipcRenderer.invoke('db:updateProfile', data),
  getScheduledPosts: () => ipcRenderer.invoke('scheduledPosts:list'),
  deleteScheduledPost: (id: number) => ipcRenderer.invoke('scheduledPosts:delete', id),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (fileName: string) => ipcRenderer.invoke('backup:restore', fileName),
  exportData: (includeMedia?: boolean) => ipcRenderer.invoke('export:data', includeMedia),

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
  humanFeed: (request: HumanFeedRequest) => ipcRenderer.invoke('human:feed', request),
  humanVerifySession: () => ipcRenderer.invoke('human:verifySession'),
  humanProfile: () => ipcRenderer.invoke('human:profile'),
  humanProfilePosts: (request: HumanProfilePostsRequest) => ipcRenderer.invoke('human:profilePosts', request),
  humanBookmarks: (request: { count?: number }) => ipcRenderer.invoke('human:bookmarks', request),
  humanFollowList: (request: HumanFollowListRequest) => ipcRenderer.invoke('human:followList', request),
  humanFollowAction: (request: { handle: string; action: 'follow' | 'unfollow' }) =>
    ipcRenderer.invoke('human:followAction', request),
  humanLike: (request: { tweetId: string; action: 'like' | 'unlike' }) => ipcRenderer.invoke('human:like', request),
  humanRetweet: (request: { tweetId: string; action: 'retweet' | 'unretweet' }) => ipcRenderer.invoke('human:retweet', request),
  humanBookmark: (request: { tweetId: string; action: 'bookmark' | 'unbookmark' }) => ipcRenderer.invoke('human:bookmark', request),
  humanReply: (request: { tweetId: string; text: string; imagePaths?: string[] }) =>
    ipcRenderer.invoke('human:reply', request),
  /** One-shot AI reply draft for the Human composer (never posts). */
  humanReplyDraft: (request: HumanReplyDraftRequest) => ipcRenderer.invoke('human:replyDraft', request),
  /** Native multi-select image picker — resolves absolute paths in main. */
  pickReplyImages: () => ipcRenderer.invoke('dialog:pickImages'),
  /** Read a picked image as a data URL for <img> previews (≤5MB, jpg/png/gif/webp). */
  mediaDataUrl: (filePath: string) => ipcRenderer.invoke('media:dataUrl', filePath),
  humanSearch: (request: HumanSearchRequest) => ipcRenderer.invoke('human:search', request),

  prepareOnboarding: () => ipcRenderer.invoke('onboarding:prepare'),
  runOnboarding: (profileData: Record<string, any>, continueFromMessages?: any[], runId?: string) => ipcRenderer.invoke('onboarding:run', profileData, continueFromMessages, runId),
  resumeOnboarding: (runId: string) => ipcRenderer.invoke('onboarding:resume', runId),
  onOnboardingEvent: (cb: (event: unknown) => void) => subscribe('onboarding:event', cb),
  getOnboardingResume: () => ipcRenderer.invoke('onboarding:getResume'),
  checkpointOnboarding: (runId: string, phase: 'gather' | 'interview', messages: any[], pendingQuestion?: { batchId: string; questionIds: string[] }) =>
    ipcRenderer.invoke('onboarding:checkpoint', runId, phase, messages, pendingQuestion),
  cancelOnboarding: (runId: string) => ipcRenderer.invoke('onboarding:cancel', runId),
  pauseOnboarding: (runId: string) => ipcRenderer.invoke('onboarding:pause', runId),
  resetOnboarding: () => ipcRenderer.invoke('onboarding:reset'),

  // Plan 12: strategy review + commit.
  getStrategyRunId: () => ipcRenderer.invoke('profile:getStrategyRunId'),
  getStrategyDraft: (runId: string) => ipcRenderer.invoke('onboarding:getDraft', runId),
  updateDraftSection: (runId: string, expectedVersion: number, section: string, payload: any) =>
    ipcRenderer.invoke('onboarding:updateDraftSection', runId, expectedVersion, section, payload),
  regenerateDraftSection: (runId: string, expectedVersion: number, section: string) =>
    ipcRenderer.invoke('onboarding:regenerateSection', runId, expectedVersion, section),
  commitStrategy: (runId: string, expectedVersion: number) => ipcRenderer.invoke('onboarding:commitStrategy', runId, expectedVersion),
  discardStrategyDraft: (runId: string) => ipcRenderer.invoke('onboarding:discardDraft', runId),

  getEnrichmentStatus: (runId: string) => ipcRenderer.invoke('onboarding:getEnrichmentStatus', runId),
  retryEnrichment: (runId: string) => ipcRenderer.invoke('onboarding:retryEnrichment', runId),
  cancelEnrichment: (runId: string) => ipcRenderer.invoke('onboarding:cancelEnrichment', runId),
  onEnrichmentEvent: (cb: (event: unknown) => void) => subscribe('onboarding:enrichment:event', cb),
  sendOnboardingAnswer: (id: string, answers: { id: string; answer: string | string[] }[]) => ipcRenderer.send('onboarding:answer', { id, answers }),
  saveOnboardingConversation: (messages: { role: string; content: string; steps?: any[] }[]) => ipcRenderer.invoke('onboarding:saveConversation', messages),
  retryOnboardingAuth: (id: string, action: 'retry' | 'skip_twitter' | 'skip_reddit' | 'abort' | boolean) => ipcRenderer.send('onboarding:retryAuth', { id, action }),

  chatSend: (messages: any[], options?: { model?: string; effort?: string }, sessionId?: number) => ipcRenderer.invoke('chat:send', messages, options, sessionId),
  chatInject: (payload: any, sessionId?: number) => ipcRenderer.invoke('chat:inject', payload, sessionId),
  chatStop: (sessionId?: number) => ipcRenderer.invoke('chat:stop', sessionId),
  onChatQuestion: (cb: (q: { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[] }) => void) =>
    subscribe('chat:question', cb),
  sendChatAnswer: (id: string, answer: string | string[]) => ipcRenderer.send('chat:answer', { id, answer }),
  createSession: () => ipcRenderer.invoke('chat:createSession'),
  getSessions: () => ipcRenderer.invoke('chat:getSessions'),
  getMessages: (sessionId: number) => ipcRenderer.invoke('chat:getMessages', sessionId),
  addMessage: (sessionId: number, role: string, content: string, reasoning?: string, toolCallsJson?: string, attachmentsJson?: string) => ipcRenderer.invoke('chat:addMessage', sessionId, role, content, reasoning, toolCallsJson, attachmentsJson),
  finalizeAssistantMessage: (id: number, content: string, reasoning?: string) => ipcRenderer.invoke('chat:finalizeAssistantMessage', id, content, reasoning),
  updateSessionTitle: (sessionId: number, title: string) => ipcRenderer.invoke('chat:updateTitle', sessionId, title),
  deleteSession: (sessionId: number) => ipcRenderer.invoke('chat:deleteSession', sessionId),

  onSessionsChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('chat:sessionsChanged', listener)
    return () => { ipcRenderer.off('chat:sessionsChanged', listener) }
  },

  getSessionSummary: (sessionId: number) => ipcRenderer.invoke('chat:getSessionSummary', sessionId),
  contextState: (sessionId: number, model?: string) => ipcRenderer.invoke('chat:contextState', sessionId, model),
  generateQuickActions: () => ipcRenderer.invoke('chat:generateQuickActions'),
  getMedia: (filename: string) => ipcRenderer.invoke('get:media', filename),
  fetchLinkPreview: (url: string) => ipcRenderer.invoke('link:preview', url),
  onPuterAuthEvent: (cb: (event: PuterAuthEvent) => void) =>
    subscribe('puter:authEvent', cb),
  puterAuthCancel: () => ipcRenderer.invoke('puter:authCancel'),
  puterAuthOpen: () => ipcRenderer.invoke('puter:authOpen'),
  onChatChunk: (cb: (data: { text: string; sessionId: number }) => void) => {
    const listener = (_e: any, text: any) => cb(text)
    ipcRenderer.on('chat:chunk', listener)
    return () => { ipcRenderer.off('chat:chunk', listener) }
  },
  onChatContextTokens: (cb: (data: { sessionId: number; tokens: number; model: string; compactsAtTokens: number }) => void) => {
    const listener = (_e: any, payload: any) => cb(payload)
    ipcRenderer.on('chat:contextTokens', listener)
    return () => { ipcRenderer.off('chat:contextTokens', listener) }
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

  getAvailableModels: () => ipcRenderer.invoke('api:getAvailableModels'),
  getModelCatalog: () => ipcRenderer.invoke('api:getModelCatalog'),
  getDefaultModel: () => ipcRenderer.invoke('api:getDefaultModel'),
  getSelectedModel: () => ipcRenderer.invoke('api:getSelectedModel'),
  setSelectedModel: (model: string) => ipcRenderer.invoke('api:setSelectedModel', model),
  getAppMode: () => ipcRenderer.invoke('api:getAppMode'),
  setAppMode: (mode: 'agent' | 'human') => ipcRenderer.invoke('api:setAppMode', mode),
  getApiKeys: (provider?: string) => ipcRenderer.invoke('api:getApiKeys', provider),
  addApiKey: (apiKey: string, provider?: string) => ipcRenderer.invoke('api:addApiKey', apiKey, provider),
  removeApiKey: (id: number) => ipcRenderer.invoke('api:removeApiKey', id),
  getModelExhaustionStatus: (model: string) => ipcRenderer.invoke('api:getModelExhaustionStatus', model),
  listCustomProviders: () => ipcRenderer.invoke('providers:list'),
  addCustomProvider: (input: { name: string; baseUrl: string; apiKey?: string; models: Array<{ id: string; label?: string } | string> }) =>
    ipcRenderer.invoke('providers:addCustom', input),
  updateCustomProvider: (id: number, patch: { name?: string; baseUrl?: string; apiKey?: string; models?: Array<{ id: string; label?: string } | string> }) =>
    ipcRenderer.invoke('providers:updateCustom', id, patch),
  removeCustomProvider: (id: number) => ipcRenderer.invoke('providers:removeCustom', id),
  testCustomProvider: (input: { baseUrl?: string; apiKey?: string; model?: string; providerId?: number }) =>
    ipcRenderer.invoke('providers:testCustom', input),
  verifyCredentials: (request: {
    google?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
    zhipu?: { primary?: string; additional?: string[]; storedKeyIds?: number[]; codingPlan?: boolean }
    openai?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
    anthropic?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
  }) => ipcRenderer.invoke('api:verifyCredentials', request),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
