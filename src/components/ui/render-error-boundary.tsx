import { Component, type ReactNode } from 'react'

/**
 * Render-error containment for third-party-shaped content (tweet cards,
 * media, link previews). A single bad card must degrade to a small inline
 * fallback — never take the whole app down to a blank screen (the hooks-
 * order crash of 2026-08-30 did exactly that).
 */
interface RenderErrorBoundaryProps {
  /** Short label of what is being contained, e.g. 'tweet card'. */
  label?: string
  children: ReactNode
}

interface RenderErrorBoundaryState {
  error: Error | null
}

export class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  state: RenderErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RenderErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Console rather than the main logger: this is a renderer-side render fault.
    console.error('[render-error]', this.props.label ?? 'block', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="render-error-fallback"
          className="rounded-xl border border-destructive/30 bg-card p-3 text-xs text-muted-foreground"
        >
          <span className="font-semibold text-destructive">
            {this.props.label ? `Could not render ${this.props.label}` : 'Could not render this block'}
          </span>
          {this.state.error.message && (
            <span className="ml-1 opacity-70">({this.state.error.message.slice(0, 120)})</span>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
