import { useEffect } from 'react'

import { Desktop } from '@/desktop/Desktop'
import { BootScreen } from '@/desktop/boot/BootScreen'
import { LoginScreen } from '@/desktop/login/LoginScreen'
import { useBootStore } from '@/store/boot-store'
import { useSessionStore } from '@/store/session-store'

export default function App() {
  const phase = useBootStore((state) => state.phase)
  const layerExitDone = useBootStore((state) => state.layerExitDone)
  const setPhase = useBootStore((state) => state.setPhase)
  const status = useSessionStore((state) => state.status)

  // Signing out from the desktop returns to the login screen (PRD §24.1).
  useEffect(() => {
    if (phase === 'ready' && status === 'anonymous') setPhase('login')
  }, [phase, status, setPhase])

  const booting = phase === 'booting' || phase === 'loading'

  return (
    <div className="h-full">
      {booting ? null : phase === 'ready' ? (
        <Desktop />
      ) : (
        <LoginScreen onSuccess={() => setPhase('ready')} />
      )}
      {/* 开机覆盖层（DESIGN.md §11）：finishBoot 后目的界面先挂载在下层，
          覆盖层继续播退场动画，收尾（layerExitDone）后卸载。 */}
      {booting || !layerExitDone ? <BootScreen /> : null}
    </div>
  )
}
