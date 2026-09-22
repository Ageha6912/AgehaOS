import { describe, it, expect, beforeEach } from 'vitest'

import { useBootStore } from './boot-store'

beforeEach(() => {
  useBootStore.setState(useBootStore.getInitialState())
})

describe('useBootStore', () => {
  it('starts in the booting phase', () => {
    expect(useBootStore.getState().phase).toBe('booting')
  })

  it('advances booting → loading', () => {
    useBootStore.getState().advance()
    expect(useBootStore.getState().phase).toBe('loading')
  })

  it('finishes boot into the desktop or the login screen', () => {
    useBootStore.getState().advance()
    useBootStore.getState().finishBoot('ready')
    expect(useBootStore.getState().phase).toBe('ready')

    useBootStore.setState(useBootStore.getInitialState())
    useBootStore.getState().advance()
    useBootStore.getState().finishBoot('login')
    expect(useBootStore.getState().phase).toBe('login')
  })

  it('stays ready once boot completed', () => {
    useBootStore.getState().setPhase('ready')

    useBootStore.getState().advance()
    useBootStore.getState().finishBoot('login')

    expect(useBootStore.getState().phase).toBe('ready')
  })

  it('jumps to an explicit phase via setPhase', () => {
    useBootStore.getState().setPhase('loading')

    expect(useBootStore.getState().phase).toBe('loading')
  })
})
