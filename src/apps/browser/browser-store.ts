import { create } from 'zustand'

/**
 * 浏览器应用的书签与历史（设备本地持久化，usage-store 同款 localStorage
 * 范式）：书签去重按键、历史连续同址折叠 + 200 条封顶（易逝信息，不做
 * 云端同步——隐私面最小化）。
 */

const STORAGE_KEY = 'agehaos.browser.v1'
const HISTORY_LIMIT = 200

export interface BrowserBookmark {
  url: string
  title: string
  addedAt: number
}

export interface BrowserHistoryEntry {
  url: string
  title: string
  visitedAt: number
}

interface PersistedBrowser {
  bookmarks: BrowserBookmark[]
  history: BrowserHistoryEntry[]
}

interface BrowserState extends PersistedBrowser {
  addBookmark: (url: string, title: string) => void
  removeBookmark: (url: string) => void
  recordVisit: (url: string, title: string) => void
  clearHistory: () => void
}

function sanitize(raw: unknown): PersistedBrowser {
  const value = (raw ?? {}) as Partial<PersistedBrowser>
  const bookmarks = Array.isArray(value.bookmarks)
    ? value.bookmarks.filter(
        (entry): entry is BrowserBookmark =>
          typeof entry?.url === 'string' && typeof entry?.title === 'string',
      )
    : []
  const history = Array.isArray(value.history)
    ? value.history.filter(
        (entry): entry is BrowserHistoryEntry =>
          typeof entry?.url === 'string' && typeof entry?.title === 'string',
      )
    : []
  return { bookmarks: bookmarks.slice(0, 200), history: history.slice(0, HISTORY_LIMIT) }
}

function load(): PersistedBrowser {
  if (typeof localStorage === 'undefined') return { bookmarks: [], history: [] }
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return { bookmarks: [], history: [] }
  }
}

function persist(state: PersistedBrowser): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ bookmarks: state.bookmarks, history: state.history }),
    )
  } catch {
    /* 配额满/隐私模式：仅本会话生效 */
  }
}

const initial = load()

export const useBrowserStore = create<BrowserState>()((set, get) => ({
  ...initial,

  addBookmark: (url, title) => {
    if (get().bookmarks.some((entry) => entry.url === url)) return
    const next = {
      bookmarks: [{ url, title, addedAt: Date.now() }, ...get().bookmarks].slice(0, 200),
    }
    set(next)
    persist({ bookmarks: next.bookmarks, history: get().history })
  },

  removeBookmark: (url) => {
    const bookmarks = get().bookmarks.filter((entry) => entry.url !== url)
    set({ bookmarks })
    persist({ bookmarks, history: get().history })
  },

  recordVisit: (url, title) => {
    const current = get().history
    // 连续同址折叠（刷新/重进不刷屏），其余按访问序最新在前。
    const history =
      current[0]?.url === url
        ? [{ url, title, visitedAt: Date.now() }, ...current.slice(1)]
        : [{ url, title, visitedAt: Date.now() }, ...current].slice(0, HISTORY_LIMIT)
    set({ history })
    persist({ bookmarks: get().bookmarks, history })
  },

  clearHistory: () => {
    set({ history: [] })
    persist({ bookmarks: get().bookmarks, history: [] })
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadBrowserStore(): void {
  useBrowserStore.setState(load())
}

/** 测试隔离出口。 */
export function resetBrowserStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  useBrowserStore.setState(load())
}
