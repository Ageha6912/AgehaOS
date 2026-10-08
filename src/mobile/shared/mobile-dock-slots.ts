/**
 * 移动 Dock 固定四位应用（M1-5 切片口径，零 React 零 store 依赖的纯表）：
 * 数组序 = Dock 渲染序。存注册表全量 id 而非缩写（与 TodayWorldCard 的
 * MOBILE_TODAY_WORLD_TARGET_APP_ID 同口径，M1-6 AppHost 接管后 openApp
 * 升级为真实启动不需改表）。
 *
 * 刻意不与桌面 PINNED_APP_IDS（src/desktop/taskbar/pinned-apps.ts）共表：
 * 桌面 Dock 位单（calculator/terminal/store、回收站）是桌面密度与指针交互
 * 的产物（HANDOFF §4.0-6 明示移动侧 hover 语义待裁决，触屏本无 hover）。
 * 双 Shell 共享的是「位上」的东西——应用元数据（appDisplayName）、图标
 * （AppIcon）、注册表（app-store）与启动语义（mobile-nav-store.openApp），
 * UI 完全独立。抽纯模块是为了绕开 react-refresh 组件文件单导出纪律，与
 * shared/mobile-app-order.ts 同一个先例。
 */
export const MOBILE_DOCK_APP_IDS = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.dynamic.panel',
  'com.ageha.settings',
] as const
