import { describe, expect, it } from 'vitest'

import { rovingGridTarget } from './roving-grid'

/** 3×3 网格（行距 100、列距 200）的几何盒。 */
const GRID = Array.from({ length: 9 }, (_, i) => ({
  top: Math.floor(i / 3) * 100,
  left: (i % 3) * 200,
}))

describe('rovingGridTarget（Roving TabIndex 网格漫游）', () => {
  it('横向逐项 ±1 且在边界停住（不换行不 wrap）', () => {
    expect(rovingGridTarget(GRID, 0, 'ArrowRight')).toBe(1)
    expect(rovingGridTarget(GRID, 1, 'ArrowLeft')).toBe(0)
    expect(rovingGridTarget(GRID, 0, 'ArrowLeft')).toBe(0)
    expect(rovingGridTarget(GRID, 8, 'ArrowRight')).toBe(8)
  })

  it('纵向按 top 分带切换，取相邻行 |left 差| 最小的条目', () => {
    expect(rovingGridTarget(GRID, 4, 'ArrowUp')).toBe(1)
    expect(rovingGridTarget(GRID, 4, 'ArrowDown')).toBe(7)
    // 非对齐列：中行第 2 列（left 200）上移 → 首行 left 200 同列（1）。
    expect(rovingGridTarget(GRID, 5, 'ArrowUp')).toBe(2)
  })

  it('首行按 ↑、末行按 ↓ 停在原位', () => {
    expect(rovingGridTarget(GRID, 2, 'ArrowUp')).toBe(2)
    expect(rovingGridTarget(GRID, 7, 'ArrowDown')).toBe(7)
  })

  it('亚像素抖动（±2px 容差）不拆行；单行网格纵移不动', () => {
    const singleRow = Array.from({ length: 3 }, (_, i) => ({
      top: i % 2 === 0 ? 0.5 : -0.5,
      left: i * 200,
    }))
    expect(rovingGridTarget(singleRow, 1, 'ArrowUp')).toBe(1)
    expect(rovingGridTarget(singleRow, 1, 'ArrowDown')).toBe(1)
  })

  it('空网格与越界当前下标原样返回', () => {
    expect(rovingGridTarget([], 0, 'ArrowRight')).toBe(0)
    expect(rovingGridTarget(GRID, 99, 'ArrowDown')).toBe(99)
  })
})
