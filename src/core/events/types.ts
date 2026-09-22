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
}

export type SystemEventName = keyof SystemEventMap & string
