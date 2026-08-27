interface Window {
  api: {
    platform: string
    getProfile: () => Promise<any>
    updateProfile: (data: Record<string, any>) => Promise<any>
    getScheduledPosts: () => Promise<any[]>
    deleteScheduledPost: (id: number) => Promise<boolean>
    createBackup: () => Promise<import('./backup').BackupMetadata>
    listBackups: () => Promise<import('./backup').BackupListItem[]>
    restoreBackup: (fileName: string) => Promise<import('./backup').BackupMetadata>
    exportData: (includeMedia?: boolean) => Promise<import('./backup').ExportResult | { canceled: true }>
    previewTwitterHandleRebuild: (handle: string) => Promise<{ handle: string; activeTwitterScheduledPostCount: number }>
    startTwitterHandleRebuild: (handle: string, previewCount: number) => Promise<{ success: boolean; profile: any; archivedCount: number }>
    onTwitterHandleRebuildProgress: (cb: (event: { phase: string; message?: string; name?: string; args?: unknown; result?: unknown; text?: string; model?: string }) => void) => () => void
    checkCli: (name: 'twitter' | 'rdt') => Promise<any>
    installCli: (name: 'twitter' | 'rdt') => Promise<any>
    checkCliAuth: (name: 'twitter' | 'rdt') => Promise<any>
    twitterTweet: (tweetId: string, max?: number) => Promise<any>
    redditRead: (postId: string, maxComments?: number) => Promise<any>
    humanFeed: (request: import('../features/human/types').HumanFeedRequest) => Promise<import('../features/human/types').HumanResult<import('../features/human/types').Paginated<import('../features/human/types').HumanTweet>>>
    humanVerifySession: () => Promise<import('../features/human/types').HumanSessionResult>
    humanProfile: () => Promise<import('../features/human/types').HumanResult<import('../features/human/types').HumanUser>>
    humanProfilePosts: (request: import('../features/human/types').HumanProfilePostsRequest) => Promise<import('../features/human/types').HumanResult<import('../features/human/types').Paginated<import('../features/human/types').HumanTweet>>>
    humanBookmarks: (request: import('../features/human/types').HumanBookmarksRequest) => Promise<import('../features/human/types').HumanResult<import('../features/human/types').Paginated<import('../features/human/types').HumanTweet>>>
    humanFollowList: (request: import('../features/human/types').HumanFollowListRequest) => Promise<import('../features/human/types').HumanResult<import('../features/human/types').Paginated<import('../features/human/types').HumanUser>>>
    humanFollowAction: (request: { handle: string; action: 'follow' | 'unfollow' }) => Promise<import('../features/human/types').HumanFollowActionResult>
    prepareOnboarding: () => Promise<{ runId: string }>
    runOnboarding: (profileData: Record<string, any>, continueFromMessages?: any[], runId?: string) => Promise<any>
    resumeOnboarding: (runId: string) => Promise<any>
    onOnboardingEvent: (cb: (event: unknown) => void) => () => void
    getOnboardingResume: () => Promise<{ runId: string; phase: string; status: string; checkpointJson: string } | null>
    checkpointOnboarding: (runId: string, phase: 'gather' | 'interview', messages: any[], pendingQuestion?: { batchId: string; questionIds: string[] }) => Promise<{ success: boolean }>
    cancelOnboarding: (runId: string) => Promise<{ success: boolean; error?: string }>
    pauseOnboarding: (runId: string) => Promise<{ success: boolean; error?: string }>
    resetOnboarding: () => Promise<any>
    getStrategyRunId: () => Promise<{ runId?: string | null }>
    getStrategyDraft: (runId: string) => Promise<{ success: boolean; runId?: string; version?: number; status?: string; draft?: any; error?: string }>
    updateDraftSection: (runId: string, expectedVersion: number, section: string, payload: any) => Promise<{ success: boolean; version?: number; error?: string; code?: string }>
    regenerateDraftSection: (runId: string, expectedVersion: number, section: string) => Promise<{ success: boolean; version?: number; error?: string; code?: string }>
    commitStrategy: (runId: string, expectedVersion: number) => Promise<{ success: boolean; alreadyCommitted?: boolean; error?: string; code?: string; missing?: string[] }>
    discardStrategyDraft: (runId: string) => Promise<{ success: boolean; error?: string }>
    getEnrichmentStatus: (runId: string) => Promise<{ success: boolean; runId?: string; job?: any; readiness?: string }>
    retryEnrichment: (runId: string) => Promise<{ success: boolean; error?: string; code?: string }>
    onEnrichmentEvent: (cb: (event: unknown) => void) => () => void
    cancelEnrichment: (runId: string) => Promise<{ success: boolean }>
    sendOnboardingAnswer: (id: string, answers: { id: string; answer: string | string[] }[]) => void
    saveOnboardingConversation: (messages: { role: string; content: string; steps?: any[] }[]) => Promise<number>
    retryOnboardingAuth: (id: string, action: 'retry' | 'skip_twitter' | 'skip_reddit' | 'abort' | boolean) => void
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
    onPuterAuthEvent: (cb: (event: import('./puter-auth-events').PuterAuthEvent) => void) => () => void
    puterAuthCancel: () => Promise<boolean>
    puterAuthOpen: () => Promise<boolean>
    onChatChunk: (cb: (data: { text: string; sessionId: number }) => void) => () => void
    onChatToolCall: (cb: (data: { name: string; args: any; sessionId: number }) => void) => () => void
    onChatToolResult: (cb: (data: { name: string; result: any; sessionId: number }) => void) => () => void
    onChatError: (cb: (data: { error: string; appError?: import('./app-error').AppError; sessionId: number }) => void) => () => void
    onChatReasoning: (cb: (data: { text: string; sessionId: number }) => void) => () => void
    onChatTransientRetry: (cb: (info: { attempt: number; maxAttempts: number; backoffMs: number; model: string; sessionId: number }) => void) => () => void
    onChatInjected: (cb: (data: { messages: any[]; sessionId: number }) => void) => () => void
    onChatModelSwitch: (cb: (data: { model: string; sessionId: number }) => void) => () => void
    getAvailableModels: () => Promise<string[]>
    getModelCatalog: () => Promise<Array<{ id: string; label: string }>>
    getDefaultModel: () => Promise<string>
    getSelectedModel: () => Promise<string | null>
    setSelectedModel: (model: string) => Promise<void>
    getAppMode: () => Promise<'agent' | 'human'>
    setAppMode: (mode: 'agent' | 'human') => Promise<void>
    getApiKeys: (provider?: string) => Promise<Array<{ id: number; name: string; api_key: string; provider: string; tier: string; is_active: number; created_at: string; last_used_at: string | null }>>
    addApiKey: (apiKey: string, provider?: string) => Promise<number>
    removeApiKey: (id: number) => Promise<void>
    getModelExhaustionStatus: (model: string) => Promise<{ exhausted: boolean; availableAt: string | null }>
    listCustomProviders: () => Promise<Array<{ id: number; name: string; baseUrl: string; models: Array<{ id: string; label: string }>; isActive: boolean; createdAt: string; hasKey: boolean; keyMasked: string | null }>>
    addCustomProvider: (input: { name: string; baseUrl: string; apiKey?: string; models: Array<{ id: string; label?: string } | string> }) => Promise<{ id: number }>
    updateCustomProvider: (id: number, patch: { name?: string; baseUrl?: string; apiKey?: string; models?: Array<{ id: string; label?: string } | string> }) => Promise<boolean>
    removeCustomProvider: (id: number) => Promise<boolean>
    testCustomProvider: (input: { baseUrl?: string; apiKey?: string; model?: string; providerId?: number }) => Promise<{ ok: boolean; sample?: string; error?: string }>
    verifyCredentials: (request: {
      google?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
      zhipu?: { primary?: string; additional?: string[]; storedKeyIds?: number[]; codingPlan?: boolean }
      openai?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
      anthropic?: { primary?: string; additional?: string[]; storedKeyIds?: number[] }
    }) => Promise<{
      ok: boolean
      message: string
      results: Array<{
        provider: 'google' | 'zhipu' | 'openai' | 'anthropic'
        slot: 'primary' | 'additional' | 'stored'
        index?: number
        id?: number
        valid: boolean
        code: 'VALID' | 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'MODEL_UNAVAILABLE' | 'UNKNOWN_ERROR'
        message: string
        masked: string | null
      }>
    }>
    removeAllListeners: (channel: string) => void
  }
}
