export interface SystemEventMap {
  'window.created': { windowId: string; appId: string }
  'window.focused': { windowId: string }
  'window.closed': { windowId: string; appId: string }
  'window.minimized': { windowId: string }
  'window.maximized': { windowId: string }
  'window.restored': { windowId: string }
  // 窗口改派 Space（W2，审计 .tmp/spaces-audit.md §5 决定 3）。发送处在
  // WindowManager.moveWindowToSpace（src/core/window/window-manager.ts）；
  // 契约测试见 src/core/events/space-events.test.ts（ADR 4）。
  'window.space-assigned': { windowId: string; fromSpaceId: string; toSpaceId: string }

  // Ageha Spaces（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2）。
  // 发送处在 SpaceManager（src/core/window/space-manager.ts）；删除 active
  // Space 时的 active 重定向会连带发 space.switched。契约测试见
  // src/core/events/space-events.test.ts（ADR 4）。
  'space.created': { spaceId: string }
  'space.deleted': { spaceId: string }
  'space.switched': { spaceId: string; fromSpaceId: string }
  'space.renamed': { spaceId: string; name: string }
  'space.reordered': { spaceId: string; fromIndex: number; toIndex: number }

  'app.installed': { appId: string }
  'app.started': { appId: string; windowId: string }
  'app.stopped': { appId: string; windowId: string }
  'app.crashed': { appId: string; windowId: string }

  'file.created': { fileId: string; path: string }
  'file.updated': { fileId: string; path: string }
  'file.deleted': { fileId: string; path: string }

  'user.login': { userId: string }
  'user.logout': { userId: string }

  'permission.requested': { appId: string; permission: string }
  'permission.granted': { appId: string; permission: string }
  'permission.denied': { appId: string; permission: string }

  // AI 动态桌面（设计文档 §3.3，Phase A 仅发射 desktop.wallpaper.* / desktop.generation.*
  // / desktop.feedback / desktop.perf.degraded / ai.decision.performed）
  'desktop.wallpaper.generate-started': {
    seed: string
    tier: 'high' | 'mid' | 'low'
    trigger: 'login' | 'timer' | 'manual'
  }
  'desktop.wallpaper.generated': { seed: string; templateId: string; generatorVersion: number }
  'desktop.wallpaper.applied': { seed: string; tier: 'high' | 'mid' | 'low'; durationMs: number }
  'desktop.wallpaper.fallback': {
    from: 'L0' | 'F1' | 'F2' | 'F3'
    to: 'F1' | 'F2' | 'F3'
    reason: string
  }
  'desktop.generation.failed': {
    seed: string
    stage: 'generate' | 'constraint' | 'gate'
    reason: string
  }
  'desktop.layout.suggested': { layoutId: string }
  'desktop.feedback': { signal: string; targetId: string; weight: number }
  'desktop.perf.degraded': { metric: string; value: number; action: string }
  'ai.content.ready': { panelId: string; itemCount: number }
  'ai.content.blocked': { panelId: string; reason: string }
  'ai.decision.performed': { domain: string; source: 'local' | 'llm' | 'cache' }

  // 羽化模式（AI-GENERATED-APPS-DESIGN §3.2）。P1 实发 app.generating/
  // app.ready/app.failed（发送处在 services/eclosion.ts 与宿主容器）；
  // world.ready（P2 今日世界）与 app.reported（P4 举报链路）为预留键，
  // 先扩图补测试（ADR 4），接入期到时只加发送处。
  'eclosion.world.ready': { worldDate: string }
  'eclosion.app.generating': { appId: string; specId: string }
  'eclosion.app.ready': { appId: string; specId: string; source: 'network' | 'cache' }
  'eclosion.app.failed': { appId: string; specId: string; reason: string }
  'eclosion.app.reported': { appId: string; windowId: string }
}

export type SystemEventName = keyof SystemEventMap & string
