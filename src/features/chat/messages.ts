import type { ApiMessage, ChatMessage, StepItem } from './types'

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
