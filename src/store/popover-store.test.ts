import { beforeEach, describe, expect, it } from 'vitest'

import { resetPopoverStore, usePopoverStore } from './popover-store'

beforeEach(() => {
  resetPopoverStore()
})

describe('popover-store（弹层互斥槽）', () => {
  it('hands the slot to the latest claimer', () => {
    usePopoverStore.getState().claim('launcher')
    usePopoverStore.getState().claim('notifications')

    expect(usePopoverStore.getState().active).toBe('notifications')
  })

  it('only clears the slot when the releaser still owns it', () => {
    usePopoverStore.getState().claim('launcher')
    usePopoverStore.getState().claim('notifications')

    usePopoverStore.getState().release('launcher')
    expect(usePopoverStore.getState().active).toBe('notifications')

    usePopoverStore.getState().release('notifications')
    expect(usePopoverStore.getState().active).toBeNull()
  })

  it('resets to an empty slot', () => {
    usePopoverStore.getState().claim('user')
    resetPopoverStore()

    expect(usePopoverStore.getState().active).toBeNull()
  })
})
