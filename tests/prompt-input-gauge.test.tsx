/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * Context gauge (ticket #59): the prompt bar shows progress toward the flat
 * 180k compaction line with threshold-colored state — muted under 70%, amber
 * to the 85% mark, red past it. Absent when there is no snapshot.
 */
import { PromptInput } from '../src/components/ui/prompt-input'

const LINE = 180_000

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
})

function renderGauge(usedTokens: number, compactsAtTokens = LINE, compacted = false) {
  return render(
    <PromptInput
      models={['gemini-3.5-flash-lite']}
      contextState={{ usedTokens, compactsAtTokens, compacted }}
    />,
  )
}

describe('context gauge', () => {
  it('renders progress toward the compaction line', () => {
    renderGauge(75_600) // 42% of 180k
    expect(screen.getByTestId('context-gauge').textContent).toContain('42%')
  })

  it('is muted under the 70% watch line', () => {
    renderGauge(90_000) // 50%
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-foreground/30')
  })

  it('turns amber between 70% and the 85% mark of the line', () => {
    renderGauge(140_000) // ~78%
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-amber-400/80')
  })

  it('turns red past the 85% mark of the line', () => {
    renderGauge(170_000) // ~94%
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-red-400/80')
  })

  it('mentions compacted history and the compaction line in the tooltip', () => {
    renderGauge(10_000, LINE, true)
    const title = screen.getByTestId('context-gauge').getAttribute('title')
    expect(title).toContain('180k compaction line')
    expect(title).toContain('compacted history')
  })

  it('is absent when there is no token snapshot', () => {
    render(<PromptInput models={['gemini-3.5-flash-lite']} contextState={null} />)
    expect(screen.queryByTestId('context-gauge')).toBeNull()
  })
})
