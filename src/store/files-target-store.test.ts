import { beforeEach, describe, expect, it } from 'vitest'

import {
  consumeFilesTarget,
  resetFilesTargetStore,
  useFilesTargetStore,
} from './files-target-store'

/**
 * Files 定位意图通道契约（M4-1）：request 写入、consume 读走即清、未消费
 * 时留存（留给下一次 Files 挂载）、最新请求覆盖旧请求；桌面零影响的另一面
 * = 初始恒 null。消费分发语义由 FileManager.test.tsx 在组件侧钉住（挂载
 * 消费 + 在场订阅两条路径），本文件只钉 store 本体。
 */
describe('files-target-store', () => {
  beforeEach(() => {
    resetFilesTargetStore()
  })

  it('初始态：pending 恒 null（桌面零影响），consume 无意图返回 null', () => {
    expect(useFilesTargetStore.getState().pending).toBeNull()
    expect(consumeFilesTarget()).toBeNull()
    // 消费空通道不产生写入（pending 仍 null）。
    expect(useFilesTargetStore.getState().pending).toBeNull()
  })

  it('request 写入 → consume 读走即清 → 二次消费拿不到旧值', () => {
    useFilesTargetStore.getState().requestFilesTarget('/Documents')

    expect(useFilesTargetStore.getState().pending).toBe('/Documents')
    expect(consumeFilesTarget()).toBe('/Documents')
    expect(useFilesTargetStore.getState().pending).toBeNull()
    expect(consumeFilesTarget()).toBeNull()
  })

  it('连续 request：最新请求覆盖旧请求，一次消费只发一次', () => {
    useFilesTargetStore.getState().requestFilesTarget('/Documents')
    useFilesTargetStore.getState().requestFilesTarget('/Pictures')

    expect(consumeFilesTarget()).toBe('/Pictures')
    expect(consumeFilesTarget()).toBeNull()
  })

  it('reset 清空未消费意图（测试隔离出口）', () => {
    useFilesTargetStore.getState().requestFilesTarget('/Documents')
    resetFilesTargetStore()

    expect(useFilesTargetStore.getState().pending).toBeNull()
    expect(consumeFilesTarget()).toBeNull()
  })
})
