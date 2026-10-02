import { useEffect, useRef } from 'react'

import { BrandLogo } from '@/components/brand-logo'
import { useTranslation } from '@/core/i18n'
import { useBootStore } from '@/store/boot-store'
import { useSessionStore } from '@/store/session-store'

import { createBootMotion } from './boot-motion'

/** 状态文案切换点：进度越过第一段（固件自检）后改报「加载系统资源」。 */
const ADVANCE_AT_PERCENT = 36

/**
 * Boot screen driven by the motion-lab boot engine (docs/DESIGN.md §11)：
 * rAF 四段变速进度 → 完成时按会话状态 finishBoot → 退场（淡出+放大）露出
 * 已挂载在下层的目的界面，收尾后由 App 按层退场标记卸载本层。
 * 进度直写 transform 绕过 React 渲染路径；回调经 store.getState() 取最新值，
 * 会话状态在开机期间才就绪也不会读到陈旧闭包。
 */
export function BootScreen() {
  const phase = useBootStore((state) => state.phase)
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const fill = fillRef.current
    if (!root || !fill) return
    // 目的界面已就位（App 在退场期间挂载本层作覆盖层）：不再重跑开机引擎。
    const initialPhase = useBootStore.getState().phase
    if (initialPhase === 'ready' || initialPhase === 'login') return

    const motion = createBootMotion(
      { root, fill, bar: barRef.current },
      {
        onProgress: (percent) => {
          if (percent >= ADVANCE_AT_PERCENT && useBootStore.getState().phase === 'booting') {
            useBootStore.getState().advance()
          }
        },
        onComplete: () => {
          // Session check decides desktop vs login (PRD §24.1).
          const target =
            useSessionStore.getState().status === 'authenticated' ? 'ready' : 'login'
          useBootStore.getState().finishBoot(target)
        },
        onExitDone: () => useBootStore.getState().markLayerExitDone(),
      },
    )
    // 点击/按任意键跳过：立即完成并播退场（引擎幂等）。
    const skip = () => motion.skip()
    window.addEventListener('keydown', skip)
    root.addEventListener('pointerdown', skip)
    motion.start()
    return () => {
      window.removeEventListener('keydown', skip)
      root.removeEventListener('pointerdown', skip)
      motion.destroy()
    }
  }, [])

  return (
    <div ref={rootRef} data-testid="boot-screen" className="boot-motion-screen">
      {/* mark 图形 + CSS 文字字标（UI 评审 P1-5）：full 资产的深色字标落在
          开机层深色底上只剩「OS」可见。 */}
      <BrandLogo size={88} />
      <p className="boot-motion-wordmark" data-testid="boot-wordmark">
        Ageha<span className="boot-motion-wordmark-os">OS</span>
      </p>
      <div
        ref={barRef}
        className="boot-motion-bar"
        role="progressbar"
        aria-label={t('boot.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div ref={fillRef} className="boot-motion-bar-fill" />
      </div>
      <p className="boot-motion-status" role="status">
        {t(`boot.${phase}`)}
      </p>
      <p className="boot-motion-hint" aria-hidden="true">
        {t('boot.skipHint')}
      </p>
    </div>
  )
}
