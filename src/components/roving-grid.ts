/**
 * Roving TabIndex 网格漫游的可测内核：给定各条目的几何盒与当前下标，算出
 * 方向键的目标下标。行判定按 top 分带（±2px 容差吃掉亚像素渲染抖动），
 * 纵向移动取相邻行里 |left 差| 最小的条目（空间对齐，Windows 资源管理器
 * 桌面网格同语义）；横向移动逐项 ±1（不换行不 wrap——wrap 会让「行尾按
 * →」跳到下一行行首，破坏空间直觉）。
 */

export type GridDirection = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export interface RovingItemBox {
  top: number
  left: number
}

/** 行同带的 top 容差（px）。 */
const BAND_TOLERANCE = 2

export function rovingGridTarget(
  boxes: readonly RovingItemBox[],
  current: number,
  key: GridDirection,
): number {
  const count = boxes.length
  const box = boxes[current]
  if (count === 0 || box === undefined) return current

  if (key === 'ArrowLeft') return current > 0 ? current - 1 : current
  if (key === 'ArrowRight') return current < count - 1 ? current + 1 : current

  const bands: number[][] = []
  for (let i = 0; i < count; i++) {
    const item = boxes[i]
    if (item === undefined) continue
    const band = bands.find(
      (candidates) =>
        Math.abs((boxes[candidates[0]]?.top ?? Number.NaN) - item.top) <= BAND_TOLERANCE,
    )
    if (band) band.push(i)
    else bands.push([i])
  }
  const bandIndex = bands.findIndex((candidates) => candidates.includes(current))
  const targetBand = key === 'ArrowUp' ? bands[bandIndex - 1] : bands[bandIndex + 1]
  if (targetBand === undefined) return current

  let best = targetBand[0] as number
  let bestDistance = Math.abs((boxes[best]?.left ?? 0) - box.left)
  for (const candidate of targetBand.slice(1)) {
    const distance = Math.abs((boxes[candidate]?.left ?? 0) - box.left)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
