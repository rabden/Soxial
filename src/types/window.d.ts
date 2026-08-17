interface Window {
  api: {
    platform: string
    getProfile: () => Promise<any>
    updateProfile: (data: Record<string, any>) => Promise<any>
    dbQuery: (table: string, where?: string, params?: any[]) => Promise<any>
    dbInsert: (table: string, data: Record<string, any>) => Promise<any>
    dbDelete: (table: string, id: number) => Promise<boolean>
    previewTwitterHandleRebuild: (handle: string) => Promise<{ handle: string; activeTwitterScheduledPostCount: number }>
    startTwitterHandleRebuild: (handle: string, previewCount: number) => Promise<{ success: boolean; profile: any; archivedCount: number }>
    onTwitterHandleRebuildProgress: (cb: (event: { phase: string; message?: string; name?: string; args?: unknown; result?: unknown; text?: string; model?: string }) => void) => () => void
    checkCli: (name: 'twitter' | 'rdt') => Promise<any>
    installCli: (name: 'twitter' | 'rdt') => Promise<any>
    checkCliAuth: (name: 'twitter' | 'rdt') => Promise<any>
    twitterTweet: (tweetId: string, max?: number) => Promise<any>
    redditRead: (postId: string, maxComments?: number) => Promise<any>
    runOnboarding: (profileData: Record<string, any>, continueFromMessages?: any[]) => Promise<any>
    resetOnboarding: () => Promise<any>
    onOnboardingChunk: (cb: (text: string) => void) => void
    onOnboardingToolCall: (cb: (data: { name: string, args: any }) => void) => void
    onOnboardingToolResult: (cb: (data: { name: string, result: any }) => void) => void
    onOnboardingReasoning: (cb: (text: string) => void) => void
    onOnboardingTransientRetry: (cb: (info: { attempt: number; maxAttempts: number; backoffMs: number; model: string }) => void) => void
    onOnboardingQuestion: (cb: (payload: { batchId: string; questions: { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[] }[] }) => void) => void
    sendOnboardingAnswer: (id: string, answers: { id: string; answer: string | string[] }[]) => void
    saveOnboardingConversation: (messages: { role: string; content: string; steps?: any[] }[]) => Promise<number>
    retryOnboardingAuth: (id: string, action: 'retry' | 'skip_twitter' | 'skip_reddit' | 'abort' | boolean) => void
    onOnboardingAuthRequired: (cb: (payload: {
      id: string
      twitter: { needed: boolean; ok: boolean; username?: string; name?: string }
      reddit: { needed: boolean; ok: boolean; username?: string; name?: string }
      canSkipTwitter?: boolean
      canSkipReddit?: boolean
      canProceedPartial?: boolean
    }) => void) => void
    chatSend: (messages: any[], options?: { model?: string; effort?: string }, sessionId?: number) => Promise<any>
    chatInject: (payload: any, sessionId?: number) => Promise<any>
    chatStop: (sessionId?: number) => Promise<any>
    onChatQuestion: (cb: (q: { id: string; text: string; type: 'single' | 'multi' | 'text'; options?: string[]; sessionId: number }) => void) => () => void
    sendChatAnswer: (id: string, answer: string | string[]) => void
    createSession: () => Promise<number>
    getSessions: () => Promise<any[]>
    getMessages: (sessionId: number) => Promise<any[]>
    addMessage: (sessionId: number, role: string, content: string, reasoning?: string, toolCallsJson?: string, attachmentsJson?: string) => Promise<number>
    updateSessionTitle: (sessionId: number, title: string) => Promise<any>
    deleteSession: (sessionId: number) => Promise<any>
    generateTitle: (sessionId: number, messages: { role: string; content: string | null }[]) => Promise<any>
    generateSummary: (sessionId: number, messages: { role: string; content: string | null }[]) => Promise<any>
    getSessionSummary: (sessionId: number) => Promise<string | null>
    reTitle: (sessionId: number, messages: { role: string; content: string | null }[]) => Promise<any>
    generateQuickActions: () => Promise<any>
    getMedia: (filename: string) => Promise<any>
    fetchLinkPreview: (url: string) => Promise<any>
    onChatChunk: (cb: (data: { text: string; sessionId: number }) => void) => () => void
    onChatToolCall: (cb: (data: { name: string; args: any; sessionId: number }) => void) => () => void
    onChatToolResult: (cb: (data: { name: string; result: any; sessionId: number }) => void) => () => void
    onChatError: (cb: (data: { error: string; sessionId: number }) => void) => () => void
    onChatReasoning: (cb: (data: { text: string; sessionId: number }) => void) => () => void
    onChatTransientRetry: (cb: (info: { attempt: number; maxAttempts: number; backoffMs: number; model: string; sessionId: number }) => void) => () => void
    onChatInjected: (cb: (data: { messages: any[]; sessionId: number }) => void) => () => void
    onChatModelSwitch: (cb: (data: { model: string; sessionId: number }) => void) => () => void
    getTier: () => Promise<{ tier: string }>
    getAvailableModels: () => Promise<string[]>
    getDefaultModel: () => Promise<string>
    getSelectedModel: () => Promise<string | null>
    setSelectedModel: (model: string) => Promise<void>
    getApiKeys: (provider?: string) => Promise<Array<{ id: number; name: string; api_key: string; provider: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }>>
    addApiKey: (apiKey: string, provider?: string) => Promise<number>
    removeApiKey: (id: number) => Promise<void>
    getModelExhaustionStatus: (model: string) => Promise<{ exhausted: boolean; availableAt: string | null }>
    detectApiTier: (force?: boolean) => Promise<'free' | 'pro'>
    removeAllListeners: (channel: string) => void
  }
}
