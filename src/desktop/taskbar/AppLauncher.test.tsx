import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerRuntimeApp, resetAppStore } from '@/store/app-store'
import { systemEclosion } from '@/services/eclosion'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetUsageStore } from '@/store/usage-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { filterLauncherAppIds } from './launcher-visibility'

/**
 * 羽化呈现过滤（AI-GENERATED-APPS-DESIGN §2.1）：开关关 → 仅原生；开且
 * 「羽化版」→ 三件套接管 calculator/notes 入口；时钟样本维持现状。
 * 纯函数 + 启动器行为两级钉死（e2e 断言依据）。
 */

const NATIVE_IDS = [
  'com.ageha.notes',
  'com.ageha.files',
  'com.ageha.settings',
  'com.ageha.store',
  'com.ageha.calculator',
  'com.ageha.dynamic.panel',
  'com.ageha.terminal',
]
const TRIO_IDS = [
  'com.ageha.eclosion.calculator',
  'com.ageha.eclosion.notes',
  'com.ageha.eclosion.clock',
]
const ALL_IDS = [...NATIVE_IDS, ...TRIO_IDS]

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetUsageStore()
  resetEclosionStore()
})

describe('filterLauncherAppIds（纯函数）', () => {
  it('mode off → natives only, trio hidden', () => {
    expect(filterLauncherAppIds(ALL_IDS, { enabled: false, modes: {} })).toEqual(NATIVE_IDS)
  })

  it('mode on + default modes → trio takes over calculator/notes, clock sample untouched', () => {
    const visible = filterLauncherAppIds(ALL_IDS, { enabled: true, modes: {} })
    expect(visible).toContain('com.ageha.eclosion.calculator')
    expect(visible).toContain('com.ageha.eclosion.notes')
    expect(visible).toContain('com.ageha.eclosion.clock')
    expect(visible).not.toContain('com.ageha.calculator')
    expect(visible).not.toContain('com.ageha.notes')
    // 其余原生应用不受影响。
    expect(visible).toEqual([
      'com.ageha.files',
      'com.ageha.settings',
      'com.ageha.store',
      'com.ageha.dynamic.panel',
      'com.ageha.terminal',
      ...TRIO_IDS,
    ])
  })

  it('per-app classic mode keeps the native entry for that app only', () => {
    const visible = filterLauncherAppIds(ALL_IDS, {
      enabled: true,
      modes: { calculator: 'classic' },
    })
    expect(visible).toContain('com.ageha.calculator')
    expect(visible).not.toContain('com.ageha.eclosion.calculator')
    // 未改的 notes 仍由羽化版接管。
    expect(visible).toContain('com.ageha.eclosion.notes')
    expect(visible).not.toContain('com.ageha.notes')
  })

  it('the clock sample never hides with the toggle (维持商店样本现状)', () => {
    const withSample = [...ALL_IDS, 'com.ageha.samples.clock']
    expect(filterLauncherAppIds(withSample, { enabled: true, modes: {} })).toContain(
      'com.ageha.samples.clock',
    )
  })

  it('ignores unknown eclosion-prefixed ids unless enabled (imagine 域预留)', () => {
    const ids = [...ALL_IDS, 'com.ageha.eclosion.imagine-abcd1234']
    expect(filterLauncherAppIds(ids, { enabled: false, modes: {} })).not.toContain(
      'com.ageha.eclosion.imagine-abcd1234',
    )
    expect(filterLauncherAppIds(ids, { enabled: true, modes: {} })).toContain(
      'com.ageha.eclosion.imagine-abcd1234',
    )
  })
})

describe('AppLauncher × 羽化呈现', () => {
  const openLauncher = () => {
    render(<AppLauncher />)
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    return within(screen.getByTestId('launcher-grid'))
  }

  it('mode off: launches the native calculator from the grid', () => {
    const grid = openLauncher()
    // 开关关：三件套隐藏，原生入口仍在（各恰一枚——接管与被接管永不同时在场）。
    expect(grid.getAllByRole('button', { name: '计算器' })).toHaveLength(1)
    fireEvent.click(grid.getByRole('button', { name: '计算器' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.calculator')
  })

  it('mode on: the same tile launches the eclosion calculator (§2.1 接管)', () => {
    seedEclosionForTests('u-launch', true)
    useEclosionStore.setState({ enabled: true })
    const grid = openLauncher()
    expect(grid.getAllByRole('button', { name: '计算器' })).toHaveLength(1)
    expect(grid.getAllByRole('button', { name: '记事' })).toHaveLength(1)
    fireEvent.click(grid.getByRole('button', { name: '计算器' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.eclosion.calculator')
    // 窗口标题走规格 titleKey（本地化），entry 为运行时页。
    expect(useWindowStore.getState().windows[0]?.title).toBe('计算器')
  })

  it('classic mode per app: the native entry comes back for that app only', () => {
    useEclosionStore.setState({ enabled: true, modes: { calculator: 'classic' } })
    const grid = openLauncher()
    fireEvent.click(grid.getByRole('button', { name: '计算器' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.calculator')
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(within(screen.getByTestId('launcher-grid')).getByRole('button', { name: '记事' }))
    expect(useWindowStore.getState().windows[1]?.appId).toBe('com.ageha.eclosion.notes')
  })
})

describe('AppLauncher × 今日/我的羽化（§6.4/§8）', () => {
  const TODAY_APP_1 = 'com.ageha.eclosion.edge-oracle'
  const TODAY_APP_2 = 'com.ageha.eclosion.signal-weaver'
  const KEPT_APP = 'com.ageha.eclosion.yesterday-gem'

  const seedWorld = (): void => {
    useEclosionStore.getState().applyWorld({
      worldDate: new Date().toISOString().slice(0, 10),
      headline: '本地智能体与边缘推理的清晨',
      paletteId: 'nebula-violet',
      accentHue: 212,
      degraded: false,
      signalCount: 2,
      signals: { titles: ['信号甲'], sourceName: 'GitHub Trending', sourceUrl: '' },
      apps: [
        { slug: 'edge-oracle', name: '边缘神谕', hue: 268, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
        { slug: 'signal-weaver', name: '信号织机', hue: 190, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
      ],
    })
  }

  const registerRuntime = (id: string, name: string): void => {
    const result = registerRuntimeApp({
      id,
      name,
      version: '1.0.0',
      entry: '/apps/runtime/eclosion.html',
      permissions: [],
      window: { width: 720, height: 480, resizable: true },
    })
    expect(result.ok).toBe(true)
  }

  const openCategory = (category: string): void => {
    render(<AppLauncher />)
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(screen.getByTestId(`launcher-category-${category}`))
  }
  const gridIn = () => within(screen.getByTestId('launcher-grid'))

  it('lists the today world under the「今日」category and launches on a single tile click', () => {
    seedEclosionForTests('u-today', true)
    seedWorld()
    registerRuntime(TODAY_APP_1, '边缘神谕')
    registerRuntime(TODAY_APP_2, '信号织机')
    openCategory('today')

    expect(gridIn().getByRole('button', { name: '边缘神谕' })).toBeInTheDocument()
    expect(gridIn().getByRole('button', { name: '信号织机' })).toBeInTheDocument()

    // 单击瓦片 = 打开即按需生成（2026-10-02 落位裁决：不设双击）。
    fireEvent.click(gridIn().getByRole('button', { name: '边缘神谕' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe(TODAY_APP_1)
  })

  it('hides the today group entirely while eclosion is off', () => {
    seedEclosionForTests('u-today', false)
    seedWorld()
    registerRuntime(TODAY_APP_1, '边缘神谕')
    openCategory('today')

    // 空分组：网格不渲染，落空提示。
    expect(screen.queryByRole('button', { name: '边缘神谕' })).toBeNull()
    expect(screen.queryByTestId('launcher-grid')).toBeNull()
    expect(screen.getByText('无匹配结果')).toBeInTheDocument()
  })

  it('shows kept apps under「我的羽化」with an uninstall affordance that calls unkeepApp', () => {
    seedEclosionForTests('u-kept', true)
    useEclosionStore.getState().setKeptAppIds([KEPT_APP])
    registerRuntime(KEPT_APP, '昨日珍宝')
    const unkeep = vi
      .spyOn(systemEclosion, 'unkeepApp')
      .mockResolvedValue(true)
    openCategory('eclosion-kept')

    const tile = gridIn().getByRole('button', { name: '昨日珍宝' })
    // 世界行 hue 不在场（留存）：确定性徽章照常渲染。
    expect(tile.querySelector('[aria-hidden="true"]')).not.toBeNull()

    fireEvent.click(screen.getByTestId(`launcher-unkeep-${KEPT_APP}`))
    expect(unkeep).toHaveBeenCalledWith(KEPT_APP)
    vi.restoreAllMocks()
  })

  it('does not offer uninstall in the today group (只有「我的羽化」可卸载)', () => {
    seedEclosionForTests('u-today2', true)
    seedWorld()
    registerRuntime(TODAY_APP_1, '边缘神谕')
    openCategory('today')

    expect(gridIn().getByRole('button', { name: '边缘神谕' })).toBeInTheDocument()
    expect(screen.queryByTestId(`launcher-unkeep-${TODAY_APP_1}`)).toBeNull()
  })
})
