import { AppIcon } from '@/apps/app-icon'

/**
 * 拟态窗脸共享组件（真机反馈第三轮「Alt+W 窗口切换器条目向任务视图的窗口
 * 对齐、大小一致」的单一来源）：卡面 = AppIcon + 标题 + **CSS 拟态窗脸**——
 * 红黄绿窗控点 + 两根内容占位条，全部纯 CSS 装饰（禁渲染应用内容、禁
 * iframe clone、禁截图——Mission Control W7 硬性设计决定 3，结构自
 * `mission-control/WindowCard.tsx` 的 CardFace 原样提取，MC 视觉零变化）。
 *
 * 消费方（共同保证同款同尺寸 224×152：w-56 卡宽 + p-3 内边距 + 标题行
 * 22px + gap-2 + h-24 窗脸）：
 * - `mission-control/WindowCard.tsx`：窗口卡按钮面 + WindowDragGhost 拖拽影；
 * - `window-switcher/WindowSwitcher.tsx`：Alt+W 切换器条目（卡片脸 +
 *   主色描边选中态；❌ 关闭钮是 MC 专属，不在此层）。
 *
 * 单一来源纪律：今后任何一方调整卡面（比例/控点/占位条）只改本文件——
 * 两个面板即永远对齐，任何一方不得本地复制该结构（否则「大小一致」会
 * 再次漂移）。
 */

export interface WindowCardFaceProps {
  /** 应用图标（AppIcon 同源：Taskbar/搜索/MC 卡共用一套 appId→图标映射）。 */
  appId: string
  /** 窗口标题（truncate 截断；完整文本挂 title 供 hover 提示）。 */
  title: string
  /** minimized：窗脸整体降透明度（MC 卡与切换器条目同语义）。 */
  minimized?: boolean
}

export function WindowCardFace({ appId, title, minimized = false }: WindowCardFaceProps) {
  return (
    <>
      <span className="flex w-full items-center gap-2">
        <AppIcon appId={appId} size={22} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text" title={title}>
          {title}
        </span>
      </span>
      {/* CSS 拟态窗脸（禁应用内容/禁 iframe clone/禁截图）：红黄绿窗控点 +
          两根内容占位条，全部 aria-hidden 纯装饰。 */}
      <span
        aria-hidden="true"
        className={`flex h-24 w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-soft ${
          minimized ? 'opacity-50' : ''
        }`}
      >
        <span className="flex items-center gap-1 border-b border-border-subtle px-1.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-wl-close" />
          <span className="h-1.5 w-1.5 rounded-full bg-wl-min" />
          <span className="h-1.5 w-1.5 rounded-full bg-wl-max" />
        </span>
        <span className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="h-1.5 w-3/4 rounded-full bg-border-strong" />
          <span className="h-1.5 w-1/2 rounded-full bg-border-subtle" />
        </span>
      </span>
    </>
  )
}
