import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string | null
}

// ponytail: minimal error boundary. Catches render crashes in the wrapped subtree
// and shows a fallback + Retry instead of white-screening the app.
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.name ? `VIEW_${error.name.toUpperCase()}` : 'VIEW_RENDER_FAILED' }
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught', error?.name || 'unknown')
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="flex flex-col items-center text-center max-w-sm">
            <p className="text-sm text-foreground/80 mb-1">Something broke in this view.</p>
            <p className="text-xs text-muted-foreground/50 mb-6 break-words">{this.state.message}</p>
            <button
              onClick={this.handleRetry}
              className="group flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="size-3.5" strokeWidth={2} />
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
