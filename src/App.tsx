import { useEffect } from 'react'

import { Desktop } from '@/desktop/Desktop'
import { BootScreen } from '@/desktop/boot/BootScreen'
import { LoginScreen } from '@/desktop/login/LoginScreen'
import { useBootStore } from '@/store/boot-store'
import { useSessionStore } from '@/store/session-store'

export default function App() {
  const phase = useBootStore((state) => state.phase)
  const setPhase = useBootStore((state) => state.setPhase)
  const status = useSessionStore((state) => state.status)

  // Signing out from the desktop returns to the login screen (PRD §24.1).
  useEffect(() => {
    if (phase === 'ready' && status === 'anonymous') setPhase('login')
  }, [phase, status, setPhase])

  return (
    <div className="h-full">
      {phase === 'ready' ? (
        <Desktop />
      ) : phase === 'login' ? (
        <LoginScreen onSuccess={() => setPhase('ready')} />
      ) : (
        <BootScreen />
      )}
    </div>
  )
}
