export interface SystemEventMap {
  'window.created': { windowId: string; appId: string }
  'window.focused': { windowId: string }
  'window.closed': { windowId: string; appId: string }
  'window.minimized': { windowId: string }
  'window.maximized': { windowId: string }
  'window.restored': { windowId: string }

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
}

export type SystemEventName = keyof SystemEventMap & string
