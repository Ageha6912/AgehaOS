import { create } from 'zustand'

/**
 * Files 定位意图通道（M4-1 移动全域搜索）：启动器的文件结果点击语义是
 * 「打开 Files 并定位到该文件所在目录」。launchApp 的窗口选项不含应用参数
 * （桌面 `app-deep-link.ts` 模块级一次性意图的同一困境），且 M3-2 起**窗口
 * 常驻**——Files 已开时 `openApp('files')` 是「切回已有窗口」，组件**不会
 * 重挂**，纯挂载期消费的模块级变量会无人认领。因此这里是响应式 store：
 * `requestFilesTarget` 写入 pending，FileManager 订阅 pending——在场实例的
 * effect 即时消费（读走即清 + navigate），未挂载则留给下一次 Files 挂载时
 * 消费（app-deep-link「请求下一次启动」同语义）。
 *
 * 取走即清（consumeFilesTarget）读改两步在单线程 JS 内不可分割（getState
 * 与 setState 之间无插队代码）；多实例并存（桌面双 Files 窗口）时恰有一个
 * 实例消费到非空值，其余拿到 null 走默认路径。**桌面零影响**：桌面无人
 * request，pending 恒 null、consume 恒 null。
 */
interface FilesTargetState {
  /** 待定位目录（绝对路径）；null = 无意图。最新请求覆盖旧请求。 */
  pending: string | null
  /** 请求下一次 Files 呈现时定位到指定目录（当前唯一发起方：移动启动器）。 */
  requestFilesTarget: (path: string) => void
}

export const useFilesTargetStore = create<FilesTargetState>()((set) => ({
  pending: null,
  requestFilesTarget: (path) => set({ pending: path }),
}))

/** 目标侧消费（读走即清）：FileManager 的 effect 调用；null = 无意图。 */
export function consumeFilesTarget(): string | null {
  const current = useFilesTargetStore.getState().pending
  if (current !== null) useFilesTargetStore.setState({ pending: null })
  return current
}

/** 测试隔离出口：回到初始无意图态。 */
export function resetFilesTargetStore(): void {
  useFilesTargetStore.setState({ pending: null })
}
