import { describe, expect, it } from 'vitest'

import { bytesToImageDataUrl, imageMimeFor, zoomAt } from './image-preview'

describe('imageMimeFor（按扩展名判定图片文件）', () => {
  it('常见图片扩展名映射到正确 MIME，大小写不敏感', () => {
    expect(imageMimeFor('a.png')).toBe('image/png')
    expect(imageMimeFor('a.JPG')).toBe('image/jpeg')
    expect(imageMimeFor('a.svg')).toBe('image/svg+xml')
    expect(imageMimeFor('photo.JPEG')).toBe('image/jpeg')
  })

  it('无扩展名与未知扩展名返回 null（走文本/既有报错路径）', () => {
    expect(imageMimeFor('README')).toBeNull()
    expect(imageMimeFor('data.bin')).toBeNull()
    expect(imageMimeFor('archive.tar.gz')).toBeNull()
  })
})

describe('bytesToImageDataUrl（分块 base64 编码）', () => {
  it('小文件编码为正确 data URL', () => {
    const bytes = new TextEncoder().encode('hello')
    expect(bytesToImageDataUrl(bytes, 'image/png')).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('跨块边界（>0x8000）不丢字节', () => {
    const bytes = new Uint8Array(0x8000 + 3).fill(65)
    const url = bytesToImageDataUrl(bytes, 'image/gif')
    expect(url.startsWith('data:image/gif;base64,')).toBe(true)
    // 解码长度守恒：0x8003 字节全 'A' → base64 长度 = ceil(n/3)*4。
    const base64 = url.slice(url.indexOf(',') + 1)
    expect(base64.length).toBe(Math.ceil((0x8000 + 3) / 3) * 4)
  })
})

describe('zoomAt（光标不动点仿射缩放）', () => {
  const bounds = { minScale: 0.1, maxScale: 40 }

  it('放大后光标指向的内容点保持不动', () => {
    const containerCenter = { centerX: 400, centerY: 300 }
    const cursor = { originX: 600, originY: 200 }
    const before = { scale: 1, tx: 0, ty: 0 }
    const after = zoomAt(before, { factor: 2, ...cursor, ...containerCenter, ...bounds })

    // 内容点 p = (m − C − t)/s：缩放前后必须相等（不动点定义）。
    const pointBefore = {
      x: (cursor.originX - containerCenter.centerX - before.tx) / before.scale,
      y: (cursor.originY - containerCenter.centerY - before.ty) / before.scale,
    }
    const pointAfter = {
      x: (cursor.originX - containerCenter.centerX - after.tx) / after.scale,
      y: (cursor.originY - containerCenter.centerY - after.ty) / after.scale,
    }
    expect(pointAfter).toEqual(pointBefore)
    expect(after.scale).toBe(2)
  })

  it('已有平移状态下连续缩放同样保持不动点', () => {
    const state = { scale: 1.5, tx: -40, ty: 25 }
    const options = {
      factor: 0.8,
      originX: 100,
      originY: 500,
      centerX: 400,
      centerY: 300,
      ...bounds,
    }
    const after = zoomAt(state, options)
    const contentPoint = (s: typeof state) => ({
      x: (options.originX - options.centerX - s.tx) / s.scale,
      y: (options.originY - options.centerY - s.ty) / s.scale,
    })
    expect(contentPoint(after)).toEqual(contentPoint(state))
    expect(after.scale).toBeCloseTo(1.2)
  })

  it('撞到 min/max 边界时停住且不再产生平移漂移', () => {
    const maxed = zoomAt(
      { scale: 40, tx: 12, ty: -8 },
      { factor: 2, originX: 10, originY: 10, centerX: 0, centerY: 0, ...bounds },
    )
    expect(maxed).toEqual({ scale: 40, tx: 12, ty: -8 })

    const mined = zoomAt(
      { scale: 0.1, tx: 5, ty: 5 },
      { factor: 0.5, originX: 10, originY: 10, centerX: 0, centerY: 0, ...bounds },
    )
    expect(mined).toEqual({ scale: 0.1, tx: 5, ty: 5 })
  })

  it('锚点在容器中心（按钮步进）时平移按系数等比缩放', () => {
    const after = zoomAt(
      { scale: 1, tx: 30, ty: -20 },
      { factor: 2, originX: 400, originY: 300, centerX: 400, centerY: 300, ...bounds },
    )
    expect(after).toEqual({ scale: 2, tx: 60, ty: -40 })
  })
})
