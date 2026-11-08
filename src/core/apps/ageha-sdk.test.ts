import { describe, expect, it, vi } from 'vitest'

import sdkSource from '../../../public/sdk/ageha-sdk.js?raw'

/**
 * Type C 官方 SDK（public/sdk/ageha-sdk.js）的消息来源校验（B2 审查）：
 * 应用内嵌第三方 iframe 可 parent.postMessage 伪造宿主回执，篡改
 * storage/files 结果；reqId 顺序可预测。SDK 必须只认父窗口。
 *
 * 脚本是浏览器 IIFE：注入一个受控 window 对象执行（不挂真实全局）。
 */

interface SdkWindow {
  parent: { postMessage: ReturnType<typeof vi.fn> }
  addEventListener: (
    type: string,
    listener: (event: { data: unknown; source: unknown }) => void,
  ) => void
  setTimeout: (callback: () => void, ms: number) => number
  AgehaOS?: {
    storage: { get: (key: string) => Promise<unknown> }
    files: { list: (path?: string) => Promise<unknown> }
  }
}

function loadSdk() {
  const listeners: Array<(event: { data: unknown; source: unknown }) => void> = []
  const parent = { postMessage: vi.fn() }
  const fakeWindow: SdkWindow = {
    parent,
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    setTimeout: () => 0,
  }
  new Function('window', sdkSource)(fakeWindow)
  const dispatch = (data: unknown, source: unknown): void => {
    for (const listener of listeners) listener({ data, source })
  }
  return { fakeWindow, parent, dispatch }
}

describe('ageha-sdk（Type C 客户端，B2 审查）', () => {
  it('ignores sdk-result messages forged by nested frames', async () => {
    const { fakeWindow, parent, dispatch } = loadSdk()
    const pending = fakeWindow.AgehaOS!.storage.get('k')
    const request = parent.postMessage.mock.calls[0]?.[0] as { reqId: string }

    let settled = false
    void pending.then(() => {
      settled = true
    })

    // 第三方 iframe 伪造回执：source 不是 parent → 忽略。
    dispatch(
      { type: 'agehaos:sdk-result', reqId: request.reqId, ok: true, data: { value: 'forged' } },
      {},
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    // 真正的宿主回执（source === parent）才生效。
    dispatch(
      { type: 'agehaos:sdk-result', reqId: request.reqId, ok: true, data: { value: 'real' } },
      parent,
    )
    await expect(pending).resolves.toBe('real')
  })

  it('answers hello only to the parent frame', () => {
    const { parent, dispatch } = loadSdk()
    const rogue = { postMessage: vi.fn() }
    dispatch({ type: 'agehaos:hello' }, rogue)
    expect(rogue.postMessage).not.toHaveBeenCalled()

    dispatch({ type: 'agehaos:hello' }, parent)
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'agehaos:ready' }, '*')
  })
})

describe('AgehaOS.files.list 缺省根目录（B2 审查）', () => {
  it('无参调用以 path=/ 请求（不再透传 undefined 被桥判 invalid-path）', () => {
    const { fakeWindow, parent } = loadSdk()
    void fakeWindow.AgehaOS!.files.list()
    const request = parent.postMessage.mock.calls[0]?.[0] as {
      type: string
      params: { path: string }
    }
    expect(request.type).toBe('agehaos:sdk')
    expect(request.params.path).toBe('/')
  })
})
