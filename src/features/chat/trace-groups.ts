import type { StepItem } from './types'
import { toSentences } from 'src/lib/trace-text'
import type { TraceNode } from 'src/lib/agent-trace-types'

/**
 * A message body split into renderable segments: collapsible agent traces
 * (reasoning + tool calls), markdown text, and interactive question rows,
 * in original step order.
 */
export type TraceSegment =
  | { kind: 'trace'; key: number; nodes: TraceNode[]; settled: boolean }
  | { kind: 'text'; key: number; text: string }
  | { kind: 'question'; key: number; step: Extract<StepItem, { type: 'question' }> }

export interface GroupOptions {
  /** Augment tool nodes (e.g. attach a custom expanded-body renderer). */
  decorateTool?: (node: TraceNode, step: Extract<StepItem, { type: 'tool' }>) => TraceNode
}

export function groupStepsIntoSegments(steps: StepItem[], options?: GroupOptions): TraceSegment[] {
  const segments: TraceSegment[] = []
  let traceBuffer: TraceNode[] = []
  let keyCounter = 0

  const flushTrace = (settled: boolean) => {
    if (traceBuffer.length > 0) {
      // A trace settles as soon as anything else follows it (text or question):
      // it collapses while the agent keeps working on the next part.
      segments.push({ kind: 'trace', key: keyCounter++, nodes: traceBuffer, settled })
      traceBuffer = []
    }
  }

  for (const step of steps) {
    if (step.type === 'reasoning') {
      const node: TraceNode = { type: 'reasoning', sentences: toSentences(step.text) }
      traceBuffer.push(node)
    } else if (step.type === 'tool') {
      let node: TraceNode = {
        type: 'tool',
        toolName: step.name,
        args: step.args,
        result: step.result,
        status: step.status === 'calling' ? 'running' : 'completed',
      }
      if (options?.decorateTool) node = options.decorateTool(node, step)
      traceBuffer.push(node)
    } else if (step.type === 'question') {
      flushTrace(true)
      segments.push({ kind: 'question', key: keyCounter++, step })
    } else if (step.type === 'text') {
      const hasText = step.text.trim().length > 0
      flushTrace(hasText)
      if (hasText) segments.push({ kind: 'text', key: keyCounter++, text: step.text })
    }
  }
  flushTrace(false)

  return segments
}
