import { describe, expect, it } from 'vitest'

import {
  classifyDrag,
  DEFAULT_EDGE_BACK_CONFIG,
  edgeBackTranslation,
  inwardDisplacement,
  isEdgeOrigin,
  shouldConfirmEdgeBack,
} from './edge-back-decision'

/**
 * 边缘返回判定纯函数契约（M2-4）：起点带内判定 / 轴向裁决 / 过半或甩动
 * 确认 / 跟手位移封顶。hook（use-edge-back.ts）消费这些函数，阈值语义
 * 全部钉在本文件（HANDOFF §4.0-4「判定逻辑抽成可单测纯函数」）。
 */

const VW = { width: 400, height: 800 }

describe('DEFAULT_EDGE_BACK_CONFIG', () => {
  it('默认档：左缘 / 24px 激活带 / 过半确认 / 0.5px/ms 甩动 / 10px 轴死区', () => {
    expect(DEFAULT_EDGE_BACK_CONFIG).toEqual({
      side: 'left',
      edgeWidth: 24,
      confirmRatio: 0.5,
      confirmVelocity: 0.5,
      axisSlack: 10,
    })
  })

  it('配置冻结（共享常量不可被运行时改写）', () => {
    expect(Object.isFrozen(DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
  })
})

describe('isEdgeOrigin', () => {
  it('左缘：起点 x ≤ 24 在带内（含边界），> 24 不在', () => {
    expect(isEdgeOrigin({ x: 0, y: 300 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
    expect(isEdgeOrigin({ x: 24, y: 300 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
    expect(isEdgeOrigin({ x: 25, y: 300 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(false)
    expect(isEdgeOrigin({ x: 100, y: 300 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(false)
  })

  it('左缘带内不看 y（整条左缘竖带都激活）', () => {
    expect(isEdgeOrigin({ x: 10, y: 0 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
    expect(isEdgeOrigin({ x: 10, y: 799 }, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
  })

  it('右缘（预留向）：距右缘 ≤ edgeWidth 在带内', () => {
    const right = { ...DEFAULT_EDGE_BACK_CONFIG, side: 'right' as const }
    expect(isEdgeOrigin({ x: 390, y: 300 }, VW, right)).toBe(true)
    expect(isEdgeOrigin({ x: 376, y: 300 }, VW, right)).toBe(true)
    expect(isEdgeOrigin({ x: 375, y: 300 }, VW, right)).toBe(false)
  })

  it('顶缘（预留向）：量测轴切到 y 与 height', () => {
    const top = { ...DEFAULT_EDGE_BACK_CONFIG, side: 'top' as const }
    expect(isEdgeOrigin({ x: 200, y: 24 }, VW, top)).toBe(true)
    expect(isEdgeOrigin({ x: 200, y: 25 }, VW, top)).toBe(false)
  })
})

describe('inwardDisplacement', () => {
  it('左缘：向右为正（向内），向左为负（向外）', () => {
    expect(inwardDisplacement({ x: 10, y: 0 }, { x: 210, y: 0 }, DEFAULT_EDGE_BACK_CONFIG)).toBe(200)
    expect(inwardDisplacement({ x: 10, y: 0 }, { x: 4, y: 0 }, DEFAULT_EDGE_BACK_CONFIG)).toBe(-6)
  })

  it('右缘：向左为正；顶缘：向下为正（四向对称预留）', () => {
    const right = { ...DEFAULT_EDGE_BACK_CONFIG, side: 'right' as const }
    expect(inwardDisplacement({ x: 390, y: 0 }, { x: 190, y: 0 }, right)).toBe(200)
    const top = { ...DEFAULT_EDGE_BACK_CONFIG, side: 'top' as const }
    expect(inwardDisplacement({ x: 0, y: 10 }, { x: 0, y: 210 }, top)).toBe(200)
  })
})

describe('classifyDrag', () => {
  it('死区内（≤10px 总位移）→ undecided：滤点击抖动，不抢原生手势', () => {
    expect(classifyDrag({ x: 8, y: 300 }, { x: 14, y: 302 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('undecided')
  })

  it('向内分量为主 → inward', () => {
    expect(classifyDrag({ x: 8, y: 300 }, { x: 60, y: 310 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('inward')
  })

  it('纵向为主 → reject：把交互还给 .mobile-app-body 原生纵向滚动', () => {
    expect(classifyDrag({ x: 8, y: 300 }, { x: 20, y: 360 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('reject')
  })

  it('向外拖（位移为负）→ reject，即便横向为主', () => {
    expect(classifyDrag({ x: 8, y: 300 }, { x: -6, y: 300 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('reject')
    expect(classifyDrag({ x: 20, y: 300 }, { x: 0, y: 288 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('reject')
  })

  it('对角等量 → 非严格向内为主即 reject（宁可不激活）', () => {
    expect(classifyDrag({ x: 8, y: 300 }, { x: 58, y: 350 }, DEFAULT_EDGE_BACK_CONFIG)).toBe('reject')
  })
})

describe('shouldConfirmEdgeBack', () => {
  it('距离判据：向内位移严格大于 视口宽 × confirmRatio（400 × 0.5 = 200）', () => {
    expect(shouldConfirmEdgeBack({ inwardDx: 201, velocity: 0, viewport: VW }, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
    expect(shouldConfirmEdgeBack({ inwardDx: 200, velocity: 0, viewport: VW }, DEFAULT_EDGE_BACK_CONFIG)).toBe(false)
  })

  it('速度判据：甩动速度 ≥ 0.5px/ms（500px/s）即确认，无需拖过半', () => {
    expect(shouldConfirmEdgeBack({ inwardDx: 60, velocity: 0.5, viewport: VW }, DEFAULT_EDGE_BACK_CONFIG)).toBe(true)
    expect(shouldConfirmEdgeBack({ inwardDx: 60, velocity: 0.49, viewport: VW }, DEFAULT_EDGE_BACK_CONFIG)).toBe(false)
  })

  it('两判据都不过 → 不确认', () => {
    expect(shouldConfirmEdgeBack({ inwardDx: 120, velocity: 0.2, viewport: VW }, DEFAULT_EDGE_BACK_CONFIG)).toBe(false)
  })

  it('纵向 side（预留向）：距离轴切到 height', () => {
    const top = { ...DEFAULT_EDGE_BACK_CONFIG, side: 'top' as const }
    expect(shouldConfirmEdgeBack({ inwardDx: 401, velocity: 0, viewport: VW }, top)).toBe(true)
    expect(shouldConfirmEdgeBack({ inwardDx: 400, velocity: 0, viewport: VW }, top)).toBe(false)
  })
})

describe('edgeBackTranslation', () => {
  it('跟手位移 1:1 透传', () => {
    expect(edgeBackTranslation(120, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(120)
  })

  it('向外位移钳 0（面板不反向滑出）', () => {
    expect(edgeBackTranslation(-30, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(0)
  })

  it('超过一个屏宽钳屏宽（面板最多滑出一个屏宽）', () => {
    expect(edgeBackTranslation(900, VW, DEFAULT_EDGE_BACK_CONFIG)).toBe(400)
  })
})
