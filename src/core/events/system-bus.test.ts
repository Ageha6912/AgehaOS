import { describe, it, expect, vi, afterEach } from 'vitest'

import { systemBus } from './system-bus'
import type { SystemEventMap } from './types'

describe('systemBus', () => {
  afterEach(() => {
    systemBus.clear()
  })

  it('is an EventBus over the system event map', () => {
    const handler = vi.fn<(payload: SystemEventMap['user.login']) => void>()

    systemBus.on('user.login', handler)
    systemBus.emit('user.login', { userId: 'u-1' })

    expect(handler).toHaveBeenCalledWith({ userId: 'u-1' })
  })
})
