import { Copy, RefreshCw, Settings2, ShieldAlert } from 'lucide-react'
import type { AppError } from 'src/types/app-error'

interface Props {
  error: AppError
  onRetry?: () => void
  onSettings?: () => void
}

const actionLabels: Record<string, string> = {
  retry: 'Retry',
  resume: 'Resume',
  reauthenticate: 'Reconnect',
  'add-key': 'Add API key',
  'open-settings': 'Open settings',
  'change-model': 'Change model',
}

export function OperationalError({ error, onRetry, onSettings }: Props) {
  const action = error.action
  const canRetry = action === 'retry' || action === 'resume'
  const canOpenSettings = action === 'reauthenticate' || action === 'add-key' || action === 'open-settings' || action === 'change-model'

  const copyDiagnosticId = () => {
    void navigator.clipboard?.writeText(error.runId || error.code)
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/15 bg-red-500/5 px-4 py-3 text-xs">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-red-300">{error.message}</p>
        <p className="mt-1 text-red-300/50">
          {error.retryAfterMs ? `Try again in ${Math.ceil(error.retryAfterMs / 60000)} minutes. ` : ''}
          Diagnostic code: <code className="font-mono">{error.runId || error.code}</code>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canRetry && onRetry ? (
          <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 font-semibold text-background">
            <RefreshCw className="size-3" /> {actionLabels[action] || 'Retry'}
          </button>
        ) : null}
        {canOpenSettings && onSettings ? (
          <button onClick={onSettings} className="inline-flex items-center gap-1.5 rounded-full border border-red-300/15 px-3 py-1.5 font-semibold text-red-200">
            <Settings2 className="size-3" /> {actionLabels[action] || 'Settings'}
          </button>
        ) : null}
        <button onClick={copyDiagnosticId} aria-label="Copy diagnostic code" className="rounded-full p-1.5 text-red-300/60 hover:bg-red-300/10">
          <Copy className="size-3" />
        </button>
      </div>
    </div>
  )
}
