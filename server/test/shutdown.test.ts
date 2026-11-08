import { describe, expect, it, vi } from 'vitest'

import { registerShutdown } from '../src/shutdown'

describe('registerShutdown（优雅停机，A1 审查轻微项）', () => {
  it('首个信号触发 close → exit(0)；重复信号只处理一次', async () => {
    const close = vi.fn(async () => undefined)
    const registered: Array<[string, () => void]> = []
    const exit = vi.fn()
    registerShutdown(
      { close },
      {
        register: (signal, handler) => registered.push([signal, handler]),
        exit,
      },
    )
    expect(registered.map(([signal]) => signal)).toEqual(['SIGINT', 'SIGTERM'])

    registered[0]?.[1]()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(close).toHaveBeenCalledTimes(1)

    // 重复 SIGINT / 随后的 SIGTERM 不再对 closing 实例二次 close。
    registered[0]?.[1]()
    registered[1]?.[1]()
    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('close 拒绝时打日志并 exit(1)——进程不再挂死（A1 审查）', async () => {
    const boom = new Error('store.close failed')
    const close = vi.fn(async () => {
      throw boom
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registered: Array<[string, () => void]> = []
    const exit = vi.fn()
    try {
      registerShutdown(
        { close },
        {
          register: (signal, handler) => registered.push([signal, handler]),
          exit,
        },
      )
      registered[1]?.[1]()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      expect(errorSpy).toHaveBeenCalled()
      // 失败路径同样幂等：再来的信号不再 close。
      registered[1]?.[1]()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
