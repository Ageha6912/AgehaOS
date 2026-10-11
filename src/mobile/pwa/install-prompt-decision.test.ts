import { describe, expect, it, vi } from 'vitest'

import {
  INSTALL_DISMISS_STORAGE_KEY,
  readInstallDismissed,
  resolveInstallPromptBranch,
  writeInstallDismissed,
  type InstallPromptInputs,
} from './install-prompt-decision'

/**
 * PWA 安装提示判定纯函数契约（M3-3）：三档分支裁决的优先序 + dismiss
 * localStorage 版本键的读写与安全兜底。hook 事件采集归
 * use-install-prompt.test.tsx，UI 呈现归 MobileInstallBar.test.tsx。
 */

/** 判定输入基线：四门全关（hidden 档）。 */
function inputs(overrides: Partial<InstallPromptInputs>): InstallPromptInputs {
  return {
    standalone: false,
    installed: false,
    dismissed: false,
    hasDeferredPrompt: false,
    isIos: false,
    ...overrides,
  }
}

/** Map 后备的 Storage 桩（jsdom localStorage 语义的最小实现）。 */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    getLength: 0,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: () => null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage
}

/** 一切读写都抛错的 Storage 桩（隐私模式语义）。 */
function throwingStorage(): Storage {
  return {
    getLength: 0,
    get length() {
      return 0
    },
    clear: () => undefined,
    getItem: () => {
      throw new Error('storage unavailable')
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error('storage unavailable')
    },
  } as unknown as Storage
}

describe('resolveInstallPromptBranch：三档裁决优先序', () => {
  it('四门全关 → hidden（无事件且非 iOS 的浏览器不显示任何提示）', () => {
    expect(resolveInstallPromptBranch(inputs({}))).toBe('hidden')
  })

  it('standalone（display-mode 或 navigator.standalone）→ hidden：已安装形态不出提示', () => {
    expect(resolveInstallPromptBranch(inputs({ standalone: true }))).toBe('hidden')
    // 即便事件在场 / iOS，也不出（standalone 最高优先）。
    expect(
      resolveInstallPromptBranch(inputs({ standalone: true, hasDeferredPrompt: true, isIos: true })),
    ).toBe('hidden')
  })

  it('installed（appinstalled / prompt 接受）→ hidden：本会话已落定', () => {
    expect(resolveInstallPromptBranch(inputs({ installed: true }))).toBe('hidden')
    expect(
      resolveInstallPromptBranch(inputs({ installed: true, hasDeferredPrompt: true })),
    ).toBe('hidden')
  })

  it('dismissed → hidden：用户永久关闭后不再打扰', () => {
    expect(resolveInstallPromptBranch(inputs({ dismissed: true }))).toBe('hidden')
    expect(
      resolveInstallPromptBranch(inputs({ dismissed: true, isIos: true, hasDeferredPrompt: true })),
    ).toBe('hidden')
  })

  it('有 deferred prompt → chromium（事件优先于平台推断：事件在场即能力在场）', () => {
    expect(resolveInstallPromptBranch(inputs({ hasDeferredPrompt: true }))).toBe('chromium')
    expect(
      resolveInstallPromptBranch(inputs({ hasDeferredPrompt: true, isIos: true })),
    ).toBe('chromium')
  })

  it('无事件 + iOS → ios 指引分支（Safari 无 beforeinstallprompt）', () => {
    expect(resolveInstallPromptBranch(inputs({ isIos: true }))).toBe('ios')
  })

  it('无事件 + 非 iOS → hidden（Firefox 等：无能力不伪造）', () => {
    expect(resolveInstallPromptBranch(inputs({}))).toBe('hidden')
  })
})

describe('dismiss 持久化：localStorage 版本键', () => {
  it('未写入时读到 false；写入后读到 true（同一键）', () => {
    const storage = fakeStorage()
    expect(readInstallDismissed(storage)).toBe(false)

    writeInstallDismissed(storage)
    expect(storage.getItem(INSTALL_DISMISS_STORAGE_KEY)).toBe('1')
    expect(readInstallDismissed(storage)).toBe(true)
  })

  it('键值非 1（脏数据）不视为已关闭', () => {
    const storage = fakeStorage({ [INSTALL_DISMISS_STORAGE_KEY]: '0' })
    expect(readInstallDismissed(storage)).toBe(false)
  })

  it('storage 为 null（SSR / 异常环境）：读 false、写不抛错', () => {
    expect(readInstallDismissed(null)).toBe(false)
    expect(() => writeInstallDismissed(null)).not.toThrow()
    expect(readInstallDismissed(undefined)).toBe(false)
  })

  it('storage 抛异常（隐私模式）：读 false、写静默，绝不外泄错误', () => {
    expect(readInstallDismissed(throwingStorage())).toBe(false)
    expect(() => writeInstallDismissed(throwingStorage())).not.toThrow()
  })

  it('版本键名带版本段（v1）：改版 bump 后旧记录自然失效', () => {
    expect(INSTALL_DISMISS_STORAGE_KEY).toMatch(/\.v1$/)
  })

  it('读取异常路径可被注入桩复现（vi.spyOn 抛错同样兜住）', () => {
    const storage = fakeStorage()
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(readInstallDismissed(storage)).toBe(false)
  })
})
