import { create } from 'zustand'

import { AuthError, isRemoteAuthActive, systemAuthService } from '@/core/auth'
import type { ProfileInput, User } from '@/core/auth'
import { systemBus } from '@/core/events'

export type SessionStatus = 'authenticated' | 'anonymous'

export interface LoginResult {
  ok: boolean
  error?: AuthError
}

export interface RevokeSessionsResult {
  ok: boolean
  revoked: number
  error?: AuthError
}

interface SessionState {
  user: User | null
  status: SessionStatus
  /** True when boot cleared an expired session; shown once on the login screen. */
  sessionExpired: boolean
  /**
   * 会话代际（B1 审查）：登录/注册/登出/失效/启动恢复都推进。异步操作
   * （updateProfile 等）返回后校验代际——期间已登出则不得把旧用户写回
   * （status:'anonymous' 但 user!==null 会误导 file-sync/eclosion）。
   */
  epoch: number
  login: (username: string, password: string) => Promise<LoginResult>
  register: (username: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  /** Boot-time re-check against the active auth provider (remote sessions). */
  reconcile: () => Promise<void>
  updateProfile: (input: ProfileInput) => Promise<LoginResult>
  changePassword: (currentPassword: string, newPassword: string) => Promise<LoginResult>
  revokeOtherSessions: () => Promise<RevokeSessionsResult>
  clearExpiredNotice: () => void
}

function initialUser(): { user: User | null; sessionExpired: boolean } {
  const hadSession =
    typeof localStorage !== 'undefined' && localStorage.getItem('agehaos.session.v1') !== null
  const user = systemAuthService.getUser()
  return {
    user,
    // A leftover session key that no longer verifies means it expired.
    sessionExpired: hadSession && user === null,
  }
}

const initial = initialUser()

export const useSessionStore = create<SessionState>()(() => ({
  user: initial.user,
  status: initial.user ? 'authenticated' : 'anonymous',
  sessionExpired: initial.sessionExpired,
  epoch: 0,

  login: async (username, password) => {
    const epoch = useSessionStore.getState().epoch
    try {
      const { user } = await systemAuthService.login(username, password)
      // 请求期间已登出/会话已切换：登录结果作废（不得把用户写回）。
      if (useSessionStore.getState().epoch !== epoch) {
        return { ok: false, error: new AuthError('not-authenticated', 'Not signed in') }
      }
      useSessionStore.setState({
        user,
        status: 'authenticated',
        sessionExpired: false,
        epoch: epoch + 1,
      })
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  register: async (username, password) => {
    const epoch = useSessionStore.getState().epoch
    try {
      const user = await systemAuthService.register(username, password)
      // 远程模式注册即登录（服务端已下发会话 Cookie，跳过二次 login 以免产生
      // 重复会话）；本地模式注册不建会话，走一次 login 完成自动登录。
      if (isRemoteAuthActive()) {
        if (useSessionStore.getState().epoch !== epoch) {
          return { ok: false, error: new AuthError('not-authenticated', 'Not signed in') }
        }
        useSessionStore.setState({
          user: systemAuthService.getUser() ?? user,
          status: 'authenticated',
          sessionExpired: false,
          epoch: epoch + 1,
        })
        return { ok: true }
      }
      // 本地自动登录结果如实上抛（C1 审查：旧实现丢弃 LoginResult 恒
      // {ok:true}——注册成功但自动登录失败时 UI 被拉回登录页且错误丢失）。
      // 显式标注打断推断环（C1 审查：register 引用自身 store 的 login 会
      // 让 useSessionStore 类型推断自指）。
      const loginResult: LoginResult = await useSessionStore.getState().login(user.username, password)
      return loginResult.ok ? { ok: true } : loginResult
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  logout: async () => {
    systemAuthService.logout()
    useSessionStore.setState({
      user: null,
      status: 'anonymous',
      epoch: useSessionStore.getState().epoch + 1,
    })
  },

  reconcile: async () => {
    // 匿名 → 已认证的转变必须补广播 user.login：远程模式刷新页面时
    // 会话经这里恢复（Cookie → /api/auth/session），而壁纸生成、文件同步
    // 等登录钩子都订阅该事件——此前 reconcile 静默设值，刷新后壁纸丢失。
    // 已有会话时（本地模式恢复路径）不重复广播，避免登录钩子跑两遍。
    const epoch = useSessionStore.getState().epoch
    const previous = useSessionStore.getState().user
    const user = await systemAuthService.reconcile()
    // 等待期间用户已登录/登出：以用户操作为准，旧 reconcile 结果丢弃。
    if (useSessionStore.getState().epoch !== epoch) return
    if (user) {
      useSessionStore.setState({
        user,
        status: 'authenticated',
        sessionExpired: false,
        epoch: epoch + 1,
      })
      if (!previous) systemBus.emit('user.login', { userId: user.id })
    } else {
      useSessionStore.setState({ user: null, status: 'anonymous', epoch: epoch + 1 })
    }
  },

  updateProfile: async (input) => {
    const epoch = useSessionStore.getState().epoch
    try {
      const user = await systemAuthService.updateProfile(input)
      // 保存期间登出：PATCH 晚到不得把 user 写回（B1 审查）。
      if (useSessionStore.getState().epoch !== epoch) {
        return { ok: false, error: new AuthError('not-authenticated', 'Not signed in') }
      }
      useSessionStore.setState({ user })
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    try {
      await systemAuthService.changePassword(currentPassword, newPassword)
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  revokeOtherSessions: async () => {
    try {
      const revoked = await systemAuthService.revokeOtherSessions()
      return { ok: true, revoked }
    } catch (cause) {
      return { ok: false, revoked: 0, error: cause as AuthError }
    }
  },

  clearExpiredNotice: () => useSessionStore.setState({ sessionExpired: false }),
}))

/**
 * 会话失效统一复位（B1 审查）：本地/远程 provider 在 logout 与服务端判定
 * 会话失效（已认证接口 401）时广播 user.logout——只靠各调用方 catch 会漏掉
 * AccountSection 直连 provider 的会话管理调用，store 与服务端状态分叉。
 */
systemBus.on('user.logout', () => {
  const state = useSessionStore.getState()
  if (state.user === null && state.status === 'anonymous') return
  useSessionStore.setState({ user: null, status: 'anonymous', epoch: state.epoch + 1 })
})

/** Restores boot defaults (signed out); used between tests. */
export function resetSessionStore(): void {
  useSessionStore.setState({
    user: null,
    status: 'anonymous',
    sessionExpired: false,
    epoch: useSessionStore.getState().epoch + 1,
  })
}

/** Seeds an authenticated user without touching real credentials; tests only. */
export function seedSessionForTests(user: User): void {
  useSessionStore.setState({
    user,
    status: 'authenticated',
    sessionExpired: false,
    epoch: useSessionStore.getState().epoch + 1,
  })
}
