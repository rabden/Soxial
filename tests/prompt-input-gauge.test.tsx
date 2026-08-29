/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * Context ring (ticket #59 + follow-up): a small circular progress indicator
 * toward the flat 180k compaction line beside the attach button — stroke
 * muted under 70%, amber to the 85% mark, red past it; percent inside the
 * ring; absent when there is no snapshot.
 */
import { PromptInput } from '../src/components/ui/prompt-input'

const LINE = 180_000

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
})

function renderRing(usedTokens: number, compactsAtTokens = LINE, compacted = false) {
  return render(
    <PromptInput
      models={['gemini-3.5-flash-lite']}
      contextState={{ usedTokens, compactsAtTokens, compacted }}
    />,
  )
}

describe('context ring', () => {
  it('renders progress toward the compaction line', () => {
    renderRing(75_600) // 42% of 180k
    expect(screen.getByTestId('context-gauge-percent').textContent).toBe('42')
  })

  it('caps the display at 100 past the line', () => {
    renderRing(250_000)
    expect(screen.getByTestId('context-gauge-percent').textContent).toBe('100')
  })

  it('is muted under the 70% watch line', () => {
    renderRing(90_000) // 50%
    expect(screen.getByTestId('context-gauge-ring').getAttribute('class')).toContain('stroke-foreground/30')
  })

  it('turns amber between 70% and the 85% mark of the line', () => {
    renderRing(140_000) // ~78%
    expect(screen.getByTestId('context-gauge-ring').getAttribute('class')).toContain('stroke-amber-400/80')
  })

  it('turns red past the 85% mark of the line', () => {
    renderRing(170_000) // ~94%
    expect(screen.getByTestId('context-gauge-ring').getAttribute('class')).toContain('stroke-red-400/80')
  })

  it('fills the stroke proportionally to usage', () => {
    renderRing(90_000) // 50% of 180k
    const ring = screen.getByTestId('context-gauge-ring')
    const dasharray = Number(ring.getAttribute('strokeDasharray'))
    const offset = Number(ring.getAttribute('strokeDashoffset'))
    expect(offset).toBeCloseTo(dasharray * 0.5, 0)
  })

  it('mentions compacted history and the compaction line in the tooltip', () => {
    renderRing(10_000, LINE, true)
    const title = screen.getByTestId('context-gauge').getAttribute('title')
    expect(title).toContain('180k compaction line')
    expect(title).toContain('compacted history')
  })

  it('is absent when there is no token snapshot', () => {
    render(<PromptInput models={['gemini-3.5-flash-lite']} contextState={null} />)
    expect(screen.queryByTestId('context-gauge')).toBeNull()
  })
})
