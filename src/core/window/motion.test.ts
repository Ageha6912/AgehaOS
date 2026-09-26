import { describe, expect, it } from 'vitest'

import {
  FLIGHT_MID_OFFSET,
  FLIGHT_MID_OPACITY,
  FLIGHT_MID_SCALE_X,
  FLIGHT_MID_SCALE_Y,
  GENIE_SCALE_X,
  GENIE_SCALE_Y,
  WINDOW_CLOSE_MS,
  WINDOW_FLIGHT_MS,
  WINDOW_OPEN_MS,
  bezier,
  dockPoseTransform,
  flightDelta,
  flightKeyframes,
  originToward,
} from './motion'

const WINDOW = { left: 100, top: 80, width: 900, height: 600 }
const ANCHOR = { x: 260, y: 690 } // 任务栏按钮中心（视口 720 高时按钮在下方）

describe('窗口动效常量（DESIGN.md §12 归档口径）', () => {
  it('keeps close strictly shorter than open and the flight at the top tier', () => {
    expect(WINDOW_OPEN_MS).toBe(200) // = --ag-motion-base 同值
    expect(WINDOW_CLOSE_MS).toBe(120) // = --ag-motion-fast 同值，恒短于打开
    expect(WINDOW_FLIGHT_MS).toBe(300) // genie 最大位移取最高档
  })

  it('keeps the genie squash ratio at half width', () => {
    expect(GENIE_SCALE_Y).toBe(GENIE_SCALE_X / 2)
    expect(FLIGHT_MID_SCALE_Y).toBeLessThan(FLIGHT_MID_SCALE_X)
  })
})

describe('flightDelta（窗口中心 → 锚点位移）', () => {
  it('computes the center-to-anchor offset', () => {
    const delta = flightDelta(WINDOW, ANCHOR)
    // 窗口中心 (550, 380)
    expect(delta.dx).toBeCloseTo(260 - 550, 6)
    expect(delta.dy).toBeCloseTo(690 - 380, 6)
  })
})

describe('originToward（来源锚定投影 + 限幅）', () => {
  it('projects the anchor into percentage coordinates', () => {
    // x: (260-100)/900=17.8%，y: (690-80)/600=101.7%（任务栏在窗口下方 → ≥100%）
    expect(originToward(WINDOW, ANCHOR)).toBe('17.8% 101.7%')
  })

  it('clamps extreme anchors to the safe ranges', () => {
    const farLeft = originToward(WINDOW, { x: -100000, y: 690 })
    expect(farLeft).toBe('-50.0% 101.7%')
    const farRight = originToward(WINDOW, { x: 100000, y: 5000 })
    expect(farRight).toBe('150.0% 140.0%')
  })

  it('degrades zero-size rectangles safely (jsdom geometry)', () => {
    // 宽高回退为 1 防除零；投影仍被限幅收进安全区间（不产生 NaN/Infinity）。
    const empty = originToward({ left: 0, top: 0, width: 0, height: 0 }, { x: 3, y: 4 })
    expect(empty).toBe('150.0% 140.0%')
  })
})

describe('flightKeyframes（genie 三关键帧）', () => {
  it('builds three keyframes with the mid pivot and two easing legs', () => {
    const delta = flightDelta(WINDOW, ANCHOR)
    const frames = flightKeyframes(delta)

    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.offset)).toEqual([0, FLIGHT_MID_OFFSET, 1])
    expect(frames[0].transform).toBe('translate(0px, 0px) scale(1, 1)')
    expect(frames[0].easing).toBe(bezier([0.55, 0, 1, 0.45])) // 前段俯冲
    expect(frames[1].easing).toBe(bezier([0.2, 0, 0, 1])) // 后段缓收

    // 中段：横行程 <0.5、纵行程 >横（先坠后收），压扁开始，轻微渐隐
    expect(frames[1].transform).toContain(`scale(${FLIGHT_MID_SCALE_X}, ${FLIGHT_MID_SCALE_Y})`)
    expect(frames[1].opacity).toBe(FLIGHT_MID_OPACITY)

    // 末帧：完整位移 + 横缩纵压 + 完全渐隐
    expect(frames[2].transform).toBe(
      `translate(${delta.dx.toFixed(1)}px, ${delta.dy.toFixed(1)}px) scale(${GENIE_SCALE_X}, ${GENIE_SCALE_Y})`,
    )
    expect(frames[2].opacity).toBe(0)

    // 不透明度单调下降
    expect(frames[0].opacity).toBeGreaterThan(frames[1].opacity)
    expect(frames[1].opacity).toBeGreaterThan(frames[2].opacity)
  })
})

describe('dockPoseTransform（还原飞行起点）', () => {
  it('matches the final genie keyframe exactly', () => {
    const delta = flightDelta(WINDOW, ANCHOR)
    expect(dockPoseTransform(delta)).toBe(flightKeyframes(delta)[2].transform)
  })
})

describe('bezier（控制点序列化）', () => {
  it('formats control points as a cubic-bezier string', () => {
    expect(bezier([0.32, 0.72, 0, 1])).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  })
})
