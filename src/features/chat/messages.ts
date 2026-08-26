import type { ApiMessage, ChatMessage, StepItem } from './types'

/**
 * Rebuilds the StepItem timeline from persisted message columns.
 * Returns the bare steps array; the writer stores the v2 envelope
 * `{ version: 2, steps }` and this reader deliberately accepts it while
 * also tolerating the legacy formats (plain reasoning string, bare
 * StepItem[] JSON).
 */
export function parseSteps(
  reasoningRaw: string | null | undefined,
  toolCallsRaw: string | null | undefined,
): StepItem[] | undefined {
  if (!reasoningRaw && !toolCallsRaw) return undefined

  const steps: StepItem[] = []

  const take = (parsed: any): boolean => {
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && parsed[0]?.type) {
        steps.push(...(parsed as StepItem[]))
      } else {
        for (const seg of parsed) {
          steps.push({ type: 'reasoning', text: seg?.text || seg })
        }
      }
      return true
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) {
      steps.push(...parsed.steps)
      return true
    }
    return false
  }

  if (reasoningRaw) {
    try {
      if (!take(JSON.parse(reasoningRaw))) {
        steps.push({ type: 'reasoning', text: reasoningRaw })
      }
    } catch {
      steps.push({ type: 'reasoning', text: reasoningRaw })
    }
  }
  if (toolCallsRaw) {
    try {
      take(JSON.parse(toolCallsRaw))
    } catch {
      // tolerate malformed tool-call payloads; keep whatever parsed so far
    }
  }

  if (steps.length === 0) return undefined
  return steps
}

export function buildApiMessages(messages: ChatMessage[]): ApiMessage[] {
  const result: ApiMessage[] = []
  for (const message of messages) {
    if (message.isToolAnswer) continue
    if (message.role === 'user') {
      const parts: NonNullable<ApiMessage['parts']> = []
      if (message.content.trim()) parts.push({ text: message.content })
      for (const attachment of message.attachments || []) {
        parts.push({
          inlineData: {
            mimeType: attachment.mimeType || 'image/png',
            data: attachment.dataUrl.split(',')[1] || '',
          },
        })
      }
      result.push({ role: 'user', content: message.content, parts: parts.length ? parts : undefined })
      continue
    }

    const toolSteps = message.steps?.filter(
      (step): step is StepItem & { type: 'tool' } => step.type === 'tool',
    ) ?? []
    if (toolSteps.length === 0) {
      result.push({ role: 'assistant', content: message.content })
      continue
    }

    result.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: toolSteps.map(step => ({
        id: String(step.id),
        type: 'function' as const,
        function: { name: step.name, arguments: JSON.stringify(step.args) },
      })),
    })
    for (const step of toolSteps) {
      result.push({
        role: 'tool',
        tool_call_id: String(step.id),
        content: typeof step.result === 'string' ? step.result : JSON.stringify(step.result ?? ''),
      })
    }
  }
  return result
}
