/**
 * 桌面氛围层（DESIGN.md §18）：壁纸/画布之上的极轻环境光 + 暗角。
 * 纯静态 CSS 渐变（token 驱动，随主题翻转），零动画零 rAF；
 * pointer-events-none —— 涟漪/右键菜单的目标判定（画布宿主或壁纸层）
 * 永远不会命中本层。壁纸关闭时依然渲染（落在 surface-canvas 渐变上）。
 */
export function AtmosphereLayer() {
  return (
    <div
      aria-hidden="true"
      data-testid="atmosphere-layer"
      className="atmosphere-layer pointer-events-none absolute inset-0 z-[2]"
    />
  )
}
