import { useEffect, useRef, useState } from 'react'
import { ImageOff, X } from 'lucide-react'
import { Button } from './ui/button'
import type { PuterAuthEventStatus } from '../types/puter-auth-events'

/**
 * App-level notice shown while the main process waits on the browser-based
 * Puter sign-in. "Sign in" re-opens the browser tab if it didn't appear;
 * dismissing (X) keeps waiting — the user may still finish sign-in; "Cancel"
 * fails the pending image generation with an explicit result for the model.
 */
export default function PuterAuthBanner() {
  const [status, setStatus] = useState<PuterAuthEventStatus | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const off = window.api.onPuterAuthEvent((event) => {
      // A fresh event must kill any pending auto-dismiss, or a required card
      // arriving within 4s of a cancelled/completed one vanishes mid-sign-in.
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setStatus(event.status)
      setDetail(event.detail ?? null)
      setHidden(false)
      if (event.status !== 'required') { // completed AND cancelled auto-clear
        hideTimer.current = setTimeout(() => setStatus(null), 4000)
      }
    })
    return () => {
      off()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  if (!status || hidden) return null

  const cancel = () => {
    setHidden(true)
    window.api.puterAuthCancel()
  }

  const signIn = () => {
    void window.api.puterAuthOpen().then((ok) => {
      // No live sign-in flow left — the banner is stale, so retire it.
      if (!ok) setHidden(true)
    })
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card text-card-foreground shadow-lg">
      <div className="p-4">
        <div className="flex items-start gap-2.5">
          <ImageOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight">
              {status === 'completed' ? 'Signed in to Puter'
                : status === 'cancelled' ? 'Puter sign-in cancelled'
                : 'Puter sign-in required'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {status === 'completed' ? 'Image generation can continue.'
                : status === 'cancelled' ? 'No image was generated. Ask again to retry sign-in.'
                : 'Finish the sign-in in the opened browser tab to generate your image.'}
            </p>
            {status === 'required' && detail && (
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/80">{detail}</p>
            )}
          </div>
          <button
            aria-label="Dismiss"
            className="-mt-0.5 -mr-1 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setHidden(true)}
          >
            <X className="size-3.5" />
          </button>
        </div>
        {status === 'required' && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="flex-1" onClick={signIn}>
              Sign in
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={cancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
