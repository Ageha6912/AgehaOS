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

  it('finishes boot directly from booting (engine skip can fire before the advance point)', () => {
    useBootStore.getState().finishBoot('login')
    expect(useBootStore.getState().phase).toBe('login')
  })

  it('tracks the boot layer exit for the App overlay lifecycle', () => {
    expect(useBootStore.getState().layerExitDone).toBe(false)

    useBootStore.getState().markLayerExitDone()
    expect(useBootStore.getState().layerExitDone).toBe(true)
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
