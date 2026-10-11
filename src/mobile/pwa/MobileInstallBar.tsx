import { X } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'

import { useInstallPrompt } from './use-install-prompt'

/**
 * PWA 安装条（M3-3，概念展板屏⑩）：MobileHome 尾部的非侵入位（随内容
 * 滚动、不遮挡任何入口，应用视图不挂载——整条只存在于 MobileShell 内）。
 * 分支裁决归 use-install-prompt（hook）+ install-prompt-decision（纯函数）：
 * - **chromium 分支**（beforeinstallprompt 已捕获，Android/桌面 Chromium）：
 *   「安装」整宽钮 = deferredPrompt.prompt()，结果反馈在条内——接受 → 条
 *   退场（原生安装 UI 接管）；浏览器对话框取消 → 安装钮换成结果行（prompt
 *   已消费、同事件不能再弹，留着按钮就是死按钮），关闭钮仍在；prompt()
 *   抛错 → 撤销在册 prompt 整条退场（hook 内处理）；
 * - **iOS 指引分支**（isIos 且无事件）：两步文案指引（分享 → 添加到主
 *   屏幕），无可点安装钮——iOS 无 web 安装 API，指引是真实能力的全部；
 * - **hidden**：standalone / 已安装 / 已 dismiss / 其余浏览器 → 整条不
 *   渲染（缺席即状态，禁止空壳）。
 *
 * 视觉（DESIGN.md §35）：Today 卡同款实色卡面（--ag-surface-raised +
 * border-subtle，零 blur——玻璃白名单 §35.1 没有本条的位置，不引入）；
 * 「安装」钮 min-h-[44px]、关闭钮 44×44（§35.3）；文案全走 i18n 双词典
 * （§35.6）。dismiss 记 localStorage 版本键（install-prompt-decision），
 * 永不再打扰。
 */
export function MobileInstallBar() {
  const { t } = useTranslation()
  const { branch, phase, promptInstall, dismiss } = useInstallPrompt()

  if (branch === 'hidden') return null

  return (
    <section
      data-testid="mobile-pwa-install"
      data-branch={branch}
      aria-label={branch === 'ios' ? t('mobile.pwa.install.iosTitle') : t('mobile.pwa.install.title')}
      className="relative mx-5 mb-2 mt-7 rounded-2xl border p-4"
      style={{ backgroundColor: 'var(--ag-surface-raised)', borderColor: 'var(--ag-border-subtle)' }}
    >
      {/* 永久关闭钮：44×44 命中区（§35.3），叠卡片右上角（RecentsCard
          删除钮同款布局）；dismiss 记 localStorage 版本键，此后不再打扰。 */}
      <button
        type="button"
        data-testid="mobile-pwa-install-dismiss"
        aria-label={t('mobile.pwa.install.dismiss')}
        onClick={dismiss}
        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl transition-opacity active:opacity-80"
      >
        <X size={14} weight="bold" aria-hidden="true" style={{ color: 'var(--ag-text-muted)' }} />
      </button>
      <div className="flex items-center gap-2 pr-11">
        <p className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ag-text)' }}>
          {branch === 'ios' ? t('mobile.pwa.install.iosTitle') : t('mobile.pwa.install.title')}
        </p>
      </div>
      <p className="mt-2 pr-11 text-xs leading-snug" style={{ color: 'var(--ag-text-muted)' }}>
        {branch === 'ios'
          ? t('mobile.pwa.install.iosDescription')
          : t('mobile.pwa.install.description')}
      </p>
      {branch === 'chromium' ? (
        // 浏览器对话框取消后的结果反馈：安装钮退场（prompt 已消费，再点
        // 必败——死按钮禁令），关闭钮仍可永久 dismiss。
        phase === 'dismissed' ? (
          <p
            data-testid="mobile-pwa-install-outcome"
            className="mt-3 text-xs leading-snug"
            style={{ color: 'var(--ag-text-muted)' }}
          >
            {t('mobile.pwa.install.dismissedOutcome')}
          </p>
        ) : (
          <button
            type="button"
            data-testid="mobile-pwa-install-action"
            data-state={phase}
            disabled={phase === 'pending'}
            onClick={() => {
              void promptInstall()
            }}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm font-medium transition-opacity active:opacity-80 disabled:opacity-60"
            style={{ color: 'var(--ag-primary)' }}
          >
            {phase === 'pending'
              ? t('mobile.pwa.install.pending')
              : t('mobile.pwa.install.action')}
          </button>
        )
      ) : (
        // iOS 指引步骤（无 web 安装 API——指引即能力本身，不摆假按钮）。
        <ol
          data-testid="mobile-pwa-install-ios-steps"
          className="mt-3 flex flex-col gap-1.5 text-xs leading-snug"
          style={{ color: 'var(--ag-text-muted)' }}
        >
          <li>{t('mobile.pwa.install.iosStepShare')}</li>
          <li>{t('mobile.pwa.install.iosStepAdd')}</li>
        </ol>
      )}
    </section>
  )
}
