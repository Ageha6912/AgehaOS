import { describe, it, expect, beforeEach } from 'vitest'

import { useBootStore } from './boot-store'

beforeEach(() => {
  useBootStore.setState(useBootStore.getInitialState())
})

describe('useBootStore', () => {
  it('starts in the booting phase', () => {
    expect(useBootStore.getState().phase).toBe('booting')
  })

  it('advances booting → loading → ready', () => {
    const { advance } = useBootStore.getState()

    advance()
    expect(useBootStore.getState().phase).toBe('loading')

    advance()
    expect(useBootStore.getState().phase).toBe('ready')
  })

  it('stays ready once boot completed', () => {
    useBootStore.getState().setPhase('ready')

    useBootStore.getState().advance()

    expect(useBootStore.getState().phase).toBe('ready')
  })

  it('jumps to an explicit phase via setPhase', () => {
    useBootStore.getState().setPhase('loading')

    expect(useBootStore.getState().phase).toBe('loading')
  })
})
