import { beforeEach, describe, expect, it } from 'vitest'

import { reloadBrowserStore, resetBrowserStore, useBrowserStore } from './browser-store'

beforeEach(() => {
  resetBrowserStore()
})

describe('browser-store（书签与历史：设备本地持久化）', () => {
  it('书签：添加去重、最新在前、可移除', () => {
    const store = useBrowserStore.getState()
    store.addBookmark('https://a.example/', 'a.example')
    store.addBookmark('https://b.example/', 'b.example')
    store.addBookmark('https://a.example/', 'a.example') // 重复不叠加

    expect(useBrowserStore.getState().bookmarks.map((entry) => entry.url)).toEqual([
      'https://b.example/',
      'https://a.example/',
    ])

    useBrowserStore.getState().removeBookmark('https://a.example/')
    expect(useBrowserStore.getState().bookmarks.map((entry) => entry.url)).toEqual([
      'https://b.example/',
    ])
  })

  it('历史：最新在前、连续同址折叠', () => {
    const store = useBrowserStore.getState()
    store.recordVisit('https://a.example/', 'a.example')
    store.recordVisit('https://a.example/', 'a.example') // 连续同址折叠
    store.recordVisit('https://b.example/', 'b.example')

    const history = useBrowserStore.getState().history
    expect(history.map((entry) => entry.url)).toEqual(['https://b.example/', 'https://a.example/'])
  })

  it('持久化 round-trip：写盘 → 新会话重读保留（reload 走真实加载路径）', () => {
    useBrowserStore.getState().addBookmark('https://a.example/', 'a.example')
    useBrowserStore.getState().recordVisit('https://a.example/', 'a.example')
    expect(localStorage.getItem('agehaos.browser.v1')).not.toBeNull()

    reloadBrowserStore()
    expect(useBrowserStore.getState().bookmarks).toHaveLength(1)
    expect(useBrowserStore.getState().history).toHaveLength(1)
    expect(useBrowserStore.getState().history[0]?.url).toBe('https://a.example/')
  })

  it('历史 200 条封顶；clearHistory 清空', () => {
    const store = useBrowserStore.getState()
    for (let index = 0; index < 210; index += 1) {
      store.recordVisit(`https://example.com/${index}`, 'example.com')
    }
    expect(useBrowserStore.getState().history).toHaveLength(200)

    useBrowserStore.getState().clearHistory()
    expect(useBrowserStore.getState().history).toHaveLength(0)
  })

  it('坏数据兜底为空（不抛错）', () => {
    localStorage.setItem('agehaos.browser.v1', 'not-json{')
    reloadBrowserStore()
    expect(useBrowserStore.getState().bookmarks).toEqual([])
    expect(useBrowserStore.getState().history).toEqual([])
  })
})
