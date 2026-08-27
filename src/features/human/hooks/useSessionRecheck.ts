import { useCallback, useState } from 'react'

/**
 * Auth-gate Re-check: re-runs session verification and, when the session is
 * back, reloads the surface. Shared by every Human surface's AuthGate.
 */
export function useSessionRecheck(reload: () => void) {
  const [rechecking, setRechecking] = useState(false)

  const recheck = useCallback(async () => {
    setRechecking(true)
    try {
      const session = await window.api.humanVerifySession()
      if (session.ok && session.data.authenticated) reload()
    } finally {
      setRechecking(false)
    }
  }, [reload])

  return { recheck, rechecking }
}
