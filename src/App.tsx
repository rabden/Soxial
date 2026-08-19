import { lazy, Suspense, useState, useEffect } from 'react'

const Onboarding = lazy(() => import('./components/Onboarding'))
const Chat = lazy(() => import('./components/Chat'))

export default function App() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
  const [initialSessionId, setInitialSessionId] = useState<number | null>(null)

  useEffect(() => {
    checkOnboarding()
  }, [])

  function checkOnboarding() {
    window.api.getProfile().then((p) => {
      setOnboardingComplete(p?.onboarding_complete === 1)
    })
  }

  if (onboardingComplete === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground/60 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground/60 text-sm animate-pulse">Loading workspace...</div>
      </div>
    }>
      {onboardingComplete ? <Chat initialSessionId={initialSessionId} /> : <Onboarding onComplete={(sessionId?: number) => { if (sessionId) setInitialSessionId(sessionId); checkOnboarding() }} />}
    </Suspense>
  )
}
