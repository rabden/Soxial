// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * Context gauge (ticket #59): the prompt bar shows the session's live
 * context share with threshold-colored state — muted under 70%, amber to
 * the 85% compaction line, red past it. Absent when there is no snapshot.
 */
import { PromptInput } from '../src/components/ui/prompt-input'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
})

function renderGauge(usedTokens: number, usableTokens = 100_000, compacted = false) {
  return render(
    <PromptInput
      models={['gemini-3.5-flash-lite']}
      contextState={{ usedTokens, usableTokens, compacted }}
    />,
  )
}

describe('context gauge', () => {
  it('renders the usage share of the usable window', () => {
    renderGauge(42_000, 100_000)
    expect(screen.getByTestId('context-gauge').textContent).toContain('42%')
  })

  it('is muted under the 70% watch line', () => {
    renderGauge(50_000, 100_000)
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-foreground/30')
  })

  it('turns amber between 70% and the 85% compaction line', () => {
    renderGauge(75_000, 100_000)
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-amber-400/80')
  })

  it('turns red past the 85% compaction line', () => {
    renderGauge(92_000, 100_000)
    expect(screen.getByTestId('context-gauge-dot').className).toContain('bg-red-400/80')
  })

  it('mentions compacted history in the tooltip when flagged', () => {
    renderGauge(10_000, 100_000, true)
    expect(screen.getByTestId('context-gauge').getAttribute('title')).toContain('compacted history')
  })

  it('is absent when there is no token snapshot', () => {
    render(<PromptInput models={['gemini-3.5-flash-lite']} contextState={null} />)
    expect(screen.queryByTestId('context-gauge')).toBeNull()
  })
})
