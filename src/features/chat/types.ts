import type { ChatAttachment } from './attachments'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  steps?: StepItem[]
  isToolAnswer?: boolean
  attachments?: ChatAttachment[]
  /** Turn never finalized (crash/close mid-turn) — step-boundary persistence (ticket #68). */
  interrupted?: boolean
}

export type StepItem =
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; id: number; name: string; args: any; result?: any; status: 'calling' | 'complete' }
  | { type: 'text'; text: string }
  | {
      type: 'question'
      id: string
      text: string
      qtype: 'single' | 'multi' | 'text'
      options?: string[]
      answer?: string | string[]
      status: 'asking' | 'answered'
    }

export type ApiMessage = {
  role: string
  content: string | null
  parts?: {
    text?: string
    inlineData?: { mimeType: string; data: string }
  }[]
  tool_call_id?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

export interface SessionState {
  messages: ChatMessage[]
  streaming: boolean
  streamText: string
  steps: StepItem[]
  stepCounter: number
  pendingQuestion: {
    id: string
    text: string
    type: 'single' | 'multi' | 'text'
    options?: string[]
  } | null
  transientRetry: { attempt: number; maxAttempts: number; backoffMs: number; model: string } | null
  status: 'idle' | 'running' | 'completed-unread' | 'question-unread' | 'error-unread'
}

export function createSessionState(messages: ChatMessage[] = []): SessionState {
  return {
    messages,
    streaming: false,
    streamText: '',
    steps: [],
    stepCounter: 0,
    pendingQuestion: null,
    transientRetry: null,
    status: 'idle',
  }
}
