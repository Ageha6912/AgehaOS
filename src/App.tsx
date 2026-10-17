import { useEffect } from 'react'

import { Desktop } from '@/desktop/Desktop'
import { BootScreen } from '@/desktop/boot/BootScreen'
import { LoginScreen } from '@/desktop/login/LoginScreen'
import { MobileShell } from '@/mobile/MobileShell'
import { useBootStore } from '@/store/boot-store'
import { useDeviceStore } from '@/store/device-store'
import { useSessionStore } from '@/store/session-store'
import { systemSounds } from '@/services/sounds'

export default function App() {
  const phase = useBootStore((state) => state.phase)
  const layerExitDone = useBootStore((state) => state.layerExitDone)
  const setPhase = useBootStore((state) => state.setPhase)
  const status = useSessionStore((state) => state.status)
  // Shell Selection（M0-2）：手机与平板渲染 MobileShell（裁决：tablet 同壳），
  // 其余渲染 Desktop；判定集中在 device-store，App 只读派生结果。
  const shell = useDeviceStore((state) => state.shell)

  // Signing out from the desktop returns to the login screen (PRD §24.1).
  useEffect(() => {
    if (phase === 'ready' && status === 'anonymous') setPhase('login')
  }, [phase, status, setPhase])

  const booting = phase === 'booting' || phase === 'loading'

  return (
    <div className="h-full">
      {booting ? null : phase === 'ready' ? (
        shell === 'mobile' ? <MobileShell /> : <Desktop />
      ) : (
        <>
          {/* 登录成功 = A 大调三音开机音（点击提交是用户手势，自动播放策略放行）。 */}
          <LoginScreen
            onSuccess={() => {
              systemSounds.play('boot')
              setPhase('ready')
            }}
          />
        </>
      )}
      {/* 开机覆盖层（DESIGN.md §11）：finishBoot 后目的界面先挂载在下层，
          覆盖层继续播退场动画，收尾（layerExitDone）后卸载。 */}
      {booting || !layerExitDone ? <BootScreen /> : null}
    </div>
  )
}
