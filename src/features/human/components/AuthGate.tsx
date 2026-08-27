import { Loader2, ShieldAlert } from 'lucide-react'
import { openExternalUrl } from 'src/lib/utils'

interface AuthGateProps {
  /** Headline, e.g. "Log in to x.com to see your bookmarks". */
  title?: string
  onRecheck: () => void | Promise<void>
  checking?: boolean
}

/**
 * Inline auth prompt shown when a Human surface reports an auth error. Offers
 * browser login + a session re-check (which re-runs `twitter status`).
 */
export function AuthGate({ title = 'Log in to x.com', onRecheck, checking = false }: AuthGateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center" role="alert">
      <ShieldAlert className="size-10 text-zinc-700 stroke-1" />
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-zinc-500">
          Open x.com in your browser and sign in — Soxial picks up the session from your browser
          cookies automatically. On macOS over SSH you may need to run{' '}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-zinc-400">
            security unlock-keychain
          </code>{' '}
          first.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => openExternalUrl('https://x.com/login')}
          className="rounded-full bg-[#1d9bf0] px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#1a8cd8]"
        >
          Log in to x.com
        </button>
        <button
          onClick={() => void onRecheck()}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] px-4 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
        >
          {checking && <Loader2 className="size-3 animate-spin" />}
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>
    </div>
  )
}
